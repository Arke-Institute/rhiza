/**
 * Mock Rhiza Client
 *
 * In-memory implementation of the RhizaClient interface.
 * This serves as the API specification - it defines exactly what the
 * real API endpoints should do.
 *
 * Use this for:
 * - Unit tests
 * - Development without network
 * - API contract specification
 */

import type { RhizaClient, ApiResult } from './interface';
import type {
  CreateEntityParams,
  UpdateEntityParams,
  EntityResponse,
  CreateKladosParams,
  UpdateKladosParams,
  InvokeKladosParams,
  CreateRhizaParams,
  UpdateRhizaParams,
  InvokeRhizaParams,
  InvokeResponse,
  WorkflowStatusResponse,
  ResumeParams,
  ResumeResponse,
  CreateLogParams,
  UpdateLogParams,
  CreateBatchParams,
  UpdateBatchParams,
  VerifyResponse,
  KladosEntity,
  RhizaEntity,
  KladosLogEntry,
  BatchEntity,
} from './types';
import { validateKladosProperties } from '../validation/validate-klados';
import { validateRhizaProperties } from '../validation/validate-rhiza';
import { buildStatusFromLogs } from '../status';
import { findErrorLeaves } from '../traverse';

// ============================================================================
// Mock Storage Types
// ============================================================================

interface StoredEntity {
  id: string;
  cid: string;
  type: string;
  properties: Record<string, unknown>;
  collectionId: string;
  relationships: Array<{ predicate: string; peer: string }>;
  createdAt: string;
  updatedAt: string;
}

interface PendingVerification {
  token: string;
  kladosId: string;
  endpoint: string;
  expiresAt: Date;
}

interface MockClientConfig {
  /** Pre-seed entities (keyed by ID) */
  entities?: Record<string, StoredEntity>;
  /** Enable logging for debugging */
  debug?: boolean;
}

// ============================================================================
// Helper function for safe type conversion
// ============================================================================

function asError<T>(result: ApiResult<unknown>): ApiResult<T> {
  return { error: result.error };
}

// ============================================================================
// Mock Client Implementation
// ============================================================================

/**
 * In-memory mock implementation of RhizaClient.
 *
 * This implementation defines the expected API behavior.
 * The real API should match this behavior exactly.
 */
export class MockRhizaClient implements RhizaClient {
  private entities: Map<string, StoredEntity> = new Map();
  private collections: Map<string, Set<string>> = new Map();
  private pendingVerifications: Map<string, PendingVerification> = new Map();
  private debug: boolean;
  private idCounter = 0;

  constructor(config: MockClientConfig = {}) {
    this.debug = config.debug ?? false;

    // Seed initial entities
    if (config.entities) {
      for (const [id, entity] of Object.entries(config.entities)) {
        this.entities.set(id, entity);
        this.addToCollection(entity.collectionId, id);
      }
    }
  }

  // =========================================================================
  // Entity Operations
  // =========================================================================

  async getEntity<T = unknown>(id: string): Promise<ApiResult<T>> {
    const entity = this.entities.get(id);
    if (!entity) {
      return { error: { code: 'NOT_FOUND', message: `Entity ${id} not found` } };
    }
    return { data: this.toEntityResponse(entity) as unknown as T };
  }

  async getEntityTip(id: string): Promise<ApiResult<{ cid: string }>> {
    const entity = this.entities.get(id);
    if (!entity) {
      return { error: { code: 'NOT_FOUND', message: `Entity ${id} not found` } };
    }
    return { data: { cid: entity.cid } };
  }

  async createEntity(
    params: CreateEntityParams
  ): Promise<ApiResult<EntityResponse>> {
    const id = this.generateId(params.type);
    const now = new Date().toISOString();
    const cid = this.generateCid();

    const entity: StoredEntity = {
      id,
      cid,
      type: params.type,
      properties: params.properties,
      collectionId: params.collectionId,
      relationships: params.relationships ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.entities.set(id, entity);
    this.addToCollection(params.collectionId, id);

    this.log('createEntity', { id, type: params.type });
    return { data: this.toEntityResponse(entity) };
  }

  async updateEntity(
    id: string,
    params: UpdateEntityParams
  ): Promise<ApiResult<EntityResponse>> {
    const entity = this.entities.get(id);
    if (!entity) {
      return { error: { code: 'NOT_FOUND', message: `Entity ${id} not found` } };
    }

    // CAS check (optional for mock)
    if (params.expectTip && entity.cid !== params.expectTip) {
      return {
        error: {
          code: 'CAS_CONFLICT',
          message: `Expected tip ${params.expectTip}, but current is ${entity.cid}`,
        },
      };
    }

    // Update properties
    if (params.properties) {
      entity.properties = { ...entity.properties, ...params.properties };
    }

    // Update relationships
    if (params.relationshipsAdd) {
      entity.relationships.push(...params.relationshipsAdd);
    }
    if (params.relationshipsRemove) {
      const removeSet = new Set(
        params.relationshipsRemove.map((r) => `${r.predicate}:${r.peer}`)
      );
      entity.relationships = entity.relationships.filter(
        (r) => !removeSet.has(`${r.predicate}:${r.peer}`)
      );
    }

    // Update metadata
    entity.cid = this.generateCid();
    entity.updatedAt = new Date().toISOString();

    this.log('updateEntity', { id });
    return { data: this.toEntityResponse(entity) };
  }

  // =========================================================================
  // Klados Operations
  // =========================================================================

  async getKlados(id: string): Promise<ApiResult<KladosEntity>> {
    const entity = this.entities.get(id);
    if (!entity) {
      return { error: { code: 'NOT_FOUND', message: `Entity ${id} not found` } };
    }

    if (entity.type !== 'klados') {
      return {
        error: {
          code: 'TYPE_MISMATCH',
          message: `Entity ${id} is not a klados`,
        },
      };
    }

    // Build KladosEntity from stored entity
    return {
      data: {
        id: entity.id,
        cid: entity.cid,
        type: 'klados',
        properties: entity.properties,
      } as unknown as KladosEntity,
    };
  }

  async createKlados(
    params: CreateKladosParams
  ): Promise<ApiResult<KladosEntity>> {
    // Validate klados properties
    const validation = validateKladosProperties(params.properties);
    if (!validation.valid) {
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors[0].message,
          details: { errors: validation.errors },
        },
      };
    }

    // Create the entity
    const result = await this.createEntity({
      collectionId: params.collectionId,
      type: 'klados',
      properties: {
        ...params.properties,
        status: 'development',
        created_at: new Date().toISOString(),
      },
    });

    if (result.error) return asError(result);

    this.log('createKlados', { id: result.data!.id });
    return {
      data: {
        id: result.data!.id,
        cid: result.data!.cid,
        type: 'klados',
        properties: result.data!.properties,
      } as unknown as KladosEntity,
    };
  }

  async updateKlados(
    id: string,
    params: UpdateKladosParams
  ): Promise<ApiResult<KladosEntity>> {
    const current = await this.getKlados(id);
    if (current.error) return current;

    const currentProps = current.data!.properties as unknown as Record<string, unknown>;
    const properties: Record<string, unknown> = {};

    // Map params to property updates
    if (params.label !== undefined) properties.label = params.label;
    if (params.description !== undefined)
      properties.description = params.description;
    if (params.actionsRequired !== undefined)
      properties.actions_required = params.actionsRequired;
    if (params.accepts !== undefined) properties.accepts = params.accepts;
    if (params.produces !== undefined) properties.produces = params.produces;
    if (params.inputSchema !== undefined)
      properties.input_schema = params.inputSchema;

    // Special handling for endpoint change
    if (
      params.endpoint !== undefined &&
      params.endpoint !== currentProps.endpoint
    ) {
      properties.endpoint = params.endpoint;
      properties.endpoint_verified_at = null;
      properties.status = 'development';
    }

    // Status change validation
    if (params.status !== undefined) {
      if (params.status === 'active' && !currentProps.endpoint_verified_at) {
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot set status to active without verified endpoint',
          },
        };
      }
      properties.status = params.status;
    }

    const result = await this.updateEntity(id, {
      expectTip: params.expectTip,
      properties,
    });

    if (result.error) return asError(result);

    this.log('updateKlados', { id });
    return this.getKlados(id);
  }

  async invokeKlados(
    id: string,
    params: InvokeKladosParams
  ): Promise<ApiResult<InvokeResponse>> {
    const klados = await this.getKlados(id);
    if (klados.error) return asError(klados);

    const kladosProps = klados.data!.properties as unknown as Record<string, unknown>;

    // Check if klados is active (or skip in mock for testing)
    // In production, this would require status === 'active'

    // Handle confirmation flow
    if (!params.confirm) {
      return {
        data: {
          status: 'pending_confirmation',
          message: `Klados "${kladosProps.label}" requires confirmation`,
          grants: [
            {
              type: 'klados',
              id,
              label: String(kladosProps.label),
              actions: kladosProps.actions_required as string[],
            },
          ],
          expiresAt: new Date(
            Date.now() + (params.expiresIn ?? 3600) * 1000
          ).toISOString(),
        },
      };
    }

    // Generate job ID and collection
    const jobId = this.generateId('job');
    const jobCollection =
      params.jobCollection ?? this.generateId('job_collection');

    // In a real implementation, this would:
    // 1. Create a job collection if needed
    // 2. Create an initial log entry
    // 3. Make HTTP request to klados endpoint
    // 4. Return job info for tracking

    this.log('invokeKlados', { id, jobId, jobCollection });

    return {
      data: {
        status: 'started',
        jobId,
        jobCollection,
        kladosId: id,
        expiresAt: new Date(
          Date.now() + (params.expiresIn ?? 3600) * 1000
        ).toISOString(),
      },
    };
  }

  async verifyKlados(
    id: string,
    params?: { confirm?: boolean }
  ): Promise<ApiResult<VerifyResponse>> {
    const klados = await this.getKlados(id);
    if (klados.error) return asError(klados);

    const kladosProps = klados.data!.properties as unknown as Record<string, unknown>;

    if (!params?.confirm) {
      // Phase 1: Generate verification token
      const token = `vt_${this.generateId('verify')}`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      this.pendingVerifications.set(id, {
        token,
        kladosId: id,
        endpoint: String(kladosProps.endpoint),
        expiresAt,
      });

      return {
        data: {
          verificationToken: token,
          kladosId: id,
          endpoint: String(kladosProps.endpoint),
          instructions:
            'Return this token from your endpoint when called with verification=true',
          expiresAt: expiresAt.toISOString(),
        },
      };
    }

    // Phase 2: Confirm verification
    const pending = this.pendingVerifications.get(id);
    if (!pending) {
      return {
        data: {
          verified: false,
          error: 'no_token',
          message: 'No pending verification. Call without confirm first.',
        },
      };
    }

    if (new Date() > pending.expiresAt) {
      this.pendingVerifications.delete(id);
      return {
        data: {
          verified: false,
          error: 'token_expired',
          message: 'Verification token expired. Start again.',
        },
      };
    }

    // In real implementation: fetch endpoint and verify token response
    // For mock, we'll simulate success
    this.pendingVerifications.delete(id);

    const verifiedAt = new Date().toISOString();
    await this.updateEntity(id, {
      properties: {
        endpoint_verified_at: verifiedAt,
      },
    });

    return {
      data: {
        verified: true,
        verifiedAt,
      },
    };
  }

  // =========================================================================
  // Rhiza Operations
  // =========================================================================

  async getRhiza(id: string): Promise<ApiResult<RhizaEntity>> {
    const entity = this.entities.get(id);
    if (!entity) {
      return { error: { code: 'NOT_FOUND', message: `Entity ${id} not found` } };
    }

    if (entity.type !== 'rhiza') {
      return {
        error: { code: 'TYPE_MISMATCH', message: `Entity ${id} is not a rhiza` },
      };
    }

    return {
      data: {
        id: entity.id,
        cid: entity.cid,
        type: 'rhiza',
        properties: entity.properties,
      } as unknown as RhizaEntity,
    };
  }

  async createRhiza(
    params: CreateRhizaParams
  ): Promise<ApiResult<RhizaEntity>> {
    // Validate rhiza properties
    const validation = validateRhizaProperties(params.properties);
    if (!validation.valid) {
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.errors[0].message,
          details: { errors: validation.errors },
        },
      };
    }

    // Create the entity
    const result = await this.createEntity({
      collectionId: params.collectionId,
      type: 'rhiza',
      properties: {
        ...params.properties,
        status: 'development',
        created_at: new Date().toISOString(),
      },
    });

    if (result.error) return asError(result);

    this.log('createRhiza', { id: result.data!.id });
    return {
      data: {
        id: result.data!.id,
        cid: result.data!.cid,
        type: 'rhiza',
        properties: result.data!.properties,
      } as unknown as RhizaEntity,
    };
  }

  async updateRhiza(
    id: string,
    params: UpdateRhizaParams
  ): Promise<ApiResult<RhizaEntity>> {
    const current = await this.getRhiza(id);
    if (current.error) return current;

    const properties: Record<string, unknown> = {};

    if (params.label !== undefined) properties.label = params.label;
    if (params.description !== undefined)
      properties.description = params.description;
    if (params.version !== undefined) properties.version = params.version;
    if (params.entry !== undefined) properties.entry = params.entry;
    if (params.flow !== undefined) properties.flow = params.flow;
    if (params.status !== undefined) properties.status = params.status;

    // Validate if flow changed
    if (params.entry !== undefined || params.flow !== undefined) {
      const mergedProps = {
        ...current.data!.properties,
        ...properties,
      };
      const validation = validateRhizaProperties(
        mergedProps as Parameters<typeof validateRhizaProperties>[0]
      );
      if (!validation.valid) {
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.errors[0].message,
            details: { errors: validation.errors },
          },
        };
      }
    }

    const result = await this.updateEntity(id, {
      expectTip: params.expectTip,
      properties,
    });

    if (result.error) return asError(result);

    this.log('updateRhiza', { id });
    return this.getRhiza(id);
  }

  async invokeRhiza(
    id: string,
    params: InvokeRhizaParams
  ): Promise<ApiResult<InvokeResponse>> {
    const rhiza = await this.getRhiza(id);
    if (rhiza.error) return asError(rhiza);

    const rhizaProps = rhiza.data!.properties as unknown as Record<string, unknown>;

    // In production: runtime validation of all kladoi

    if (!params.confirm) {
      // Collect all grants (all kladoi in flow)
      const flow = rhizaProps.flow as Record<string, unknown>;
      const grants = Object.keys(flow).map((kladosId) => ({
        type: 'klados' as const,
        id: kladosId,
        label: kladosId, // Would be fetched from actual klados
      }));

      return {
        data: {
          status: 'pending_confirmation',
          message: `Workflow "${rhizaProps.label}" requires confirmation`,
          grants,
          expiresAt: new Date(
            Date.now() + (params.expiresIn ?? 3600) * 1000
          ).toISOString(),
        },
      };
    }

    const jobId = this.generateId('job');
    const jobCollection = this.generateId('job_collection');

    // In real implementation: start workflow execution from entry klados

    this.log('invokeRhiza', { id, jobId, jobCollection });

    return {
      data: {
        status: 'started',
        jobId,
        jobCollection,
        rhizaId: id,
        expiresAt: new Date(
          Date.now() + (params.expiresIn ?? 3600) * 1000
        ).toISOString(),
      },
    };
  }

  async getWorkflowStatus(
    _rhizaId: string,
    jobId: string
  ): Promise<ApiResult<WorkflowStatusResponse>> {
    // Find the job collection for this job
    const logs = await this.getJobLogs(jobId);
    if (logs.error) {
      return {
        error: {
          code: 'NOT_FOUND',
          message: `No logs found for job ${jobId}`,
        },
      };
    }

    if (!logs.data || logs.data.length === 0) {
      return {
        error: {
          code: 'NOT_FOUND',
          message: `No logs found for job ${jobId}`,
        },
      };
    }

    // Use buildStatusFromLogs to compute status
    const status = buildStatusFromLogs(logs.data);

    // Map status - handle 'unknown' case
    let mappedStatus: 'pending' | 'running' | 'done' | 'error' = 'running';
    if (
      status.status === 'done' ||
      status.status === 'error' ||
      status.status === 'running' ||
      status.status === 'pending'
    ) {
      mappedStatus = status.status;
    }

    return {
      data: {
        jobId,
        rhizaId: status.rhizaId,
        status: mappedStatus,
        progress: {
          total: status.progress.total,
          pending: status.progress.pending,
          running: status.progress.running,
          done: status.progress.done,
          error: status.progress.error,
        },
        currentKladoi: status.currentKladoi,
        errors: status.errors?.map((e) => ({
          kladosId: e.kladosId,
          jobId: e.jobId,
          code: e.code,
          message: e.message,
          retryable: e.retryable,
        })),
        startedAt: logs.data[0]?.started_at ?? new Date().toISOString(),
        completedAt:
          mappedStatus === 'done' || mappedStatus === 'error'
            ? new Date().toISOString()
            : undefined,
      },
    };
  }

  async resumeWorkflow(
    _rhizaId: string,
    jobId: string,
    params?: ResumeParams
  ): Promise<ApiResult<ResumeResponse>> {
    const logs = await this.getJobLogs(jobId);
    if (logs.error) {
      return {
        error: {
          code: 'NOT_FOUND',
          message: `No logs found for job ${jobId}`,
        },
      };
    }

    if (!logs.data || logs.data.length === 0) {
      return {
        data: {
          resumed: 0,
          skipped: 0,
          jobs: [],
        },
      };
    }

    // Find error leaves using traverse module
    const errorLeaves = findErrorLeaves(logs.data);

    // Filter by jobIds if provided
    let candidates = errorLeaves;
    if (params?.jobIds && params.jobIds.length > 0) {
      const jobIdSet = new Set(params.jobIds);
      candidates = errorLeaves.filter((e) => jobIdSet.has(e.log.job_id));
    }

    const result: ResumeResponse = {
      resumed: 0,
      skipped: 0,
      jobs: [],
    };

    for (const errorLeaf of candidates) {
      // Check maxJobs limit
      if (
        params?.maxJobs !== undefined &&
        result.resumed >= params.maxJobs
      ) {
        result.skipped++;
        continue;
      }

      // Skip non-retryable
      if (!errorLeaf.retryable) {
        result.skipped++;
        continue;
      }

      const newJobId = this.generateId('job_resumed');

      result.resumed++;
      result.jobs.push({
        originalJobId: errorLeaf.log.job_id,
        newJobId,
        kladosId: errorLeaf.log.klados_id,
        errorLogId: errorLeaf.log.id,
        targetEntityId: String(errorLeaf.log.received?.target ?? ''),
      });
    }

    this.log('resumeWorkflow', { jobId, resumed: result.resumed });
    return { data: result };
  }

  // =========================================================================
  // Log Operations
  // =========================================================================

  async createLog(
    params: CreateLogParams
  ): Promise<ApiResult<KladosLogEntry>> {
    const id = this.generateId('log');
    const now = new Date().toISOString();

    // Build log entry - simplified for mock
    const logProperties: Record<string, unknown> = {
      id,
      klados_id: params.kladosId,
      rhiza_id: params.rhizaId,
      job_id: params.jobId,
      status: 'running',
      started_at: now,
      received: {
        target: params.received.target,
        input: params.received.input,
        from_logs: params.received.fromLogs,
      },
    };

    const result = await this.createEntity({
      collectionId: params.jobCollectionId,
      type: 'klados_log',
      properties: logProperties,
      relationships: params.parentLogIds?.map((parentId) => ({
        predicate: 'received_from',
        peer: parentId,
      })),
    });

    if (result.error) return asError(result);

    this.log('createLog', { id, kladosId: params.kladosId });
    return { data: logProperties as unknown as KladosLogEntry };
  }

  async updateLog(
    id: string,
    params: UpdateLogParams
  ): Promise<ApiResult<KladosLogEntry>> {
    const entity = this.entities.get(id);
    if (!entity) {
      return { error: { code: 'NOT_FOUND', message: `Log ${id} not found` } };
    }

    const properties: Record<string, unknown> = {};

    if (params.status !== undefined) properties.status = params.status;
    if (params.completedAt !== undefined)
      properties.completed_at = params.completedAt;
    if (params.produced !== undefined) properties.produced = params.produced;
    if (params.error !== undefined) properties.error = params.error;
    if (params.handoffs !== undefined) properties.handoffs = params.handoffs;

    const result = await this.updateEntity(id, {
      expectTip: params.expectTip,
      properties,
    });

    if (result.error) return asError(result);

    this.log('updateLog', { id, status: params.status });
    return {
      data: {
        ...entity.properties,
        ...properties,
      } as unknown as KladosLogEntry,
    };
  }

  async getJobLogs(
    jobCollectionId: string
  ): Promise<ApiResult<KladosLogEntry[]>> {
    const collectionEntities = this.collections.get(jobCollectionId);
    if (!collectionEntities) {
      return { data: [] };
    }

    const logs: KladosLogEntry[] = [];
    for (const entityId of collectionEntities) {
      const entity = this.entities.get(entityId);
      if (entity && entity.type === 'klados_log') {
        logs.push(entity.properties as unknown as KladosLogEntry);
      }
    }

    return { data: logs };
  }

  // =========================================================================
  // Batch Operations
  // =========================================================================

  async createBatch(
    params: CreateBatchParams
  ): Promise<ApiResult<BatchEntity>> {
    const result = await this.createEntity({
      collectionId: params.jobCollectionId,
      type: 'batch',
      properties: {
        scatter_from: params.scatterFrom,
        gather_target: params.gatherTarget,
        total_slots: params.totalSlots,
        completed_slots: 0,
        status: 'pending',
        slots: params.slots,
      },
    });

    if (result.error) return asError(result);

    this.log('createBatch', {
      id: result.data!.id,
      totalSlots: params.totalSlots,
    });
    return {
      data: {
        id: result.data!.id,
        cid: result.data!.cid,
        type: 'batch',
        properties: result.data!.properties,
      } as unknown as BatchEntity,
    };
  }

  async updateBatch(
    id: string,
    params: UpdateBatchParams
  ): Promise<ApiResult<BatchEntity>> {
    const current = await this.getBatch(id);
    if (current.error) return current;

    const properties: Record<string, unknown> = {};

    if (params.properties.completedSlots !== undefined)
      properties.completed_slots = params.properties.completedSlots;
    if (params.properties.status !== undefined)
      properties.status = params.properties.status;
    if (params.properties.slots !== undefined)
      properties.slots = params.properties.slots;
    if (params.properties.completedAt !== undefined)
      properties.completed_at = params.properties.completedAt;
    if (params.properties.error !== undefined)
      properties.error = params.properties.error;

    const result = await this.updateEntity(id, {
      expectTip: params.expectTip,
      properties,
    });

    if (result.error) return asError(result);

    this.log('updateBatch', { id, status: params.properties.status });
    return this.getBatch(id);
  }

  async getBatch(id: string): Promise<ApiResult<BatchEntity>> {
    const entity = this.entities.get(id);
    if (!entity) {
      return { error: { code: 'NOT_FOUND', message: `Entity ${id} not found` } };
    }

    if (entity.type !== 'batch') {
      return {
        error: { code: 'TYPE_MISMATCH', message: `Entity ${id} is not a batch` },
      };
    }

    return {
      data: {
        id: entity.id,
        cid: entity.cid,
        type: 'batch',
        properties: entity.properties,
      } as unknown as BatchEntity,
    };
  }

  // =========================================================================
  // Test Helpers (not part of interface)
  // =========================================================================

  /**
   * Reset all state (for testing)
   */
  reset(): void {
    this.entities.clear();
    this.collections.clear();
    this.pendingVerifications.clear();
    this.idCounter = 0;
  }

  /**
   * Get all entities of a type (for testing)
   */
  getEntitiesByType(type: string): StoredEntity[] {
    return Array.from(this.entities.values()).filter((e) => e.type === type);
  }

  /**
   * Seed an entity directly (for testing)
   */
  seedEntity(entity: StoredEntity): void {
    this.entities.set(entity.id, entity);
    this.addToCollection(entity.collectionId, entity.id);
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private generateId(prefix: string): string {
    this.idCounter++;
    return `${prefix}_mock_${this.idCounter}_${Date.now()}`;
  }

  private generateCid(): string {
    return `bafk_mock_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  private addToCollection(collectionId: string, entityId: string): void {
    let collection = this.collections.get(collectionId);
    if (!collection) {
      collection = new Set();
      this.collections.set(collectionId, collection);
    }
    collection.add(entityId);
  }

  private toEntityResponse(entity: StoredEntity): EntityResponse {
    return {
      id: entity.id,
      cid: entity.cid,
      type: entity.type,
      properties: entity.properties,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
  }

  private log(method: string, data: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[MockRhizaClient.${method}]`, data);
    }
  }
}

/**
 * Create a mock client with optional pre-seeded data
 */
export function createMockRhizaClient(
  config?: MockClientConfig
): MockRhizaClient {
  return new MockRhizaClient(config);
}
