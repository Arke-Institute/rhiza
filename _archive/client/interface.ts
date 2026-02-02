/**
 * Rhiza Client Interface
 *
 * Abstract interface for Arke API operations needed by rhiza.
 * Both the real SDK client and mock client implement this interface.
 */

import type {
  ApiError,
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

/**
 * Result type for API operations
 */
export interface ApiResult<T> {
  data?: T;
  error?: ApiError;
}

/**
 * Abstract interface for Arke API operations needed by rhiza.
 *
 * This interface defines the consumer-driven contract that the API must implement.
 * The mock client serves as the specification, the SDK client as the real implementation.
 */
export interface RhizaClient {
  // =========================================================================
  // Entity Operations (use generic /entities endpoints)
  // =========================================================================

  /**
   * Get any entity by ID
   */
  getEntity<T = unknown>(id: string): Promise<ApiResult<T>>;

  /**
   * Get entity tip (CID) for CAS updates
   */
  getEntityTip(id: string): Promise<ApiResult<{ cid: string }>>;

  /**
   * Create an entity
   */
  createEntity(params: CreateEntityParams): Promise<ApiResult<EntityResponse>>;

  /**
   * Update an entity
   */
  updateEntity(
    id: string,
    params: UpdateEntityParams
  ): Promise<ApiResult<EntityResponse>>;

  // =========================================================================
  // Klados Operations (use /kladoi endpoints)
  // =========================================================================

  /**
   * Get klados entity with type checking
   */
  getKlados(id: string): Promise<ApiResult<KladosEntity>>;

  /**
   * Create klados (with validation)
   *
   * Server validates:
   * - endpoint is valid URL
   * - accepts/produces contracts are valid
   * - label is non-empty
   */
  createKlados(params: CreateKladosParams): Promise<ApiResult<KladosEntity>>;

  /**
   * Update klados (with validation)
   *
   * Special behavior:
   * - Changing endpoint clears endpoint_verified_at and resets status to 'development'
   * - Setting status='active' requires endpoint_verified_at to be set
   */
  updateKlados(
    id: string,
    params: UpdateKladosParams
  ): Promise<ApiResult<KladosEntity>>;

  /**
   * Invoke klados (standalone or workflow context)
   *
   * In standalone mode, creates a new job collection.
   * In workflow mode (with rhizaContext), uses existing job collection.
   */
  invokeKlados(
    id: string,
    params: InvokeKladosParams
  ): Promise<ApiResult<InvokeResponse>>;

  /**
   * Verify klados endpoint ownership
   *
   * Two-phase verification:
   * 1. Call without confirm to get verification token
   * 2. Call with confirm: true after endpoint returns the token
   */
  verifyKlados(
    id: string,
    params?: { confirm?: boolean }
  ): Promise<ApiResult<VerifyResponse>>;

  // =========================================================================
  // Rhiza Operations (use /rhizai endpoints)
  // =========================================================================

  /**
   * Get rhiza entity with type checking
   */
  getRhiza(id: string): Promise<ApiResult<RhizaEntity>>;

  /**
   * Create rhiza (with static validation)
   *
   * Server validates:
   * - entry is in flow
   * - all paths terminate
   * - no cycles
   * - all route rules have valid targets
   */
  createRhiza(params: CreateRhizaParams): Promise<ApiResult<RhizaEntity>>;

  /**
   * Update rhiza (with validation)
   */
  updateRhiza(
    id: string,
    params: UpdateRhizaParams
  ): Promise<ApiResult<RhizaEntity>>;

  /**
   * Invoke rhiza workflow
   *
   * Creates a job collection and starts the workflow from the entry klados.
   * Runtime validates all kladoi are verified before starting.
   */
  invokeRhiza(
    id: string,
    params: InvokeRhizaParams
  ): Promise<ApiResult<InvokeResponse>>;

  /**
   * Get workflow status
   *
   * Returns current execution state, progress counters, and any errors.
   */
  getWorkflowStatus(
    rhizaId: string,
    jobId: string
  ): Promise<ApiResult<WorkflowStatusResponse>>;

  /**
   * Resume failed workflow
   *
   * Re-invokes failed jobs that are marked as retryable.
   */
  resumeWorkflow(
    rhizaId: string,
    jobId: string,
    params?: ResumeParams
  ): Promise<ApiResult<ResumeResponse>>;

  // =========================================================================
  // Log Operations (use generic /entities for creation/update)
  // =========================================================================

  /**
   * Create a klados log entry
   *
   * Log entries track the execution of a klados invocation.
   */
  createLog(params: CreateLogParams): Promise<ApiResult<KladosLogEntry>>;

  /**
   * Update a log entry (add handoffs, change status)
   */
  updateLog(
    id: string,
    params: UpdateLogParams
  ): Promise<ApiResult<KladosLogEntry>>;

  /**
   * Get logs for a job collection
   */
  getJobLogs(jobCollectionId: string): Promise<ApiResult<KladosLogEntry[]>>;

  // =========================================================================
  // Batch Operations (for scatter/gather)
  // =========================================================================

  /**
   * Create a scatter batch entity
   */
  createBatch(params: CreateBatchParams): Promise<ApiResult<BatchEntity>>;

  /**
   * Update batch (complete/error slots)
   */
  updateBatch(
    id: string,
    params: UpdateBatchParams
  ): Promise<ApiResult<BatchEntity>>;

  /**
   * Get batch entity
   */
  getBatch(id: string): Promise<ApiResult<BatchEntity>>;
}
