/**
 * @arke-institute/rhiza
 *
 * Workflow protocol for Arke - cascading handoff pattern for distributed actions.
 *
 * Naming:
 * - Rhiza (ῥίζα) = root, the workflow definition
 * - Klados (κλάδος) = branch, an individual action
 */

// ============================================================================
// Types - Core entity and request/response types
// ============================================================================

// Klados entity types
export type {
  KladosEntity,
  KladosProperties,
  ContractSpec,
} from './types/klados';

// Rhiza entity types
export type {
  RhizaEntity,
  RhizaProperties,
  FlowStep,
  ThenSpec,
  RouteRule,
  WhereCondition,
  WhereEquals,
  WhereAnd,
  WhereOr,
} from './types/rhiza';

// Entity reference types
export type { EntityRef } from './types/refs';
export { isEntityRef, ref } from './types/refs';

// Request types
export type {
  KladosRequest,
  RhizaContext,
  BatchContext,
} from './types/request';

// Response types
export type {
  KladosResponse,
  KladosResult,
} from './types/response';

// Log types
export type {
  KladosLogEntry,
  HandoffRecord,
  InvocationRecord,
  LogMessage,
  JobLog,
} from './types/log';

// Batch types
export type {
  BatchEntity,
  BatchProperties,
  BatchSlot,
} from './types/batch';

// API Response types (for external consumers)
export type {
  WorkflowStatus as WorkflowStatusResponse,
  ProgressCounters as ProgressCountersResponse,
  LogChainEntry,
  ErrorSummary as ErrorSummaryResponse,
  ResumeResult as ResumeResultResponse,
  ResumedJob as ResumedJobResponse,
} from './types/status';

// ============================================================================
// Validation
// ============================================================================

export {
  validateKladosProperties,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
} from './validation/validate-klados';

export { validateRhizaProperties } from './validation/validate-rhiza';

export {
  validateRhizaRuntime,
  type RuntimeValidationResult,
} from './validation/validate-runtime';

// ============================================================================
// Handoff - Route matching, scatter/gather, interpretation
// ============================================================================

export { evaluateWhere, matchRoute } from './handoff/route';
export { resolveTarget, discoverTargetType } from './handoff/target';
export {
  findGatherTarget,
  createScatterBatch,
  type CreateScatterParams,
  type ScatterResult,
} from './handoff/scatter';
export {
  completeBatchSlot,
  errorBatchSlot,
  type BatchSlotResult,
  type BatchSlotErrorResult,
  type SlotError,
} from './handoff/gather';
export {
  interpretThen,
  type InterpretContext,
  type InterpretResult,
} from './handoff/interpret';

// ============================================================================
// Traverse - Log chain traversal utilities
// ============================================================================

export {
  findLeaves,
  findErrorLeaves,
  buildLogTree,
  type ErrorLeaf,
  type LogNode,
} from './traverse';

// ============================================================================
// Resume - Workflow resumption
// ============================================================================

export {
  resumeWorkflow,
  canResume,
  type ResumeOptions,
  type ResumedJob,
  type ResumeResult,
  type ErrorSummary,
  type CanResumeResult,
} from './resume';

// ============================================================================
// Status - Build status from logs
// ============================================================================

export {
  buildStatusFromLogs,
  type WorkflowStatusType,
  type ProgressCounters,
  type StatusError,
  type WorkflowStatus,
} from './status';

// Signature utilities (TODO: implement)
// export * from './signature';

// ============================================================================
// Client - API client interface and mock implementation
// ============================================================================

export type {
  // Interface and result type
  RhizaClient,
  ApiResult,

  // Error types
  ApiError,
  ValidationApiError,

  // Entity types
  RelationshipSpec,
  CreateEntityParams,
  UpdateEntityParams,
  EntityResponse,

  // Klados types
  CreateKladosParams,
  UpdateKladosParams,
  RhizaContext as ClientRhizaContext,
  InvokeKladosParams,

  // Rhiza types
  CreateRhizaParams,
  UpdateRhizaParams,
  InvokeRhizaParams,

  // Invoke responses
  GrantInfo,
  InvokePendingResponse,
  InvokeStartedResponse,
  InvokeRejectedResponse,
  InvokeResponse,

  // Workflow status
  ProgressCounters as ClientProgressCounters,
  WorkflowErrorInfo,
  WorkflowStatusResponse as ClientWorkflowStatusResponse,

  // Resume
  ResumeParams,
  ResumedJobInfo,
  ResumeResponse,

  // Log types
  LogErrorInfo,
  CreateLogParams,
  UpdateLogParams,

  // Batch types
  CreateBatchParams,
  UpdateBatchParams,

  // Verification
  VerifyTokenResponse,
  VerifySuccessResponse,
  VerifyFailureResponse,
  VerifyResponse,
} from './client';

export { MockRhizaClient, createMockRhizaClient } from './client';
