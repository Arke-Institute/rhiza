/**
 * Status Tests
 *
 * Tests for building workflow status from log chains.
 * Status provides an overview of workflow execution progress.
 */

import { describe, it, expect } from 'vitest';
import {
  buildStatusFromLogs,
  type WorkflowStatus,
} from '../../status';
import {
  successfulLinearLogs,
  successfulScatterGatherLogs,
  partialErrorLogs,
  allErrorLogs,
  mixedErrorLogs,
  runningWorkflowLogs,
  singleNodeLogs,
} from '../fixtures/logs';

describe('Status', () => {
  describe('buildStatusFromLogs', () => {
    describe('overall status', () => {
      it('returns done when all leaves done', () => {
        const status = buildStatusFromLogs(successfulLinearLogs);

        expect(status.status).toBe('done');
      });

      it('returns done for scatter-gather when complete', () => {
        const status = buildStatusFromLogs(successfulScatterGatherLogs);

        expect(status.status).toBe('done');
      });

      it('returns error when any leaf error', () => {
        const status = buildStatusFromLogs(partialErrorLogs);

        expect(status.status).toBe('error');
      });

      it('returns error when all leaves are errors', () => {
        const status = buildStatusFromLogs(allErrorLogs);

        expect(status.status).toBe('error');
      });

      it('returns running when any leaf running', () => {
        const status = buildStatusFromLogs(runningWorkflowLogs);

        expect(status.status).toBe('running');
      });

      it('returns done for single node workflow', () => {
        const status = buildStatusFromLogs(singleNodeLogs);

        expect(status.status).toBe('done');
      });

      it('returns unknown for empty logs', () => {
        const status = buildStatusFromLogs([]);

        expect(status.status).toBe('unknown');
      });
    });

    describe('progress counters', () => {
      it('calculates correct totals for linear workflow', () => {
        const status = buildStatusFromLogs(successfulLinearLogs);

        expect(status.progress.total).toBe(3);
        expect(status.progress.done).toBe(3);
        expect(status.progress.error).toBe(0);
        expect(status.progress.running).toBe(0);
      });

      it('calculates correct totals for scatter-gather workflow', () => {
        const status = buildStatusFromLogs(successfulScatterGatherLogs);

        expect(status.progress.total).toBe(5); // producer + 3 workers + aggregator
        expect(status.progress.done).toBe(5);
      });

      it('counts errors correctly', () => {
        const status = buildStatusFromLogs(partialErrorLogs);

        expect(status.progress.error).toBe(1);
        expect(status.progress.done).toBe(3); // producer + 2 successful workers
      });

      it('counts running correctly', () => {
        const status = buildStatusFromLogs(runningWorkflowLogs);

        expect(status.progress.running).toBe(1);
        expect(status.progress.done).toBe(1);
      });

      it('calculates all error types', () => {
        const status = buildStatusFromLogs(allErrorLogs);

        expect(status.progress.error).toBe(3);
        expect(status.progress.done).toBe(1); // Just the producer
      });
    });

    describe('current kladoi', () => {
      it('identifies currently running kladoi', () => {
        const status = buildStatusFromLogs(runningWorkflowLogs);

        expect(status.currentKladoi).toContain('II01klados_b');
      });

      it('returns empty array when nothing running', () => {
        const status = buildStatusFromLogs(successfulLinearLogs);

        expect(status.currentKladoi).toHaveLength(0);
      });

      it('includes all running kladoi', () => {
        // Create logs with multiple running
        const multipleRunning = [
          ...runningWorkflowLogs,
          {
            id: 'log_run_child2',
            type: 'klados_log' as const,
            rhiza_id: 'II01rhiza_linear',
            klados_id: 'II01klados_c',
            job_id: 'job_run_3',
            status: 'running' as const,
            started_at: '2025-01-01T00:01:00Z',
            received: {
              target: 'output_b',
              from_logs: ['log_run_root'],
            },
          },
        ];

        const status = buildStatusFromLogs(multipleRunning);

        expect(status.currentKladoi).toContain('II01klados_b');
        expect(status.currentKladoi).toContain('II01klados_c');
      });
    });

    describe('error summaries', () => {
      it('collects error summaries', () => {
        const status = buildStatusFromLogs(partialErrorLogs);

        expect(status.errors).toBeDefined();
        expect(status.errors).toHaveLength(1);
      });

      it('includes error details', () => {
        const status = buildStatusFromLogs(partialErrorLogs);

        expect(status.errors![0]).toHaveProperty('kladosId');
        expect(status.errors![0]).toHaveProperty('jobId');
        expect(status.errors![0]).toHaveProperty('code');
        expect(status.errors![0]).toHaveProperty('message');
      });

      it('collects multiple errors', () => {
        const status = buildStatusFromLogs(allErrorLogs);

        expect(status.errors).toHaveLength(3);
      });

      it('returns empty array when no errors', () => {
        const status = buildStatusFromLogs(successfulLinearLogs);

        expect(status.errors).toHaveLength(0);
      });

      it('includes retryable flag', () => {
        const status = buildStatusFromLogs(mixedErrorLogs);

        expect(status.errors).toHaveLength(2);
        const retryable = status.errors!.filter((e) => e.retryable);
        const nonRetryable = status.errors!.filter((e) => !e.retryable);

        expect(retryable.length).toBe(1);
        expect(nonRetryable.length).toBe(1);
      });
    });

    describe('timing information', () => {
      it('includes started_at from earliest log', () => {
        const status = buildStatusFromLogs(successfulLinearLogs);

        expect(status.startedAt).toBe('2025-01-01T00:00:00Z');
      });

      it('includes completed_at from latest log when done', () => {
        const status = buildStatusFromLogs(successfulLinearLogs);

        expect(status.completedAt).toBe('2025-01-01T00:03:00Z');
      });

      it('does not include completed_at when running', () => {
        const status = buildStatusFromLogs(runningWorkflowLogs);

        expect(status.completedAt).toBeUndefined();
      });

      it('includes completed_at when error (workflow terminated)', () => {
        const status = buildStatusFromLogs(partialErrorLogs);

        // Error workflow is still "terminal" even if with error
        expect(status.completedAt).toBeDefined();
      });
    });

    describe('rhiza information', () => {
      it('includes rhiza_id', () => {
        const status = buildStatusFromLogs(successfulLinearLogs);

        expect(status.rhizaId).toBe('II01rhiza_linear');
      });

      it('handles scatter-gather rhiza_id', () => {
        const status = buildStatusFromLogs(successfulScatterGatherLogs);

        expect(status.rhizaId).toBe('II01rhiza_scatter_gather');
      });
    });
  });
});
