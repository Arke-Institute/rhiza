# API Changes (arke_v1)

## Overview

The Arke API needs new routes and profiles to support rhiza workflows. This document outlines the required changes to `/Users/chim/Working/arke_institute/arke_v1`.

---

## New Files

### `src/profiles/rhiza/`

```
src/profiles/rhiza/
├── types.ts        # Rhiza entity types
├── operations.ts   # CRUD operations
├── validation.ts   # Rhiza validation
└── index.ts        # Exports
```

### `src/routes/rhizai.ts`

New route file for rhiza endpoints.

---

## Rhiza Entity Profile

### `src/profiles/rhiza/types.ts`

```typescript
import type { Rhiza, KladosSpec, ThenSpec } from '@arke-institute/rhiza';

export const RHIZA_TYPE = 'rhiza';

/**
 * Rhiza entity properties
 */
export interface RhizaProperties {
  /** Human-readable name */
  label: string;

  /** Description */
  description?: string;

  /** Semantic version */
  version: string;

  /** Status */
  status: 'development' | 'active' | 'disabled';

  /** Entry klados name */
  entry: string;

  /** Klados definitions */
  kladoi: Record<string, KladosSpec>;

  /** Created timestamp */
  created_at: string;

  /** Updated timestamp */
  updated_at: string;
}

/**
 * Rhiza manifest (entity format)
 */
export interface RhizaManifest {
  id: string;
  type: typeof RHIZA_TYPE;
  properties: RhizaProperties;
  relationships: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
    peer_label?: string;
    properties?: Record<string, unknown>;
  }>;
  ver: number;
  created_at: string;
  ts: string;
  edited_by?: {
    user_id: string;
    method: string;
  };
}

/**
 * Convert entity to Rhiza definition
 */
export function toRhizaDefinition(manifest: RhizaManifest): Rhiza {
  return {
    id: manifest.id,
    name: manifest.properties.label,
    version: manifest.properties.version,
    description: manifest.properties.description,
    entry: manifest.properties.entry,
    kladoi: manifest.properties.kladoi,
  };
}
```

### `src/profiles/rhiza/operations.ts`

```typescript
import type { IManifestStorage, ITipService } from '@/core/storage/interfaces';
import type { ExecutionContext, EditInfo } from '@/schema/operations';
import type { RhizaManifest, RhizaProperties } from './types';
import { RHIZA_TYPE, toRhizaDefinition } from './types';
import { validateRhiza } from '@arke-institute/rhiza';
import { NotFoundError, ValidationError } from '@/errors';
import { generateId } from '@/utils/ulid';

/**
 * Create a new rhiza entity
 */
export async function createRhiza(
  storage: IManifestStorage,
  tip: ITipService,
  params: {
    id?: string;
    label: string;
    description?: string;
    version: string;
    entry: string;
    kladoi: Record<string, any>;
    collection: string;
    edited_by: EditInfo;
    note?: string;
  },
  executionContext: ExecutionContext
): Promise<{ id: string; cid: string; manifest: RhizaManifest }> {
  const id = params.id ?? `II${generateId()}`;
  const now = new Date().toISOString();

  // Validate rhiza definition
  const rhizaDefinition = {
    id,
    name: params.label,
    version: params.version,
    entry: params.entry,
    kladoi: params.kladoi,
  };

  const validation = validateRhiza(rhizaDefinition);
  if (!validation.valid) {
    throw new ValidationError(
      `Invalid rhiza definition: ${validation.errors.map((e) => e.message).join(', ')}`
    );
  }

  const properties: RhizaProperties = {
    label: params.label,
    description: params.description,
    version: params.version,
    status: 'development',
    entry: params.entry,
    kladoi: params.kladoi,
    created_at: now,
    updated_at: now,
  };

  const manifest: RhizaManifest = {
    id,
    type: RHIZA_TYPE,
    properties,
    relationships: [],
    ver: 1,
    created_at: now,
    ts: now,
    edited_by: params.edited_by,
  };

  // Store manifest
  const cid = await storage.writeManifest(manifest);
  await tip.writeTip(id, cid);

  // Add to collection
  // ... (similar to agent creation)

  return { id, cid, manifest };
}

/**
 * Get a rhiza by ID
 */
export async function getRhiza(
  storage: IManifestStorage,
  tip: ITipService,
  id: string
): Promise<{ cid: string; manifest: RhizaManifest }> {
  const cid = await tip.readTipOrNull(id);
  if (!cid) {
    throw new NotFoundError(`Rhiza ${id} not found`);
  }

  const manifest = (await storage.readManifest(cid)) as RhizaManifest;
  if (manifest.type !== RHIZA_TYPE) {
    throw new ValidationError(`Entity ${id} is not a rhiza`);
  }

  return { cid, manifest };
}

/**
 * Update a rhiza
 */
export async function updateRhiza(
  storage: IManifestStorage,
  tip: ITipService,
  id: string,
  params: {
    expect_tip: string;
    label?: string;
    description?: string;
    version?: string;
    status?: 'development' | 'active' | 'disabled';
    entry?: string;
    kladoi?: Record<string, any>;
    edited_by: EditInfo;
    note?: string;
  },
  executionContext: ExecutionContext
): Promise<{ id: string; cid: string; manifest: RhizaManifest; prev_cid: string }> {
  const { cid: currentCid, manifest: current } = await getRhiza(storage, tip, id);

  // CAS check
  if (currentCid !== params.expect_tip) {
    throw new ValidationError('Conflict: entity has been modified');
  }

  const now = new Date().toISOString();

  // Build updated properties
  const properties: RhizaProperties = {
    ...current.properties,
    ...(params.label !== undefined && { label: params.label }),
    ...(params.description !== undefined && { description: params.description }),
    ...(params.version !== undefined && { version: params.version }),
    ...(params.status !== undefined && { status: params.status }),
    ...(params.entry !== undefined && { entry: params.entry }),
    ...(params.kladoi !== undefined && { kladoi: params.kladoi }),
    updated_at: now,
  };

  // If kladoi or entry changed, re-validate
  if (params.kladoi !== undefined || params.entry !== undefined) {
    const rhizaDefinition = {
      id,
      name: properties.label,
      version: properties.version,
      entry: properties.entry,
      kladoi: properties.kladoi,
    };

    const validation = validateRhiza(rhizaDefinition);
    if (!validation.valid) {
      throw new ValidationError(
        `Invalid rhiza definition: ${validation.errors.map((e) => e.message).join(', ')}`
      );
    }
  }

  // Can only activate if definition is valid
  if (params.status === 'active') {
    const rhizaDefinition = toRhizaDefinition({ ...current, properties });
    const validation = validateRhiza(rhizaDefinition);
    if (!validation.valid) {
      throw new ValidationError(
        `Cannot activate rhiza with validation errors: ${validation.errors.map((e) => e.message).join(', ')}`
      );
    }
  }

  const manifest: RhizaManifest = {
    ...current,
    properties,
    ver: current.ver + 1,
    ts: now,
    edited_by: params.edited_by,
  };

  const cid = await storage.writeManifest(manifest);
  await tip.writeTip(id, cid);

  return { id, cid, manifest, prev_cid: currentCid };
}

/**
 * Gather all agent IDs referenced in a rhiza
 */
export function gatherWorkflowAgents(
  kladoi: Record<string, any>
): string[] {
  const agents = new Set<string>();

  for (const spec of Object.values(kladoi)) {
    if (spec.action) {
      agents.add(spec.action);
    }
  }

  return Array.from(agents);
}
```

---

## New Routes

### `src/routes/rhizai.ts`

```typescript
/**
 * Rhiza (Workflow) Routes
 *
 * POST   /rhizai              - Create a rhiza
 * GET    /rhizai/:id          - Get rhiza by ID
 * PUT    /rhizai/:id          - Update rhiza
 * POST   /rhizai/:id/invoke   - Invoke a rhiza
 * GET    /rhizai/:id/jobs/:job_id/status - Get workflow status
 * POST   /rhizai/:id/jobs/:job_id/resume - Resume failed workflow
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { IManifestStorage, ITipService } from '@/core/storage/interfaces';
import {
  createRhiza,
  getRhiza,
  updateRhiza,
  gatherWorkflowAgents,
  toRhizaDefinition,
  RHIZA_TYPE,
} from '@/profiles/rhiza';
import { getAgent, grantAgentPermissions, invokeAgentEndpoint } from '@/profiles/agent';
import { createRootJobCollection } from '@/profiles/job_collection';
import { generateId } from '@/utils/ulid';
import { requireAuth, getActor } from '@/auth';
import { requireAction } from '@/permissions';
import { NotFoundError, ValidationError } from '@/errors';
import type { ExecutionContext } from '@/schema/operations';

export interface RhizaiRoutesConfig {
  storage: IManifestStorage;
  tip: ITipService;
  executionContext: ExecutionContext;
  signingPrivateKey: string;
}

export function createRhizaiRoutes(config: RhizaiRoutesConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { storage, tip, executionContext, signingPrivateKey } = config;

  // Require auth for all routes
  app.use('*', requireAuth);

  // ─────────────────────────────────────────────────────────────────────────
  // POST / - Create rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/', async (c) => {
    const actor = getActor(c);
    const body = await c.req.json();

    // Permission check on collection
    await requireAction(
      { storage, tip },
      actor.pi,
      { id: body.collection, type: 'collection' },
      'rhiza:create'
    );

    const result = await createRhiza(storage, tip, {
      id: body.id,
      label: body.label,
      description: body.description,
      version: body.version,
      entry: body.entry,
      kladoi: body.kladoi,
      collection: body.collection,
      edited_by: { user_id: actor.pi, method: 'manual' },
      note: body.note,
    }, executionContext);

    return c.json(result, 201);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /:id - Get rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);

    await requireAction({ storage, tip }, actor.pi, { id, type: RHIZA_TYPE }, 'rhiza:view');

    const { cid, manifest } = await getRhiza(storage, tip, id);

    return c.json({
      id: manifest.id,
      cid,
      type: manifest.type,
      properties: manifest.properties,
      relationships: manifest.relationships,
      ver: manifest.ver,
      created_at: manifest.created_at,
      ts: manifest.ts,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /:id - Update rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);
    const body = await c.req.json();

    await requireAction({ storage, tip }, actor.pi, { id, type: RHIZA_TYPE }, 'rhiza:update');

    const result = await updateRhiza(storage, tip, id, {
      expect_tip: body.expect_tip,
      label: body.label,
      description: body.description,
      version: body.version,
      status: body.status,
      entry: body.entry,
      kladoi: body.kladoi,
      edited_by: { user_id: actor.pi, method: 'manual' },
      note: body.note,
    }, executionContext);

    return c.json(result);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /:id/invoke - Invoke rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/:id/invoke', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);
    const body = await c.req.json();

    // Get rhiza
    const { manifest: rhizaManifest } = await getRhiza(storage, tip, id);

    if (rhizaManifest.properties.status !== 'active') {
      throw new HTTPException(400, {
        message: `Rhiza is not active (status: ${rhizaManifest.properties.status})`,
      });
    }

    // Permission check
    await requireAction({ storage, tip }, actor.pi, { id, type: RHIZA_TYPE }, 'rhiza:invoke');

    // Convert to definition
    const rhizaDefinition = toRhizaDefinition(rhizaManifest);

    // Get entry klados spec
    const entrySpec = rhizaDefinition.kladoi[rhizaDefinition.entry];
    if (!entrySpec) {
      throw new HTTPException(500, { message: 'Entry klados not found in rhiza' });
    }

    // Get entry agent
    const { manifest: agentManifest } = await getAgent(storage, tip, entrySpec.action);

    // Gather all agents in workflow
    const allAgentIds = gatherWorkflowAgents(rhizaDefinition.kladoi);

    // Build grant info for all agents
    const expiresIn = body.expires_in ?? 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Two-phase: preview vs confirmed
    if (!body.confirm) {
      // Preview mode - return grants that will be made
      const grants = await Promise.all(
        allAgentIds.map(async (agentId) => {
          const { manifest } = await getAgent(storage, tip, agentId);
          return {
            agent: { id: agentId, label: manifest.properties.label },
            actions: manifest.properties.actions_required,
          };
        })
      );

      return c.json({
        status: 'pending_confirmation',
        message: `Workflow "${rhizaManifest.properties.label}" will be granted access to target collection`,
        grants,
        expires_at: expiresAt,
      });
    }

    // Confirmed - grant permissions and invoke

    // Check collection:manage permission
    await requireAction(
      { storage, tip },
      actor.pi,
      { id: body.target, type: 'collection' },
      'collection:manage'
    );

    // Grant permissions to all agents
    const grantInfo = await Promise.all(
      allAgentIds.map(async (agentId) => {
        const { manifest } = await getAgent(storage, tip, agentId);
        return {
          agentId,
          actions: manifest.properties.actions_required,
          expiresAt,
        };
      })
    );

    await grantAgentPermissions(
      storage,
      tip,
      body.target,
      grantInfo,
      { user_id: actor.pi, method: 'system' },
      executionContext
    );

    // Create job collection
    const jobId = `job_${generateId()}`;
    const jobCollection = await createRootJobCollection(storage, tip, {
      jobId,
      invokingUserId: actor.pi,
      mainAgentId: entrySpec.action,
      targetCollectionId: body.target,
      rhizaId: id,  // NEW: link to rhiza
      editInfo: { user_id: actor.pi, method: 'system' },
    }, executionContext);

    // Build KladosRequest with RhizaContext
    const requestUrl = new URL(c.req.url);
    const arkeApiBase = `${requestUrl.protocol}//${requestUrl.host}`;
    const network = c.req.header('X-Arke-Network') === 'test' ? 'test' : 'main';

    const kladosRequest = {
      job_id: jobId,
      target: body.target,
      job_collection: jobCollection.id,
      input: body.input,
      api_base: arkeApiBase,
      expires_at: expiresAt,
      network,
      // NEW: Rhiza context
      rhiza: {
        id,
        definition: rhizaDefinition,
        position: rhizaDefinition.entry,
        log_chain: [],
      },
    };

    // Invoke entry agent with extended request
    const agentResponse = await invokeAgentEndpoint(
      agentManifest,
      {
        job_id: jobId,
        target: body.target,
        job_collection: jobCollection.id,
        input: {
          // Pass rhiza request as input for agent to extract
          __rhiza_request: kladosRequest,
          ...(body.input ?? {}),
        },
        api_base: arkeApiBase,
        expires_at: expiresAt,
        network,
      },
      signingPrivateKey
    );

    if (!agentResponse.accepted) {
      return c.json({
        status: 'rejected',
        error: agentResponse.error ?? 'Entry agent rejected the job',
      }, 202);
    }

    return c.json({
      status: 'started',
      job_id: jobId,
      job_collection: jobCollection.id,
      rhiza_id: id,
      expires_at: expiresAt,
    }, 202);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /:id/jobs/:job_id/status - Get workflow status
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/:id/jobs/:job_id/status', async (c) => {
    const rhizaId = c.req.param('id');
    const jobId = c.req.param('job_id');

    // Find job collection by job_id
    // ... implementation to query job collection and build status from log chain

    // Use rhiza package to build status
    // const status = await buildStatusFromLogs(client, jobCollectionId);

    return c.json({
      job_id: jobId,
      rhiza_id: rhizaId,
      status: 'running',  // Computed from log chain
      progress: { total: 0, pending: 0, running: 0, done: 0, error: 0 },
      // ... more fields
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /:id/jobs/:job_id/resume - Resume failed workflow
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/:id/jobs/:job_id/resume', async (c) => {
    const rhizaId = c.req.param('id');
    const jobId = c.req.param('job_id');
    const body = await c.req.json();

    // Find job collection
    // Use rhiza package to resume
    // const result = await resumeWorkflow(client, jobCollectionId, body);

    return c.json({
      resumed: 0,
      skipped: 0,
      jobs: [],
    });
  });

  return app;
}
```

---

## Schema Changes

### New Entity Type: `rhiza`

Add to entity type enum in schema.

### New Entity Type: `batch`

Already planned - type: 'batch' for scatter/gather coordination.

### New Relationship Predicates

| Predicate | Description |
|-----------|-------------|
| `received_from` | Log chain: child → parent |
| `handed_off_to` | Log chain: parent → children |
| `runs_rhiza` | Job collection → rhiza being executed |

### Job Collection Extensions

Add optional `rhiza_id` property to job collection for rhiza workflows.

---

## Permission Actions

### New Actions

| Action | Description |
|--------|-------------|
| `rhiza:create` | Create a rhiza |
| `rhiza:view` | View a rhiza |
| `rhiza:update` | Update a rhiza |
| `rhiza:invoke` | Invoke a rhiza |
| `rhiza:manage` | Full control |

---

## Migration Notes

1. **No breaking changes** - Existing agent system continues to work
2. **Parallel systems** - Rhizai and agents coexist
3. **Gradual adoption** - Can migrate workflows one at a time
4. **Shared infrastructure** - Uses same job collections, permissions, signing
