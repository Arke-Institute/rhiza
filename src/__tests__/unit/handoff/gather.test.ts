/**
 * Gather Tests
 *
 * Tests for gather (fan-in) operations that collect scattered outputs
 * and trigger the aggregator when complete.
 */

import { describe, it, expect } from 'vitest';
import { completeBatchSlot, errorBatchSlot } from '../../../handoff/gather';
import type { BatchEntity, BatchSlot } from '../../../types/batch';

describe('Gather', () => {
  function createTestBatch(total: number, completedSlots: number[] = []): BatchEntity {
    const slots: BatchSlot[] = [];
    for (let i = 0; i < total; i++) {
      if (completedSlots.includes(i)) {
        slots.push({
          index: i,
          status: 'complete',
          output_ids: [`result-${i}`],
        });
      } else {
        slots.push({ index: i, status: 'pending' });
      }
    }

    return {
      id: 'batch-test',
      type: 'batch',
      properties: {
        label: 'Scatter: test_producer -> worker (test)',
        rhiza_id: 'II01rhiza_test',
        job_id: 'job-root',
        source_klados: 'II01klados_producer',
        target_step: 'worker',
        gather_step: 'aggregator',
        gather_klados: 'II01klados_aggregator',
        total,
        completed: completedSlots.length,
        status: completedSlots.length === total ? 'complete' : 'pending',
        slots,
        created_at: new Date().toISOString(),
      },
    };
  }

  describe('completeBatchSlot', () => {
    it('updates slot to complete', () => {
      const batch = createTestBatch(3);
      const outputIds = ['result-0'];

      const result = completeBatchSlot(batch, 0, outputIds);

      expect(result.batch.properties.slots[0].status).toBe('complete');
      expect(result.batch.properties.slots[0].output_ids).toEqual(['result-0']);
    });

    it('increments completed count', () => {
      const batch = createTestBatch(3);

      const result = completeBatchSlot(batch, 0, ['result-0']);

      expect(result.batch.properties.completed).toBe(1);
    });

    it('returns isLast: false when more slots pending', () => {
      const batch = createTestBatch(3);

      const result = completeBatchSlot(batch, 0, ['result-0']);

      expect(result.isLast).toBe(false);
    });

    it('returns isLast: true when all slots complete', () => {
      const batch = createTestBatch(3, [0, 1]); // 2 already complete

      const result = completeBatchSlot(batch, 2, ['result-2']);

      expect(result.isLast).toBe(true);
    });

    it('collects all outputs in slot order when last', () => {
      const batch = createTestBatch(3, [0, 1]);
      // Slot 0 has result-0, slot 1 has result-1, we're completing slot 2

      const result = completeBatchSlot(batch, 2, ['result-2']);

      expect(result.allOutputs).toBeDefined();
      expect(result.allOutputs).toHaveLength(3);
      // Should be in order
      expect(result.allOutputs![0]).toEqual(['result-0']);
      expect(result.allOutputs![1]).toEqual(['result-1']);
      expect(result.allOutputs![2]).toEqual(['result-2']);
    });

    it('updates batch status to complete when last', () => {
      const batch = createTestBatch(3, [0, 1]);

      const result = completeBatchSlot(batch, 2, ['result-2']);

      expect(result.batch.properties.status).toBe('complete');
    });

    it('handles multiple outputs per slot', () => {
      const batch = createTestBatch(2);
      const outputIds = ['result-0a', 'result-0b', 'result-0c'];

      const result = completeBatchSlot(batch, 0, outputIds);

      expect(result.batch.properties.slots[0].output_ids).toEqual([
        'result-0a',
        'result-0b',
        'result-0c',
      ]);
    });

    it('handles slots completing out of order', () => {
      const batch = createTestBatch(3);

      // Complete slot 2 first
      const result1 = completeBatchSlot(batch, 2, ['result-2']);
      expect(result1.isLast).toBe(false);

      // Complete slot 0
      const result2 = completeBatchSlot(result1.batch, 0, ['result-0']);
      expect(result2.isLast).toBe(false);

      // Complete slot 1 (last)
      const result3 = completeBatchSlot(result2.batch, 1, ['result-1']);
      expect(result3.isLast).toBe(true);

      // All outputs should be in slot order
      expect(result3.allOutputs![0]).toEqual(['result-0']);
      expect(result3.allOutputs![1]).toEqual(['result-1']);
      expect(result3.allOutputs![2]).toEqual(['result-2']);
    });

    it('handles single slot batch', () => {
      const batch = createTestBatch(1);

      const result = completeBatchSlot(batch, 0, ['only-result']);

      expect(result.isLast).toBe(true);
      expect(result.batch.properties.completed).toBe(1);
      expect(result.allOutputs).toEqual([['only-result']]);
    });
  });

  describe('errorBatchSlot', () => {
    it('marks slot as error', () => {
      const batch = createTestBatch(3);
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = errorBatchSlot(batch, 1, error);

      expect(result.batch.properties.slots[1].status).toBe('error');
      expect(result.batch.properties.slots[1].error).toEqual({
        code: 'PROCESSING_FAILED',
        message: 'Timeout',
      });
    });

    it('does not increment completed count', () => {
      const batch = createTestBatch(3);
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = errorBatchSlot(batch, 1, error);

      expect(result.batch.properties.completed).toBe(0);
    });

    it('marks batch as error when all slots terminal with at least one error', () => {
      const batch = createTestBatch(3, [0, 1]); // 2 complete
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = errorBatchSlot(batch, 2, error);

      expect(result.batch.properties.status).toBe('error');
      expect(result.isTerminal).toBe(true);
    });

    it('does not mark batch as terminal when pending slots remain', () => {
      const batch = createTestBatch(3, [0]); // 1 complete
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = errorBatchSlot(batch, 1, error);

      expect(result.batch.properties.status).toBe('pending');
      expect(result.isTerminal).toBe(false);
    });

    it('handles multiple errors across slots', () => {
      const batch = createTestBatch(3);

      // Error on slot 0
      const result1 = errorBatchSlot(batch, 0, {
        code: 'E1',
        message: 'Error 1',
        retryable: true,
      });

      // Error on slot 1
      const result2 = errorBatchSlot(result1.batch, 1, {
        code: 'E2',
        message: 'Error 2',
        retryable: false,
      });

      // Complete slot 2 - batch should be terminal with error status
      const result3 = completeBatchSlot(result2.batch, 2, ['result-2']);

      expect(result3.batch.properties.status).toBe('error');
      expect(result3.batch.properties.slots[0].status).toBe('error');
      expect(result3.batch.properties.slots[1].status).toBe('error');
      expect(result3.batch.properties.slots[2].status).toBe('complete');
    });

    it('collects error information when batch becomes terminal', () => {
      const batch = createTestBatch(2, [0]); // 1 complete
      const error = { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true };

      const result = errorBatchSlot(batch, 1, error);

      expect(result.errors).toBeDefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].slotIndex).toBe(1);
      expect(result.errors![0].error.code).toBe('PROCESSING_FAILED');
    });
  });
});
