/**
 * Gather Tests
 *
 * Tests for gather (fan-in) operations that collect scattered outputs
 * and trigger the aggregator when complete.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  completeBatchSlot,
  errorBatchSlot,
  type BatchSlotResult,
} from '../../../handoff/gather';
import { createMockClient } from '../../fixtures/mock-client';
import { scatterGatherKladoi } from '../../fixtures/kladoi';
import type { ScatterBatchEntity, BatchSlot } from '../../../handoff/scatter';
import type { MockArkeClient } from '../../fixtures/mock-client';

describe('Gather', () => {
  let client: MockArkeClient;

  beforeEach(() => {
    client = createMockClient({
      kladoi: scatterGatherKladoi,
    });
  });

  function createTestBatch(total: number, completedSlots: number[] = []): ScatterBatchEntity {
    const slots: BatchSlot[] = [];
    for (let i = 0; i < total; i++) {
      if (completedSlots.includes(i)) {
        slots.push({
          status: 'complete',
          outputIds: [`result-${i}`],
        });
      } else {
        slots.push({ status: 'pending' });
      }
    }

    return {
      id: 'batch-test',
      rhizaId: 'II01rhiza_test',
      sourceKladosId: 'II01klados_producer',
      targetKladosId: 'II01klados_worker',
      gatherTargetId: 'II01klados_aggregator',
      parentJobId: 'job-root',
      total,
      completed: completedSlots.length,
      status: completedSlots.length === total ? 'complete' : 'pending',
      slots,
      createdAt: new Date().toISOString(),
    };
  }

  describe('completeBatchSlot', () => {
    it('updates slot to complete', async () => {
      const batch = createTestBatch(3);
      const outputIds = ['result-0'];

      const result = await completeBatchSlot(batch, 0, outputIds);

      expect(result.batch.slots[0].status).toBe('complete');
      expect(result.batch.slots[0].outputIds).toEqual(['result-0']);
    });

    it('increments completed count', async () => {
      const batch = createTestBatch(3);

      const result = await completeBatchSlot(batch, 0, ['result-0']);

      expect(result.batch.completed).toBe(1);
    });

    it('returns isLast: false when more slots pending', async () => {
      const batch = createTestBatch(3);

      const result = await completeBatchSlot(batch, 0, ['result-0']);

      expect(result.isLast).toBe(false);
    });

    it('returns isLast: true when all slots complete', async () => {
      const batch = createTestBatch(3, [0, 1]); // 2 already complete

      const result = await completeBatchSlot(batch, 2, ['result-2']);

      expect(result.isLast).toBe(true);
    });

    it('collects all outputs in slot order when last', async () => {
      const batch = createTestBatch(3, [0, 1]);
      // Slot 0 has result-0, slot 1 has result-1, we're completing slot 2

      const result = await completeBatchSlot(batch, 2, ['result-2']);

      expect(result.allOutputs).toBeDefined();
      expect(result.allOutputs).toHaveLength(3);
      // Should be in order
      expect(result.allOutputs![0]).toEqual(['result-0']);
      expect(result.allOutputs![1]).toEqual(['result-1']);
      expect(result.allOutputs![2]).toEqual(['result-2']);
    });

    it('updates batch status to complete when last', async () => {
      const batch = createTestBatch(3, [0, 1]);

      const result = await completeBatchSlot(batch, 2, ['result-2']);

      expect(result.batch.status).toBe('complete');
    });

    it('handles multiple outputs per slot', async () => {
      const batch = createTestBatch(2);
      const outputIds = ['result-0a', 'result-0b', 'result-0c'];

      const result = await completeBatchSlot(batch, 0, outputIds);

      expect(result.batch.slots[0].outputIds).toEqual(['result-0a', 'result-0b', 'result-0c']);
    });

    it('handles slots completing out of order', async () => {
      const batch = createTestBatch(3);

      // Complete slot 2 first
      const result1 = await completeBatchSlot(batch, 2, ['result-2']);
      expect(result1.isLast).toBe(false);

      // Complete slot 0
      const result2 = await completeBatchSlot(result1.batch, 0, ['result-0']);
      expect(result2.isLast).toBe(false);

      // Complete slot 1 (last)
      const result3 = await completeBatchSlot(result2.batch, 1, ['result-1']);
      expect(result3.isLast).toBe(true);

      // All outputs should be in slot order
      expect(result3.allOutputs![0]).toEqual(['result-0']);
      expect(result3.allOutputs![1]).toEqual(['result-1']);
      expect(result3.allOutputs![2]).toEqual(['result-2']);
    });

    it('handles single slot batch', async () => {
      const batch = createTestBatch(1);

      const result = await completeBatchSlot(batch, 0, ['only-result']);

      expect(result.isLast).toBe(true);
      expect(result.batch.completed).toBe(1);
      expect(result.allOutputs).toEqual([['only-result']]);
    });
  });

  describe('errorBatchSlot', () => {
    it('marks slot as error', async () => {
      const batch = createTestBatch(3);
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = await errorBatchSlot(batch, 1, error);

      expect(result.batch.slots[1].status).toBe('error');
      expect(result.batch.slots[1].error).toEqual(error);
    });

    it('does not increment completed count', async () => {
      const batch = createTestBatch(3);
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = await errorBatchSlot(batch, 1, error);

      expect(result.batch.completed).toBe(0);
    });

    it('marks batch as error when all slots terminal with at least one error', async () => {
      const batch = createTestBatch(3, [0, 1]); // 2 complete
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = await errorBatchSlot(batch, 2, error);

      expect(result.batch.status).toBe('error');
      expect(result.isTerminal).toBe(true);
    });

    it('does not mark batch as terminal when pending slots remain', async () => {
      const batch = createTestBatch(3, [0]); // 1 complete
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = await errorBatchSlot(batch, 1, error);

      expect(result.batch.status).toBe('pending');
      expect(result.isTerminal).toBe(false);
    });

    it('preserves retryable flag in error', async () => {
      const batch = createTestBatch(3);
      const error = { code: 'PERMANENT_ERROR', message: 'Invalid data', retryable: false };

      const result = await errorBatchSlot(batch, 0, error);

      expect(result.batch.slots[0].error?.retryable).toBe(false);
    });

    it('handles multiple errors across slots', async () => {
      let batch = createTestBatch(3);

      // Error on slot 0
      const result1 = await errorBatchSlot(batch, 0, { code: 'E1', message: 'Error 1', retryable: true });

      // Error on slot 1
      const result2 = await errorBatchSlot(result1.batch, 1, { code: 'E2', message: 'Error 2', retryable: false });

      // Complete slot 2 - batch should be terminal with error status
      const result3 = await completeBatchSlot(result2.batch, 2, ['result-2']);

      expect(result3.batch.status).toBe('error');
      expect(result3.batch.slots[0].status).toBe('error');
      expect(result3.batch.slots[1].status).toBe('error');
      expect(result3.batch.slots[2].status).toBe('complete');
    });

    it('collects error information when batch becomes terminal', async () => {
      const batch = createTestBatch(2, [0]); // 1 complete
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = await errorBatchSlot(batch, 1, error);

      expect(result.errors).toBeDefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toEqual({
        slotIndex: 1,
        error,
      });
    });
  });
});
