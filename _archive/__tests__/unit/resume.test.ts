/**
 * Resume Tests
 *
 * Tests for resuming failed workflow executions.
 * Resume functionality allows retrying failed jobs while preserving context.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resumeWorkflow, canResume } from '../../resume';
import { createMockClient } from '../fixtures/mock-client';
import { scatterGatherKladoi } from '../fixtures/kladoi';
import {
  partialErrorLogs,
  allErrorLogs,
  successfulLinearLogs,
  mixedErrorLogs,
} from '../fixtures/logs';
import type { MockArkeClient } from '../fixtures/mock-client';

describe('Resume', () => {
  let client: MockArkeClient;

  beforeEach(() => {
    client = createMockClient({
      kladoi: scatterGatherKladoi,
    });
  });

  describe('resumeWorkflow', () => {
    it('finds error leaves and re-invokes', async () => {
      const result = await resumeWorkflow(client, partialErrorLogs);

      expect(result.resumed).toBe(1);
      expect(result.jobs).toHaveLength(1);
    });

    it('resumes multiple errors', async () => {
      const result = await resumeWorkflow(client, allErrorLogs);

      // Should resume all retryable errors (2 out of 3)
      expect(result.resumed).toBe(2);
    });

    it('uses original request with new job_id', async () => {
      const result = await resumeWorkflow(client, partialErrorLogs);

      expect(result.jobs).toHaveLength(1);
      // New job ID should be different from original
      expect(result.jobs[0].newJobId).not.toBe(result.jobs[0].originalJobId);
      // Should reference original error log
      expect(result.jobs[0].errorLogId).toBe('log_err_worker_1');
    });

    it('skips non-retryable errors', async () => {
      const result = await resumeWorkflow(client, allErrorLogs);

      // 1 non-retryable, 2 retryable
      expect(result.skipped).toBe(1);
      expect(result.resumed).toBe(2);
    });

    it('respects maxJobs limit', async () => {
      const result = await resumeWorkflow(client, allErrorLogs, { maxJobs: 1 });

      expect(result.resumed).toBe(1);
      // 1 skipped due to limit, 1 skipped due to non-retryable
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    });

    it('filters by jobIds when provided', async () => {
      const result = await resumeWorkflow(client, allErrorLogs, {
        jobIds: ['job_allerr_w1'],
      });

      expect(result.resumed).toBe(1);
      expect(result.jobs[0].originalJobId).toBe('job_allerr_w1');
    });

    it('returns summary of resumed jobs', async () => {
      const result = await resumeWorkflow(client, partialErrorLogs);

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0]).toHaveProperty('originalJobId');
      expect(result.jobs[0]).toHaveProperty('newJobId');
      expect(result.jobs[0]).toHaveProperty('kladosId');
      expect(result.jobs[0]).toHaveProperty('errorLogId');
    });

    it('records invocations with mock client', async () => {
      await resumeWorkflow(client, partialErrorLogs);

      const invoked = client.getInvokedKladoi();
      expect(invoked.length).toBeGreaterThan(0);
    });

    it('returns empty result for successful workflow', async () => {
      const result = await resumeWorkflow(client, successfulLinearLogs);

      expect(result.resumed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.jobs).toHaveLength(0);
    });

    it('preserves target entity from original request', async () => {
      await resumeWorkflow(client, partialErrorLogs);

      const invoked = client.getInvokedKladoi();
      // Should target the same entity as the original failed request
      expect(invoked[0].request.targetEntityId).toBe('item_2');
    });
  });

  describe('canResume', () => {
    it('returns true when retryable errors exist', () => {
      const result = canResume(partialErrorLogs);

      expect(result.canResume).toBe(true);
    });

    it('returns false when only non-retryable errors', () => {
      // Create logs with only non-retryable errors
      const nonRetryableOnly = mixedErrorLogs.map((log) => {
        if (log.status === 'error' && log.error) {
          return {
            ...log,
            error: { ...log.error, retryable: false },
          };
        }
        return log;
      });

      const result = canResume(nonRetryableOnly);

      expect(result.canResume).toBe(false);
    });

    it('returns false when no errors', () => {
      const result = canResume(successfulLinearLogs);

      expect(result.canResume).toBe(false);
    });

    it('returns counts of each type', () => {
      const result = canResume(allErrorLogs);

      // 2 retryable, 1 non-retryable
      expect(result.retryableCount).toBe(2);
      expect(result.nonRetryableCount).toBe(1);
    });

    it('returns totalErrors count', () => {
      const result = canResume(allErrorLogs);

      expect(result.totalErrors).toBe(3);
    });

    it('returns empty counts for successful workflow', () => {
      const result = canResume(successfulLinearLogs);

      expect(result.totalErrors).toBe(0);
      expect(result.retryableCount).toBe(0);
      expect(result.nonRetryableCount).toBe(0);
    });

    it('includes error summaries', () => {
      const result = canResume(partialErrorLogs);

      expect(result.errors).toBeDefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]).toHaveProperty('jobId');
      expect(result.errors![0]).toHaveProperty('kladosId');
      expect(result.errors![0]).toHaveProperty('code');
      expect(result.errors![0]).toHaveProperty('message');
      expect(result.errors![0]).toHaveProperty('retryable');
    });
  });
});
