/**
 * Scatter Tests
 *
 * Tests for scatter (fan-out) operations that split a producer's outputs
 * into individual invocations of a worker klados.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { findGatherTarget, createScatterBatch } from '../../../handoff/scatter';
import { createMockClient } from '../../fixtures/mock-client';
import { scatterGatherKladoi } from '../../fixtures/kladoi';
import { scatterGatherFlow } from '../../fixtures/rhizai';
import type { FlowStep } from '../../../types';
import type { MockArkeClient } from '../../fixtures/mock-client';

describe('Scatter', () => {
  describe('findGatherTarget', () => {
    it('finds gather target from scatter klados flow step', () => {
      const flow = scatterGatherFlow;

      const result = findGatherTarget(flow, 'II01klados_worker');

      expect(result).toBe('II01klados_aggregator');
    });

    it('returns gather target when step has gather handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { gather: 'custom_aggregator' } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBe('custom_aggregator');
    });

    it('returns null when target not in flow', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { gather: 'aggregator' } },
      };

      const result = findGatherTarget(flow, 'nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when target has done handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { done: true } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });

    it('returns null when target has pass handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { pass: 'next_step' } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });

    it('returns null when target has scatter handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { scatter: 'sub_worker' } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });
  });

  describe('createScatterBatch', () => {
    let client: MockArkeClient;

    beforeEach(() => {
      client = createMockClient({
        kladoi: scatterGatherKladoi,
      });
    });

    it('creates batch entity with correct properties', async () => {
      const outputs = ['item-1', 'item-2', 'item-3'];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      expect(result.batch).toBeDefined();
      expect(result.batch.total).toBe(3);
      expect(result.batch.completed).toBe(0);
      expect(result.batch.status).toBe('pending');
      expect(result.batch.slots).toHaveLength(3);
      expect(result.batch.slots.every((s) => s.status === 'pending')).toBe(true);
    });

    it('invokes target klados once per output', async () => {
      const outputs = ['item-1', 'item-2', 'item-3', 'item-4', 'item-5'];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      expect(result.invocations).toHaveLength(5);

      // Check that mock client recorded invocations
      const invokedKladoi = client.getInvokedKladoi();
      expect(invokedKladoi).toHaveLength(5);
      expect(invokedKladoi.every((i) => i.kladosId === 'II01klados_worker')).toBe(true);
    });

    it('passes batch context to each invocation', async () => {
      const outputs = ['item-1', 'item-2', 'item-3'];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      // Each invocation should have batch context with index and total
      for (let i = 0; i < 3; i++) {
        const invocation = result.invocations[i];
        expect(invocation.batchContext).toBeDefined();
        expect(invocation.batchContext?.batchId).toBe(result.batch.id);
        expect(invocation.batchContext?.index).toBe(i);
        expect(invocation.batchContext?.total).toBe(3);
      }
    });

    it('returns all invocation records', async () => {
      const outputs = ['item-1', 'item-2', 'item-3'];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      expect(result.invocations).toHaveLength(3);
      expect(result.invocations[0].targetEntityId).toBe('item-1');
      expect(result.invocations[1].targetEntityId).toBe('item-2');
      expect(result.invocations[2].targetEntityId).toBe('item-3');
    });

    it('handles empty outputs array', async () => {
      const outputs: string[] = [];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      expect(result.batch.total).toBe(0);
      expect(result.batch.slots).toHaveLength(0);
      expect(result.invocations).toHaveLength(0);
      // Empty batch is immediately complete
      expect(result.batch.status).toBe('complete');
    });

    it('handles single output', async () => {
      const outputs = ['single-item'];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      expect(result.batch.total).toBe(1);
      expect(result.invocations).toHaveLength(1);
      expect(result.invocations[0].batchContext?.total).toBe(1);
    });

    it('generates unique job IDs for each invocation', async () => {
      const outputs = ['item-1', 'item-2', 'item-3'];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      const jobIds = result.invocations.map((i) => i.jobId);
      const uniqueJobIds = new Set(jobIds);

      expect(uniqueJobIds.size).toBe(3);
    });

    it('preserves output order in invocations', async () => {
      const outputs = ['first', 'second', 'third'];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      expect(result.invocations[0].targetEntityId).toBe('first');
      expect(result.invocations[0].batchContext?.index).toBe(0);

      expect(result.invocations[1].targetEntityId).toBe('second');
      expect(result.invocations[1].batchContext?.index).toBe(1);

      expect(result.invocations[2].targetEntityId).toBe('third');
      expect(result.invocations[2].batchContext?.index).toBe(2);
    });

    it('includes gather target in batch', async () => {
      const outputs = ['item-1'];

      const result = await createScatterBatch(client, {
        rhizaId: 'II01rhiza_test',
        sourceKladosId: 'II01klados_producer',
        targetKladosId: 'II01klados_worker',
        gatherTargetId: 'II01klados_aggregator',
        outputs,
        parentJobId: 'job-root',
      });

      expect(result.batch.gatherTargetId).toBe('II01klados_aggregator');
    });
  });
});
