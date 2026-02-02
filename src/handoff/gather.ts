/**
 * Gather Operations
 *
 * Pure functions for fan-in (gather) operations that collect scattered outputs
 * and determine when all slots are complete for aggregation.
 */

import type { BatchEntity, BatchSlot, BatchProperties } from '../types/batch';

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
  batch: BatchEntity;
  isLast: boolean;
  allOutputs?: string[][];
}

/**
 * Result of erroring a batch slot
 */
export interface BatchSlotErrorResult {
  batch: BatchEntity;
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
        error: slots[i].error as SlotError,
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
export function completeBatchSlot(
  batch: BatchEntity,
  slotIndex: number,
  outputIds: string[]
): BatchSlotResult {
  const props = batch.properties;

  // Clone slots array
  const updatedSlots: BatchSlot[] = [...props.slots];

  // Update the slot
  updatedSlots[slotIndex] = {
    ...updatedSlots[slotIndex],
    status: 'complete',
    output_ids: outputIds,
    completed_at: new Date().toISOString(),
  };

  // Check if all slots are terminal
  const allTerminal = allSlotsTerminal(updatedSlots);
  const hasAnyErrors = hasErrors(updatedSlots);

  // Build updated properties
  const updatedProperties: BatchProperties = {
    ...props,
    slots: updatedSlots,
    completed: props.completed + 1,
    status: allTerminal ? (hasAnyErrors ? 'error' : 'complete') : props.status,
    completed_at: allTerminal ? new Date().toISOString() : undefined,
  };

  // Build updated batch
  const updatedBatch: BatchEntity = {
    ...batch,
    properties: updatedProperties,
  };

  // If this is the last slot (all complete, no errors), collect all outputs in order
  const isLast = allTerminal && !hasAnyErrors;
  let allOutputs: string[][] | undefined;

  if (isLast) {
    allOutputs = updatedSlots.map((slot) => slot.output_ids ?? []);
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
export function errorBatchSlot(
  batch: BatchEntity,
  slotIndex: number,
  error: SlotError
): BatchSlotErrorResult {
  const props = batch.properties;

  // Clone slots array
  const updatedSlots: BatchSlot[] = [...props.slots];

  // Update the slot with error
  updatedSlots[slotIndex] = {
    ...updatedSlots[slotIndex],
    status: 'error',
    error: {
      code: error.code,
      message: error.message,
    },
    completed_at: new Date().toISOString(),
  };

  // Check if all slots are terminal
  const allTerminal = allSlotsTerminal(updatedSlots);

  // Build updated properties
  const updatedProperties: BatchProperties = {
    ...props,
    slots: updatedSlots,
    status: allTerminal ? 'error' : props.status,
    completed_at: allTerminal ? new Date().toISOString() : undefined,
  };

  // Build updated batch
  const updatedBatch: BatchEntity = {
    ...batch,
    properties: updatedProperties,
  };

  // Collect errors if terminal
  let errors: Array<{ slotIndex: number; error: SlotError }> | undefined;
  if (allTerminal) {
    errors = collectErrors(updatedSlots);
  }

  return {
    batch: updatedBatch,
    isTerminal: allTerminal,
    errors,
  };
}
