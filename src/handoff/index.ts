/**
 * Handoff Module
 *
 * Pure functions for handling workflow handoffs including routing,
 * target resolution, and scatter/gather slot management.
 * No API calls - workers should use SDK directly.
 */

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
