/**
 * Client Types
 *
 * Request/response types for the RhizaClient interface.
 * These define the exact API contracts for arke_v1 implementation.
 */

import type {
  KladosEntity,
  KladosProperties,
  RhizaEntity,
  RhizaProperties,
  KladosLogEntry,
  BatchEntity,
  BatchSlot,
  HandoffRecord,
} from '../types';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Standard API error
 */
export interface ApiError {
  message: string;
  code: string;
  details?: Record<string, unknown>;
}

/**
 * Validation error from entity creation/update
 */
export interface ValidationApiError extends ApiError {
  code: 'VALIDATION_ERROR';
  errors: Array<{
    code: string;
    message: string;
    field?: string;
  }>;
}

// ============================================================================
// Generic Entity Types
// ============================================================================

/**
 * Relationship to add during entity creation/update
 */
export interface RelationshipSpec {
  predicate: string;
  peer: string;
}

/**
 * Parameters for creating any entity
 */
export interface CreateEntityParams {
  collectionId: string;
  type: string;
  properties: Record<string, unknown>;
  relationships?: RelationshipSpec[];
}

/**
 * Parameters for updating any entity
 */
export interface UpdateEntityParams {
  /** CAS check - optional for mock, required for real API */
  expectTip?: string;
  properties?: Record<string, unknown>;
  relationshipsAdd?: RelationshipSpec[];
  relationshipsRemove?: RelationshipSpec[];
}

/**
 * Standard entity response
 */
export interface EntityResponse {
  id: string;
  cid: string;
  type: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Klados Types
// ============================================================================

/**
 * Parameters for creating a klados
 */
export interface CreateKladosParams {
  collectionId: string;
  properties: KladosProperties;
}

/**
 * Parameters for updating a klados
 */
export interface UpdateKladosParams {
  expectTip: string;
  label?: string;
  description?: string;
  endpoint?: string;
  actionsRequired?: string[];
  accepts?: KladosProperties['accepts'];
  produces?: KladosProperties['produces'];
  inputSchema?: Record<string, unknown>;
  status?: 'development' | 'active' | 'disabled';
}

/**
 * Rhiza context for workflow invocations
 */
export interface RhizaContext {
  id: string;
  path: string[];
  parentLogs: string[];
  batch?: {
    id: string;
    index: number;
    total: number;
  };
}

/**
 * Parameters for invoking a klados
 */
export interface InvokeKladosParams {
  /** Entity ID to process */
  target: string;
  /** Custom input data */
  input?: Record<string, unknown>;
  /** Skip confirmation (default: false) */
  confirm?: boolean;
  /** Seconds until expiry (default: 3600) */
  expiresIn?: number;
  /** Existing job collection ID (workflow mode) */
  jobCollection?: string;
  /** Workflow context from parent klados */
  rhizaContext?: RhizaContext;
}

// ============================================================================
// Rhiza Types
// ============================================================================

/**
 * Parameters for creating a rhiza
 */
export interface CreateRhizaParams {
  collectionId: string;
  properties: RhizaProperties;
}

/**
 * Parameters for updating a rhiza
 */
export interface UpdateRhizaParams {
  expectTip: string;
  label?: string;
  description?: string;
  version?: string;
  entry?: string;
  flow?: RhizaProperties['flow'];
  status?: 'development' | 'active' | 'disabled';
}

/**
 * Parameters for invoking a rhiza workflow
 */
export interface InvokeRhizaParams {
  /** Entity ID to process */
  target: string;
  /** Custom input data */
  input?: Record<string, unknown>;
  /** Skip confirmation (default: false) */
  confirm?: boolean;
  /** Seconds until expiry (default: 3600) */
  expiresIn?: number;
}

// ============================================================================
// Invoke Response Types
// ============================================================================

/**
 * Grant information for confirmation
 */
export interface GrantInfo {
  type: 'klados' | 'rhiza';
  id: string;
  label: string;
  actions?: string[];
}

/**
 * Response when confirmation is needed
 */
export interface InvokePendingResponse {
  status: 'pending_confirmation';
  message: string;
  grants: GrantInfo[];
  expiresAt: string;
}

/**
 * Response when invocation started
 */
export interface InvokeStartedResponse {
  status: 'started';
  jobId: string;
  jobCollection: string;
  kladosId?: string;
  rhizaId?: string;
  expiresAt: string;
}

/**
 * Response when invocation was rejected
 */
export interface InvokeRejectedResponse {
  status: 'rejected';
  error: string;
  jobId?: string;
}

/**
 * Union of all invoke responses
 */
export type InvokeResponse =
  | InvokePendingResponse
  | InvokeStartedResponse
  | InvokeRejectedResponse;

// ============================================================================
// Workflow Status Types
// ============================================================================

/**
 * Progress counters for workflow status
 */
export interface ProgressCounters {
  total: number;
  pending: number;
  running: number;
  done: number;
  error: number;
}

/**
 * Error info in workflow status
 */
export interface WorkflowErrorInfo {
  kladosId: string;
  jobId: string;
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Workflow status response
 */
export interface WorkflowStatusResponse {
  jobId: string;
  rhizaId: string;
  status: 'pending' | 'running' | 'done' | 'error';
  progress: ProgressCounters;
  currentKladoi?: string[];
  errors?: WorkflowErrorInfo[];
  startedAt: string;
  completedAt?: string;
}

// ============================================================================
// Resume Types
// ============================================================================

/**
 * Parameters for resuming a workflow
 */
export interface ResumeParams {
  /** Limit how many to resume */
  maxJobs?: number;
  /** Only resume specific jobs */
  jobIds?: string[];
}

/**
 * Information about a single resumed job
 */
export interface ResumedJobInfo {
  originalJobId: string;
  newJobId: string;
  kladosId: string;
  errorLogId: string;
  targetEntityId: string;
}

/**
 * Resume workflow response
 */
export interface ResumeResponse {
  resumed: number;
  skipped: number;
  jobs: ResumedJobInfo[];
}

// ============================================================================
// Log Types
// ============================================================================

/**
 * Error info for log entries
 */
export interface LogErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Parameters for creating a log entry
 */
export interface CreateLogParams {
  jobCollectionId: string;
  kladosId: string;
  rhizaId?: string;
  jobId: string;
  received: {
    target: string;
    input?: Record<string, unknown>;
    invocation?: {
      request: Record<string, unknown>;
      timestamp: string;
      signature?: string;
    };
    fromLogs?: string[];
  };
  parentLogIds?: string[];
}

/**
 * Parameters for updating a log entry
 */
export interface UpdateLogParams {
  expectTip?: string;
  status?: 'running' | 'done' | 'error';
  completedAt?: string;
  produced?: {
    entities?: string[];
    output?: Record<string, unknown>;
    routeKey?: string;
  };
  error?: LogErrorInfo;
  handoffs?: HandoffRecord[];
}

// ============================================================================
// Batch Types
// ============================================================================

/**
 * Parameters for creating a scatter batch
 */
export interface CreateBatchParams {
  jobCollectionId: string;
  scatterFrom: string;
  gatherTarget: string;
  totalSlots: number;
  slots: BatchSlot[];
}

/**
 * Parameters for updating a batch
 */
export interface UpdateBatchParams {
  expectTip?: string;
  properties: Partial<{
    completedSlots: number;
    status: 'pending' | 'complete' | 'error';
    slots: BatchSlot[];
    completedAt: string;
    error: LogErrorInfo;
  }>;
}

// ============================================================================
// Verification Types
// ============================================================================

/**
 * Response for verification phase 1 (get token)
 */
export interface VerifyTokenResponse {
  verificationToken: string;
  kladosId: string;
  endpoint: string;
  instructions: string;
  expiresAt: string;
}

/**
 * Response for verification phase 2 (success)
 */
export interface VerifySuccessResponse {
  verified: true;
  verifiedAt: string;
}

/**
 * Response for verification phase 2 (failure)
 */
export interface VerifyFailureResponse {
  verified: false;
  error:
    | 'no_token'
    | 'token_expired'
    | 'fetch_failed'
    | 'invalid_response'
    | 'token_mismatch'
    | 'agent_id_mismatch';
  message: string;
}

/**
 * Union of verify responses
 */
export type VerifyResponse =
  | VerifyTokenResponse
  | VerifySuccessResponse
  | VerifyFailureResponse;

// ============================================================================
// Re-export entity types for convenience
// ============================================================================

export type {
  KladosEntity,
  KladosProperties,
  RhizaEntity,
  RhizaProperties,
  KladosLogEntry,
  BatchEntity,
  BatchSlot,
  HandoffRecord,
};
