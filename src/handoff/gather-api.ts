/**
 * Gather API Utilities
 *
 * SDK utilities for completing batch slots with CAS retry.
 * Uses the SDK's withCasRetry for atomic updates.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import { withCasRetry } from '@arke-institute/sdk';
import type { BatchEntity, BatchProperties } from '../types';
import { completeBatchSlot, errorBatchSlot, type SlotError } from './gather';

/**
 * Result of completing a batch slot with CAS
 */
export interface GatherSlotResult {
  /** Updated batch entity */
  batch: BatchEntity;

  /** Whether this was the last slot to complete (triggers gather) */
  isLast: boolean;

  /** All outputs in slot order (only if isLast is true) */
  allOutputs?: string[][];

  /** Number of CAS retry attempts */
  attempts: number;
}

/**
 * Result of erroring a batch slot with CAS
 */
export interface GatherSlotErrorResult {
  /** Updated batch entity */
  batch: BatchEntity;

  /** Whether all slots are now terminal (complete or error) */
  isTerminal: boolean;

  /** Number of CAS retry attempts */
  attempts: number;
}

/**
 * Complete a batch slot with CAS retry
 *
 * Atomically updates the batch entity to mark a slot as complete.
 * If this is the last slot to complete successfully, returns all
 * outputs in slot order for the gather target.
 *
 * @param client - Arke client
 * @param batchId - Batch entity ID
 * @param slotIndex - Slot index to complete
 * @param outputIds - Output entity IDs produced by this slot
 * @returns Updated batch and whether this triggered gather
 */
export async function completeBatchSlotWithCAS(
  client: ArkeClient,
  batchId: string,
  slotIndex: number,
  outputIds: string[]
): Promise<GatherSlotResult> {
  let resultBatch: BatchEntity | null = null;
  let isLast = false;
  let allOutputs: string[][] | undefined;

  const { attempts } = await withCasRetry(
    {
      getTip: async () => {
        const { data, error } = await client.api.GET('/entities/{id}/tip', {
          params: { path: { id: batchId } },
        });
        if (error || !data) throw new Error('Failed to get batch tip');
        return data.cid;
      },
      update: async (tip: string) => {
        // Get current batch state
        const { data: entity, error: getError } = await client.api.GET('/entities/{id}', {
          params: { path: { id: batchId } },
        });

        if (getError || !entity) {
          throw new Error('Failed to get batch entity');
        }

        // Use pure function to compute new state
        const currentBatch: BatchEntity = {
          id: batchId,
          type: 'batch',
          properties: entity.properties as unknown as BatchProperties,
        };

        const result = completeBatchSlot(currentBatch, slotIndex, outputIds);

        // Store result for return value
        resultBatch = result.batch;
        isLast = result.isLast;
        allOutputs = result.allOutputs;

        // Update entity with new properties
        return client.api.PUT('/entities/{id}', {
          params: { path: { id: batchId } },
          body: {
            expect_tip: tip,
            properties: result.batch.properties as unknown as Record<string, unknown>,
          },
        });
      },
    },
    { concurrency: 100 }
  );

  if (!resultBatch) {
    throw new Error('Batch update failed - no result');
  }

  return {
    batch: resultBatch,
    isLast,
    allOutputs,
    attempts,
  };
}

/**
 * Mark a batch slot as errored with CAS retry
 *
 * Atomically updates the batch entity to mark a slot as errored.
 *
 * @param client - Arke client
 * @param batchId - Batch entity ID
 * @param slotIndex - Slot index that errored
 * @param error - Error information
 * @returns Updated batch and terminal status
 */
export async function errorBatchSlotWithCAS(
  client: ArkeClient,
  batchId: string,
  slotIndex: number,
  error: SlotError
): Promise<GatherSlotErrorResult> {
  let resultBatch: BatchEntity | null = null;
  let isTerminal = false;

  const { attempts } = await withCasRetry(
    {
      getTip: async () => {
        const { data, error } = await client.api.GET('/entities/{id}/tip', {
          params: { path: { id: batchId } },
        });
        if (error || !data) throw new Error('Failed to get batch tip');
        return data.cid;
      },
      update: async (tip: string) => {
        const { data: entity, error: getError } = await client.api.GET('/entities/{id}', {
          params: { path: { id: batchId } },
        });

        if (getError || !entity) {
          throw new Error('Failed to get batch entity');
        }

        const currentBatch: BatchEntity = {
          id: batchId,
          type: 'batch',
          properties: entity.properties as unknown as BatchProperties,
        };

        const result = errorBatchSlot(currentBatch, slotIndex, error);

        resultBatch = result.batch;
        isTerminal = result.isTerminal;

        return client.api.PUT('/entities/{id}', {
          params: { path: { id: batchId } },
          body: {
            expect_tip: tip,
            properties: result.batch.properties as unknown as Record<string, unknown>,
          },
        });
      },
    },
    { concurrency: 100 }
  );

  if (!resultBatch) {
    throw new Error('Batch update failed - no result');
  }

  return {
    batch: resultBatch,
    isTerminal,
    attempts,
  };
}
