/**
 * Gather Operations
 *
 * Handles fan-in (gather) operations that collect scattered outputs
 * and determine when all slots are complete for aggregation.
 */

import type { ScatterBatchEntity, BatchSlot } from './scatter';

/**
 * Error information for a failed slot
 */
export interface SlotError {
  code: string;
  message: string;
  retryable?: boolean;
}

/**
 * Result of completing a batch slot
 */
export interface BatchSlotResult {
  batch: ScatterBatchEntity;
  isLast: boolean;
  allOutputs?: string[][];
}

/**
 * Result of erroring a batch slot
 */
export interface BatchSlotErrorResult {
  batch: ScatterBatchEntity;
  isTerminal: boolean;
  errors?: Array<{ slotIndex: number; error: SlotError }>;
}

/**
 * Check if all slots are terminal (complete or error)
 */
function allSlotsTerminal(slots: BatchSlot[]): boolean {
  return slots.every((s) => s.status === 'complete' || s.status === 'error');
}

/**
 * Check if any slot has an error
 */
function hasErrors(slots: BatchSlot[]): boolean {
  return slots.some((s) => s.status === 'error');
}

/**
 * Collect all errors from slots
 */
function collectErrors(slots: BatchSlot[]): Array<{ slotIndex: number; error: SlotError }> {
  const errors: Array<{ slotIndex: number; error: SlotError }> = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].status === 'error' && slots[i].error) {
      errors.push({
        slotIndex: i,
        error: slots[i].error!,
      });
    }
  }
  return errors;
}

/**
 * Complete a batch slot with its outputs
 *
 * Updates the slot status and tracks completion. If this is the last slot,
 * collects all outputs in slot order for the gather target.
 *
 * @param batch - The batch entity
 * @param slotIndex - The slot index to complete
 * @param outputIds - The output entity IDs produced by this slot
 * @returns Updated batch and whether this was the last slot
 */
export async function completeBatchSlot(
  batch: ScatterBatchEntity,
  slotIndex: number,
  outputIds: string[]
): Promise<BatchSlotResult> {
  // Clone the batch to avoid mutation
  const updatedBatch: ScatterBatchEntity = {
    ...batch,
    slots: [...batch.slots],
  };

  // Update the slot
  updatedBatch.slots[slotIndex] = {
    status: 'complete',
    outputIds,
  };

  // Increment completed count
  updatedBatch.completed = batch.completed + 1;

  // Check if all slots are terminal
  const allTerminal = allSlotsTerminal(updatedBatch.slots);
  const hasAnyErrors = hasErrors(updatedBatch.slots);

  // Update batch status
  if (allTerminal) {
    updatedBatch.status = hasAnyErrors ? 'error' : 'complete';
  }

  // If this is the last slot, collect all outputs in order
  const isLast = allTerminal && !hasAnyErrors;
  let allOutputs: string[][] | undefined;

  if (isLast) {
    allOutputs = updatedBatch.slots.map((slot) => slot.outputIds ?? []);
  }

  return {
    batch: updatedBatch,
    isLast,
    allOutputs,
  };
}

/**
 * Mark a batch slot as errored
 *
 * Updates the slot status with error information. If all slots become terminal
 * (complete or error), marks the batch as terminal with error status.
 *
 * @param batch - The batch entity
 * @param slotIndex - The slot index that errored
 * @param error - The error information
 * @returns Updated batch and terminal status
 */
export async function errorBatchSlot(
  batch: ScatterBatchEntity,
  slotIndex: number,
  error: SlotError
): Promise<BatchSlotErrorResult> {
  // Clone the batch to avoid mutation
  const updatedBatch: ScatterBatchEntity = {
    ...batch,
    slots: [...batch.slots],
  };

  // Update the slot with error
  updatedBatch.slots[slotIndex] = {
    status: 'error',
    error,
  };

  // Check if all slots are terminal
  const allTerminal = allSlotsTerminal(updatedBatch.slots);

  // Update batch status if terminal
  if (allTerminal) {
    updatedBatch.status = 'error';
  }

  // Collect errors if terminal
  let errors: Array<{ slotIndex: number; error: SlotError }> | undefined;
  if (allTerminal) {
    errors = collectErrors(updatedBatch.slots);
  }

  return {
    batch: updatedBatch,
    isTerminal: allTerminal,
    errors,
  };
}
