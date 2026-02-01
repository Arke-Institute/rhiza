/**
 * Handoff Module
 *
 * Exports functions for handling workflow handoffs including routing,
 * target resolution, scatter/gather operations, and interpretation.
 */

export { evaluateWhere, matchRoute } from './route';
export { resolveTarget, discoverTargetType } from './target';
export {
  findGatherTarget,
  createScatterBatch,
  type ScatterBatchEntity,
  type BatchSlot,
  type BatchContext,
  type ScatterInvocation,
  type ScatterResult,
  type CreateScatterParams,
} from './scatter';

export {
  completeBatchSlot,
  errorBatchSlot,
  type SlotError,
  type BatchSlotResult,
  type BatchSlotErrorResult,
} from './gather';

export {
  interpretThen,
  type HandoffAction,
  type HandoffRecord,
  type InterpretContext,
  type InterpretResult,
} from './interpret';
