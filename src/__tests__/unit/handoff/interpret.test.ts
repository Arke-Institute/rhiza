/**
 * Handoff Interpretation Tests
 *
 * Tests for interpreting ThenSpec and determining the correct handoff action.
 * The interpreter analyzes the flow step and entity properties to determine
 * whether to pass, scatter, gather, or mark as done.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  interpretThen,
  type InterpretResult,
  type InterpretContext,
} from '../../../handoff/interpret';
import { createMockClient } from '../../fixtures/mock-client';
import { scatterGatherKladoi, allMockKladoi } from '../../fixtures/kladoi';
import { allMockRhizai, scatterGatherFlow } from '../../fixtures/rhizai';
import type { ThenSpec } from '../../../types';
import type { MockArkeClient } from '../../fixtures/mock-client';

describe('Handoff Interpretation', () => {
  let client: MockArkeClient;

  beforeEach(() => {
    client = createMockClient({
      kladoi: allMockKladoi,
      rhizai: allMockRhizai,
    });
  });

  describe('done handoff', () => {
    it('returns action: done for terminal', async () => {
      const then: ThenSpec = { done: true };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_terminal',
        jobId: 'job-1',
        outputs: ['entity-1'],
        flow: { 'II01klados_terminal': { then: { done: true } } },
      };

      const result = await interpretThen(client, then, context);

      expect(result.action).toBe('done');
      expect(result.target).toBeUndefined();
    });

    it('includes outputs in done result', async () => {
      const then: ThenSpec = { done: true };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_terminal',
        jobId: 'job-1',
        outputs: ['entity-1', 'entity-2'],
        flow: { 'II01klados_terminal': { then: { done: true } } },
      };

      const result = await interpretThen(client, then, context);

      expect(result.outputs).toEqual(['entity-1', 'entity-2']);
    });
  });

  describe('pass handoff', () => {
    it('returns action: pass with target klados', async () => {
      const then: ThenSpec = { pass: 'II01klados_worker' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_producer',
        jobId: 'job-1',
        outputs: ['entity-1'],
        flow: {
          'II01klados_producer': { then: { pass: 'II01klados_worker' } },
          'II01klados_worker': { then: { done: true } },
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.action).toBe('pass');
      expect(result.target).toBe('II01klados_worker');
      expect(result.targetType).toBe('klados');
    });

    it('discovers target type as rhiza for sub-workflow', async () => {
      const then: ThenSpec = { pass: 'II01rhiza_linear' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_producer',
        jobId: 'job-1',
        outputs: ['entity-1'],
        flow: {
          'II01klados_producer': { then: { pass: 'II01rhiza_linear' } },
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.action).toBe('pass');
      expect(result.target).toBe('II01rhiza_linear');
      expect(result.targetType).toBe('rhiza');
    });

    it('includes handoff record for logging', async () => {
      const then: ThenSpec = { pass: 'II01klados_worker' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_producer',
        jobId: 'job-1',
        outputs: ['entity-1'],
        flow: {
          'II01klados_producer': { then: { pass: 'II01klados_worker' } },
          'II01klados_worker': { then: { done: true } },
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.handoffRecord).toBeDefined();
      expect(result.handoffRecord?.type).toBe('pass');
      expect(result.handoffRecord?.target).toBe('II01klados_worker');
    });

    it('applies route rules to override default target', async () => {
      const then: ThenSpec = {
        pass: 'II01klados_default_handler',
        route: [
          { where: { property: 'content_type', equals: 'file/pdf' }, target: 'II01klados_pdf_handler' },
        ],
      };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_classifier',
        jobId: 'job-1',
        outputs: ['entity-1'],
        outputProperties: { content_type: 'file/pdf' },
        flow: {
          'II01klados_classifier': { then },
          'II01klados_pdf_handler': { then: { done: true } },
          'II01klados_default_handler': { then: { done: true } },
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.target).toBe('II01klados_pdf_handler');
    });

    it('falls back to default when no route matches', async () => {
      const then: ThenSpec = {
        pass: 'II01klados_default_handler',
        route: [
          { where: { property: 'content_type', equals: 'file/pdf' }, target: 'II01klados_pdf_handler' },
        ],
      };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_classifier',
        jobId: 'job-1',
        outputs: ['entity-1'],
        outputProperties: { content_type: 'file/txt' },
        flow: {
          'II01klados_classifier': { then },
          'II01klados_pdf_handler': { then: { done: true } },
          'II01klados_default_handler': { then: { done: true } },
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.target).toBe('II01klados_default_handler');
    });
  });

  describe('scatter handoff', () => {
    it('returns action: scatter with batch', async () => {
      const then: ThenSpec = { scatter: 'II01klados_worker' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_producer',
        jobId: 'job-1',
        outputs: ['item-1', 'item-2', 'item-3'],
        flow: scatterGatherFlow,
      };

      const result = await interpretThen(client, then, context);

      expect(result.action).toBe('scatter');
      expect(result.target).toBe('II01klados_worker');
      expect(result.batch).toBeDefined();
      expect(result.batch?.total).toBe(3);
    });

    it('includes invocations for each output', async () => {
      const then: ThenSpec = { scatter: 'II01klados_worker' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_producer',
        jobId: 'job-1',
        outputs: ['item-1', 'item-2', 'item-3'],
        flow: scatterGatherFlow,
      };

      const result = await interpretThen(client, then, context);

      expect(result.invocations).toBeDefined();
      expect(result.invocations).toHaveLength(3);
    });

    it('identifies gather target from flow', async () => {
      const then: ThenSpec = { scatter: 'II01klados_worker' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_producer',
        jobId: 'job-1',
        outputs: ['item-1', 'item-2'],
        flow: scatterGatherFlow,
      };

      const result = await interpretThen(client, then, context);

      expect(result.batch?.gatherTargetId).toBe('II01klados_aggregator');
    });

    it('handles empty outputs (no scatter needed)', async () => {
      const then: ThenSpec = { scatter: 'II01klados_worker' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_producer',
        jobId: 'job-1',
        outputs: [],
        flow: scatterGatherFlow,
      };

      const result = await interpretThen(client, then, context);

      expect(result.action).toBe('scatter');
      expect(result.batch?.total).toBe(0);
      expect(result.batch?.status).toBe('complete');
    });
  });

  describe('gather handoff', () => {
    it('returns action: gather_wait when not last slot', async () => {
      const then: ThenSpec = { gather: 'II01klados_aggregator' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_worker',
        jobId: 'job-2',
        outputs: ['result-1'],
        flow: scatterGatherFlow,
        batchContext: {
          batchId: 'batch-1',
          index: 0,
          total: 3,
        },
        batch: {
          id: 'batch-1',
          rhizaId: 'II01rhiza_test',
          sourceKladosId: 'II01klados_producer',
          targetKladosId: 'II01klados_worker',
          gatherTargetId: 'II01klados_aggregator',
          parentJobId: 'job-1',
          total: 3,
          completed: 0,
          status: 'pending',
          slots: [
            { status: 'pending' },
            { status: 'pending' },
            { status: 'pending' },
          ],
          createdAt: new Date().toISOString(),
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.action).toBe('gather_wait');
    });

    it('returns action: gather_trigger when last slot', async () => {
      const then: ThenSpec = { gather: 'II01klados_aggregator' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_worker',
        jobId: 'job-4',
        outputs: ['result-3'],
        flow: scatterGatherFlow,
        batchContext: {
          batchId: 'batch-1',
          index: 2,
          total: 3,
        },
        batch: {
          id: 'batch-1',
          rhizaId: 'II01rhiza_test',
          sourceKladosId: 'II01klados_producer',
          targetKladosId: 'II01klados_worker',
          gatherTargetId: 'II01klados_aggregator',
          parentJobId: 'job-1',
          total: 3,
          completed: 2,
          status: 'running',
          slots: [
            { status: 'complete', outputIds: ['result-1'] },
            { status: 'complete', outputIds: ['result-2'] },
            { status: 'pending' },
          ],
          createdAt: new Date().toISOString(),
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.action).toBe('gather_trigger');
      expect(result.target).toBe('II01klados_aggregator');
    });

    it('includes all outputs when triggering gather', async () => {
      const then: ThenSpec = { gather: 'II01klados_aggregator' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_worker',
        jobId: 'job-4',
        outputs: ['result-3'],
        flow: scatterGatherFlow,
        batchContext: {
          batchId: 'batch-1',
          index: 2,
          total: 3,
        },
        batch: {
          id: 'batch-1',
          rhizaId: 'II01rhiza_test',
          sourceKladosId: 'II01klados_producer',
          targetKladosId: 'II01klados_worker',
          gatherTargetId: 'II01klados_aggregator',
          parentJobId: 'job-1',
          total: 3,
          completed: 2,
          status: 'running',
          slots: [
            { status: 'complete', outputIds: ['result-1'] },
            { status: 'complete', outputIds: ['result-2'] },
            { status: 'pending' },
          ],
          createdAt: new Date().toISOString(),
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.allOutputs).toBeDefined();
      expect(result.allOutputs).toHaveLength(3);
    });

    it('updates batch slot on gather', async () => {
      const then: ThenSpec = { gather: 'II01klados_aggregator' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_worker',
        jobId: 'job-2',
        outputs: ['result-1'],
        flow: scatterGatherFlow,
        batchContext: {
          batchId: 'batch-1',
          index: 0,
          total: 3,
        },
        batch: {
          id: 'batch-1',
          rhizaId: 'II01rhiza_test',
          sourceKladosId: 'II01klados_producer',
          targetKladosId: 'II01klados_worker',
          gatherTargetId: 'II01klados_aggregator',
          parentJobId: 'job-1',
          total: 3,
          completed: 0,
          status: 'pending',
          slots: [
            { status: 'pending' },
            { status: 'pending' },
            { status: 'pending' },
          ],
          createdAt: new Date().toISOString(),
        },
      };

      const result = await interpretThen(client, then, context);

      expect(result.updatedBatch).toBeDefined();
      expect(result.updatedBatch?.slots[0].status).toBe('complete');
      expect(result.updatedBatch?.slots[0].outputIds).toEqual(['result-1']);
    });
  });

  describe('error handling', () => {
    it('throws when target not found', async () => {
      const then: ThenSpec = { pass: 'nonexistent_klados' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_producer',
        jobId: 'job-1',
        outputs: ['entity-1'],
        flow: {
          'II01klados_producer': { then: { pass: 'nonexistent_klados' } },
        },
      };

      await expect(interpretThen(client, then, context)).rejects.toThrow(/not found/);
    });

    it('throws when gather called without batch context', async () => {
      const then: ThenSpec = { gather: 'II01klados_aggregator' };
      const context: InterpretContext = {
        rhizaId: 'II01rhiza_test',
        kladosId: 'II01klados_worker',
        jobId: 'job-2',
        outputs: ['result-1'],
        flow: scatterGatherFlow,
        // Missing batchContext
      };

      await expect(interpretThen(client, then, context)).rejects.toThrow(/batch context/i);
    });
  });
});
