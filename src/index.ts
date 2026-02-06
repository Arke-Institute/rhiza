/**
 * @arke-institute/rhiza
 *
 * Types, pure logic, and SDK utilities for Arke workflow protocol.
 * Workers use rhiza for types, validation, and workflow execution.
 *
 * Naming:
 * - Rhiza (ῥίζα) = root, the workflow definition
 * - Klados (κλάδος) = branch, an individual action
 *
 * The library provides:
 * - Types: Entity types, request/response types, log types
 * - Validation: Pure validation functions for klados/rhiza properties
 * - Handoff (pure): Route matching, target resolution, gather state transforms
 * - Handoff (SDK): Invocation, scatter/gather with CAS, orchestration
 * - Logging: In-memory logger and API writers
 * - Utilities: ID generation
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

// ============================================================================
// Handoff - Pure functions for route matching, target resolution, gather
// ============================================================================

export { evaluateWhere, matchRoute } from './handoff/route';
export { resolveTarget } from './handoff/target';
export { findGatherTarget } from './handoff/scatter';
export {
  completeBatchSlot,
  errorBatchSlot,
  type BatchSlotResult,
  type BatchSlotErrorResult,
  type SlotError,
} from './handoff/gather';

// ============================================================================
// Handoff - SDK utilities for execution (requires @arke-institute/sdk)
// ============================================================================

export {
  discoverTargetType,
  invokeTarget,
  invokeKlados,
  invokeRhiza,
  type InvokeOptions,
  type InvokeResult,
} from './handoff/invoke';

export {
  createScatterBatch,
  type CreateScatterOptions,
  type ScatterResult,
} from './handoff/scatter-api';

export {
  completeBatchSlotWithCAS,
  errorBatchSlotWithCAS,
  type GatherSlotResult,
  type GatherSlotErrorResult,
} from './handoff/gather-api';

export {
  interpretThen,
  type HandoffAction,
  type InterpretContext,
  type InterpretResult,
} from './handoff/interpret';

// ============================================================================
// Logging - In-memory logger and API writers
// ============================================================================

export { KladosLogger } from './logging/logger';
export {
  writeKladosLog,
  updateLogWithHandoffs,
  updateLogStatus,
  type WriteLogOptions,
  type WriteLogResult,
  type LogError,
} from './logging/writer';

// ============================================================================
// Worker Utilities - High-level abstractions for klados workers
// ============================================================================

export {
  KladosJob,
  type KladosJobConfig,
  type KladosJobResult,
  KladosErrorCode,
  type KladosErrorCodeType,
  type KladosError,
  createKladosError,
  toKladosError,
  isKladosError,
  failKlados,
  type FailKladosOptions,
} from './worker';

// ============================================================================
// Utilities
// ============================================================================

export { generateId } from './utils/id';

// ============================================================================
// Registration - Entity registration and management utilities
// ============================================================================

// Types
export type {
  Network,
  KeyStore,
  RegistrationState,
  KladosRegistrationState,
  RhizaRegistrationState,
  SyncResult,
  DryRunResult,
  ApiKeyInfo,
  ApiKeyCreateResult,
  ApiKeyRotateResult,
  KladosConfig,
  KladosSyncOptions,
  RhizaConfig,
  RhizaFlow,
  RhizaSyncOptions,
  VerificationConfig,
  VerificationResponse,
  VerificationHandlerResult,
  VerificationTokenResult,
  VerificationConfirmResult,
} from './registration';

// State utilities (pure)
export {
  SECRET_NAMES,
  readState,
  writeState,
  getStateFilePath,
  hashConfig,
  diffConfig,
  hasConfigChanged,
} from './registration';

// Verification helper (pure)
export {
  buildVerificationResponse,
  createVerificationHandler,
} from './registration';

// Collection utilities (SDK)
export { ensureCollection } from './registration';

// Klados registration (SDK)
export {
  syncKlados,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  requestVerification,
  confirmVerification,
  activateKlados,
  runVerificationFlow,
} from './registration';

// Rhiza registration (SDK)
export { syncRhiza } from './registration';
