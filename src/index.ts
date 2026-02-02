/**
 * @arke-institute/rhiza
 *
 * Types and pure logic library for Arke workflow protocol.
 * Workers use rhiza for types + pure logic, SDK for API calls.
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
