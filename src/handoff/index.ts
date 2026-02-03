/**
 * Handoff Module
 *
 * Combines pure functions for routing and target resolution with
 * SDK utilities for executing handoffs.
 */

// ============================================================================
// Pure functions (no SDK dependency)
// ============================================================================

export { evaluateWhere, matchRoute } from './route';
export { resolveTarget } from './target';
export { findGatherTarget } from './scatter';
export {
  completeBatchSlot,
  errorBatchSlot,
  type SlotError,
  type BatchSlotResult,
  type BatchSlotErrorResult,
} from './gather';

// ============================================================================
// SDK utilities (require @arke-institute/sdk)
// ============================================================================

// Invocation
export {
  discoverTargetType,
  invokeTarget,
  invokeKlados,
  invokeRhiza,
} from './invoke';
export type { InvokeOptions, InvokeResult } from './invoke';

// Scatter API
export { createScatterBatch } from './scatter-api';
export type { CreateScatterOptions, ScatterResult } from './scatter-api';

// Gather API
export { completeBatchSlotWithCAS, errorBatchSlotWithCAS } from './gather-api';
export type { GatherSlotResult, GatherSlotErrorResult } from './gather-api';

// Orchestration
export { interpretThen } from './interpret';
export type {
  HandoffAction,
  InterpretContext,
  InterpretResult,
} from './interpret';
