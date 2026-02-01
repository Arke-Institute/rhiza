/**
 * Mock Arke Client for Unit Tests
 *
 * Provides a configurable mock of the Arke SDK client that:
 * - Returns pre-configured entities
 * - Tracks all mutations (creates, updates, deletes)
 * - Tracks all invocations
 * - Simulates errors (404, CAS conflicts)
 */

import type {
  KladosEntity,
  KladosProperties,
  RhizaEntity,
  RhizaProperties,
  BatchProperties,
  KladosLogEntry,
} from '../../types';

// ============================================================================
// Configuration Types
// ============================================================================

export interface MockKlados {
  properties: KladosProperties;
  cid?: string;
}

export interface MockRhiza {
  properties: RhizaProperties;
  cid?: string;
}

export interface MockEntity {
  type: string;
  properties: Record<string, unknown>;
  cid?: string;
  relationships?: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
  }>;
}

export interface MockClientConfig {
  /** Pre-loaded klados entities (GET /kladoi/:id returns these) */
  kladoi?: Record<string, MockKlados>;

  /** Pre-loaded rhiza entities (GET /rhizai/:id returns these) */
  rhizai?: Record<string, MockRhiza>;

  /** Pre-loaded generic entities (GET /entities/:id returns these) */
  entities?: Record<string, MockEntity>;

  /** Batch state (for gather tests) */
  batches?: Record<string, BatchProperties>;

  /** Log entries (for traverse/resume tests) */
  logs?: KladosLogEntry[];

  /** Error simulation */
  errors?: {
    /** Entity IDs that return 404 */
    notFound?: string[];
    /** Fail first N updates (for CAS retry tests) */
    onUpdate?: number;
    /** Klados ID → error message (for invocation errors) */
    onInvoke?: Record<string, string>;
  };
}

// ============================================================================
// Tracked State Types
// ============================================================================

export interface CreatedEntity {
  type: string;
  collection?: string;
  properties: Record<string, unknown>;
  relationships?: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
  }>;
}

export interface UpdatedEntity {
  id: string;
  properties?: Record<string, unknown>;
  relationships_add?: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
  }>;
  expect_tip?: string;
}

export interface InvokedKlados {
  kladosId: string;
  request: Record<string, unknown>;
  timestamp: string;
}

export interface InvokedRhiza {
  rhizaId: string;
  request: Record<string, unknown>;
  timestamp: string;
}

// ============================================================================
// Mock API Response Types
// ============================================================================

interface MockResponse<T> {
  data?: T;
  error?: { message: string; code?: string };
}

// ============================================================================
// Mock Client Interface
// ============================================================================

export interface MockArkeClient {
  api: {
    GET: <T = unknown>(path: string, options?: { params?: { path?: Record<string, string>; query?: Record<string, unknown> } }) => Promise<MockResponse<T>>;
    POST: <T = unknown>(path: string, options?: { params?: { path?: Record<string, string> }; body?: Record<string, unknown> }) => Promise<MockResponse<T>>;
    PUT: <T = unknown>(path: string, options?: { params?: { path?: Record<string, string> }; body?: Record<string, unknown> }) => Promise<MockResponse<T>>;
    DELETE: <T = unknown>(path: string, options?: { params?: { path?: Record<string, string> } }) => Promise<MockResponse<T>>;
  };

  // Direct invocation helpers (for testing without API round-trip)
  invokeKlados(kladosId: string, request: Record<string, unknown>): void;
  invokeRhiza(rhizaId: string, request: Record<string, unknown>): void;

  // Test inspection helpers
  getCreated(): CreatedEntity[];
  getUpdated(): UpdatedEntity[];
  getInvokedKladoi(): InvokedKlados[];
  getInvokedRhizai(): InvokedRhiza[];
  reset(): void;

  // State manipulation for tests
  addKlados(id: string, klados: MockKlados): void;
  addRhiza(id: string, rhiza: MockRhiza): void;
  addEntity(id: string, entity: MockEntity): void;
  setBatch(id: string, batch: BatchProperties): void;
}

// ============================================================================
// Implementation
// ============================================================================

export function createMockClient(config: MockClientConfig = {}): MockArkeClient {
  // Internal state
  const state = {
    kladoi: new Map<string, MockKlados>(Object.entries(config.kladoi ?? {})),
    rhizai: new Map<string, MockRhiza>(Object.entries(config.rhizai ?? {})),
    entities: new Map<string, MockEntity>(Object.entries(config.entities ?? {})),
    batches: new Map<string, BatchProperties>(Object.entries(config.batches ?? {})),
    logs: [...(config.logs ?? [])],

    // Tracked mutations
    created: [] as CreatedEntity[],
    updated: [] as UpdatedEntity[],
    invokedKladoi: [] as InvokedKlados[],
    invokedRhizai: [] as InvokedRhiza[],

    // Error tracking
    updateAttempts: 0,
    notFound: new Set(config.errors?.notFound ?? []),
    updateFailCount: config.errors?.onUpdate ?? 0,
    invokeErrors: new Map(Object.entries(config.errors?.onInvoke ?? {})),

    // ID generation counter
    idCounter: 0,
  };

  const generateId = () => `mock_${++state.idCounter}_${Date.now()}`;
  const generateCid = () => `cid_${++state.idCounter}`;

  // Helper to check if entity should return 404
  const isNotFound = (id: string): boolean => state.notFound.has(id);

  // ============================================================================
  // GET Handler
  // ============================================================================

  async function handleGet(path: string, options?: { params?: { path?: Record<string, string>; query?: Record<string, unknown> } }): Promise<MockResponse<unknown>> {
    const id = options?.params?.path?.id;

    // GET /kladoi/:id
    if (path.includes('/kladoi/') && id) {
      if (isNotFound(id)) {
        return { error: { message: 'Not found', code: '404' } };
      }
      const klados = state.kladoi.get(id);
      if (!klados) {
        return { error: { message: 'Klados not found', code: '404' } };
      }
      return {
        data: {
          id,
          type: 'klados',
          properties: klados.properties,
          cid: klados.cid ?? generateCid(),
        } as KladosEntity,
      };
    }

    // GET /rhizai/:id
    if (path.includes('/rhizai/') && id) {
      if (isNotFound(id)) {
        return { error: { message: 'Not found', code: '404' } };
      }
      const rhiza = state.rhizai.get(id);
      if (!rhiza) {
        return { error: { message: 'Rhiza not found', code: '404' } };
      }
      return {
        data: {
          id,
          type: 'rhiza',
          properties: rhiza.properties,
          cid: rhiza.cid ?? generateCid(),
        } as RhizaEntity,
      };
    }

    // GET /entities/:id/tip
    if (path.includes('/entities/') && path.includes('/tip') && id) {
      if (isNotFound(id)) {
        return { error: { message: 'Not found', code: '404' } };
      }

      // Check all entity stores
      const klados = state.kladoi.get(id);
      if (klados) {
        return { data: { cid: klados.cid ?? generateCid() } };
      }

      const rhiza = state.rhizai.get(id);
      if (rhiza) {
        return { data: { cid: rhiza.cid ?? generateCid() } };
      }

      const entity = state.entities.get(id);
      if (entity) {
        return { data: { cid: entity.cid ?? generateCid() } };
      }

      const batch = state.batches.get(id);
      if (batch) {
        return { data: { cid: generateCid() } };
      }

      return { error: { message: 'Entity not found', code: '404' } };
    }

    // GET /entities/:id
    if (path.includes('/entities/') && id) {
      if (isNotFound(id)) {
        return { error: { message: 'Not found', code: '404' } };
      }

      // Check klados
      const klados = state.kladoi.get(id);
      if (klados) {
        return {
          data: {
            id,
            type: 'klados',
            properties: klados.properties,
            cid: klados.cid ?? generateCid(),
          },
        };
      }

      // Check rhiza
      const rhiza = state.rhizai.get(id);
      if (rhiza) {
        return {
          data: {
            id,
            type: 'rhiza',
            properties: rhiza.properties,
            cid: rhiza.cid ?? generateCid(),
          },
        };
      }

      // Check generic entities
      const entity = state.entities.get(id);
      if (entity) {
        return {
          data: {
            id,
            type: entity.type,
            properties: entity.properties,
            relationships: entity.relationships ?? [],
            cid: entity.cid ?? generateCid(),
          },
        };
      }

      // Check batches
      const batch = state.batches.get(id);
      if (batch) {
        return {
          data: {
            id,
            type: 'batch',
            properties: batch,
            cid: generateCid(),
          },
        };
      }

      return { error: { message: 'Entity not found', code: '404' } };
    }

    // GET /collections/:id
    if (path.includes('/collections/') && id) {
      if (isNotFound(id)) {
        return { error: { message: 'Not found', code: '404' } };
      }

      const collection = state.entities.get(id);
      if (collection && collection.type === 'collection') {
        return {
          data: {
            id,
            type: 'collection',
            properties: collection.properties,
            relationships: collection.relationships ?? [],
            cid: collection.cid ?? generateCid(),
          },
        };
      }

      // Return empty collection by default
      return {
        data: {
          id,
          type: 'collection',
          properties: {},
          relationships: [],
          cid: generateCid(),
        },
      };
    }

    return { error: { message: `Unknown GET path: ${path}`, code: '404' } };
  }

  // ============================================================================
  // POST Handler
  // ============================================================================

  async function handlePost(path: string, options?: { params?: { path?: Record<string, string> }; body?: Record<string, unknown> }): Promise<MockResponse<unknown>> {
    const id = options?.params?.path?.id;
    const body = options?.body ?? {};

    // POST /kladoi/:id/invoke
    if (path.includes('/kladoi/') && path.includes('/invoke') && id) {
      // Check for configured invoke error
      const invokeError = state.invokeErrors.get(id);
      if (invokeError) {
        return { error: { message: invokeError, code: 'INVOKE_ERROR' } };
      }

      const klados = state.kladoi.get(id);
      if (!klados) {
        return { error: { message: 'Klados not found', code: '404' } };
      }

      const jobId = (body.job_id as string) ?? generateId();
      state.invokedKladoi.push({
        kladosId: id,
        request: body,
        timestamp: new Date().toISOString(),
      });

      return {
        data: {
          accepted: true,
          job_id: jobId,
          status: 'started',
        },
      };
    }

    // POST /rhizai/:id/invoke
    if (path.includes('/rhizai/') && path.includes('/invoke') && id) {
      const rhiza = state.rhizai.get(id);
      if (!rhiza) {
        return { error: { message: 'Rhiza not found', code: '404' } };
      }

      const jobId = (body.job_id as string) ?? generateId();
      state.invokedRhizai.push({
        rhizaId: id,
        request: body,
        timestamp: new Date().toISOString(),
      });

      return {
        data: {
          accepted: true,
          job_id: jobId,
          status: 'started',
        },
      };
    }

    // POST /entities
    if (path === '/entities') {
      const newId = generateId();
      const newEntity: CreatedEntity = {
        type: body.type as string,
        collection: body.collection as string | undefined,
        properties: body.properties as Record<string, unknown>,
        relationships: body.relationships as CreatedEntity['relationships'],
      };

      state.created.push(newEntity);

      // Also add to entities map for future retrieval
      state.entities.set(newId, {
        type: body.type as string,
        properties: body.properties as Record<string, unknown>,
        relationships: body.relationships as MockEntity['relationships'],
        cid: generateCid(),
      });

      return {
        data: {
          id: newId,
          type: body.type,
          properties: body.properties,
          cid: generateCid(),
        },
      };
    }

    // POST /files
    if (path === '/files') {
      const newId = generateId();
      const newEntity: CreatedEntity = {
        type: 'file',
        collection: body.collection as string | undefined,
        properties: body.properties as Record<string, unknown>,
      };

      state.created.push(newEntity);

      // Add to entities map
      state.entities.set(newId, {
        type: 'file',
        properties: body.properties as Record<string, unknown>,
        cid: generateCid(),
      });

      return {
        data: {
          id: newId,
          type: 'file',
          properties: body.properties,
          cid: generateCid(),
        },
      };
    }

    return { error: { message: `Unknown POST path: ${path}`, code: '400' } };
  }

  // ============================================================================
  // PUT Handler
  // ============================================================================

  async function handlePut(path: string, options?: { params?: { path?: Record<string, string> }; body?: Record<string, unknown> }): Promise<MockResponse<unknown>> {
    const id = options?.params?.path?.id;
    const body = options?.body ?? {};

    // Simulate CAS conflicts
    if (state.updateAttempts < state.updateFailCount) {
      state.updateAttempts++;
      return { error: { message: '409 Conflict: CID mismatch', code: '409' } };
    }

    // PUT /entities/:id
    if (path.includes('/entities/') && id) {
      if (isNotFound(id)) {
        return { error: { message: 'Not found', code: '404' } };
      }

      state.updated.push({
        id,
        properties: body.properties as Record<string, unknown> | undefined,
        relationships_add: body.relationships_add as UpdatedEntity['relationships_add'],
        expect_tip: body.expect_tip as string | undefined,
      });

      // Update internal state
      const existing = state.entities.get(id);
      if (existing && body.properties) {
        existing.properties = { ...existing.properties, ...(body.properties as Record<string, unknown>) };
        existing.cid = generateCid();
      }

      // Update batch if it exists
      const batch = state.batches.get(id);
      if (batch && body.properties) {
        const newProps = body.properties as Partial<BatchProperties>;
        Object.assign(batch, newProps);
      }

      return {
        data: {
          id,
          cid: generateCid(),
        },
      };
    }

    // PUT /collections/:id
    if (path.includes('/collections/') && id) {
      if (isNotFound(id)) {
        return { error: { message: 'Not found', code: '404' } };
      }

      state.updated.push({
        id,
        relationships_add: body.relationships_add as UpdatedEntity['relationships_add'],
        expect_tip: body.expect_tip as string | undefined,
      });

      return {
        data: {
          id,
          cid: generateCid(),
        },
      };
    }

    return { error: { message: `Unknown PUT path: ${path}`, code: '400' } };
  }

  // ============================================================================
  // DELETE Handler
  // ============================================================================

  async function handleDelete(path: string, options?: { params?: { path?: Record<string, string> } }): Promise<MockResponse<unknown>> {
    const id = options?.params?.path?.id;

    if (id) {
      state.kladoi.delete(id);
      state.rhizai.delete(id);
      state.entities.delete(id);
      state.batches.delete(id);

      return { data: { success: true } };
    }

    return { error: { message: `Unknown DELETE path: ${path}`, code: '400' } };
  }

  // ============================================================================
  // Return Mock Client
  // ============================================================================

  return {
    api: {
      GET: handleGet,
      POST: handlePost,
      PUT: handlePut,
      DELETE: handleDelete,
    },

    invokeKlados: (kladosId: string, request: Record<string, unknown>) => {
      state.invokedKladoi.push({
        kladosId,
        request,
        timestamp: new Date().toISOString(),
      });
    },

    invokeRhiza: (rhizaId: string, request: Record<string, unknown>) => {
      state.invokedRhizai.push({
        rhizaId,
        request,
        timestamp: new Date().toISOString(),
      });
    },

    getCreated: () => [...state.created],
    getUpdated: () => [...state.updated],
    getInvokedKladoi: () => [...state.invokedKladoi],
    getInvokedRhizai: () => [...state.invokedRhizai],

    reset: () => {
      state.created = [];
      state.updated = [];
      state.invokedKladoi = [];
      state.invokedRhizai = [];
      state.updateAttempts = 0;
    },

    addKlados: (id: string, klados: MockKlados) => {
      state.kladoi.set(id, klados);
    },

    addRhiza: (id: string, rhiza: MockRhiza) => {
      state.rhizai.set(id, rhiza);
    },

    addEntity: (id: string, entity: MockEntity) => {
      state.entities.set(id, entity);
    },

    setBatch: (id: string, batch: BatchProperties) => {
      state.batches.set(id, batch);
    },
  };
}
