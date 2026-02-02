/**
 * Client Module
 *
 * Exports the RhizaClient interface and all related types.
 */

// Interface
export type { RhizaClient, ApiResult } from './interface';

// Mock client
export { MockRhizaClient, createMockRhizaClient } from './mock';

// Request/Response types
export type {
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
  RhizaContext,
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
  ProgressCounters,
  WorkflowErrorInfo,
  WorkflowStatusResponse,

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
} from './types';

// Re-export entity types for convenience
export type {
  KladosEntity,
  KladosProperties,
  RhizaEntity,
  RhizaProperties,
  KladosLogEntry,
  BatchEntity,
  BatchSlot,
  HandoffRecord,
} from './types';
