/**
 * Resume Module
 *
 * Functions for resuming failed workflow executions.
 * Resume allows retrying failed jobs while preserving context.
 */

import type { KladosLogEntry } from '../types';
import type { MockArkeClient } from '../__tests__/fixtures/mock-client';
import { findErrorLeaves } from '../traverse';

/**
 * Options for resuming a workflow
 */
export interface ResumeOptions {
  /** Maximum number of jobs to resume */
  maxJobs?: number;
  /** Only resume these specific job IDs */
  jobIds?: string[];
}

/**
 * Information about a resumed job
 */
export interface ResumedJob {
  originalJobId: string;
  newJobId: string;
  kladosId: string;
  errorLogId: string;
  targetEntityId: string;
}

/**
 * Result of resuming a workflow
 */
export interface ResumeResult {
  resumed: number;
  skipped: number;
  jobs: ResumedJob[];
}

/**
 * Error summary for canResume
 */
export interface ErrorSummary {
  jobId: string;
  kladosId: string;
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Result of checking if a workflow can be resumed
 */
export interface CanResumeResult {
  canResume: boolean;
  totalErrors: number;
  retryableCount: number;
  nonRetryableCount: number;
  errors?: ErrorSummary[];
}

/**
 * Generate a new job ID for resume
 */
function generateJobId(): string {
  return `job-resume-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Resume a workflow by retrying failed jobs
 *
 * Finds all error leaves in the log chain and re-invokes them.
 * Only retries jobs marked as retryable.
 *
 * @param client - The Arke client
 * @param logs - The log chain for the workflow
 * @param options - Resume options
 * @returns Resume result with count and job details
 */
export async function resumeWorkflow(
  client: MockArkeClient,
  logs: KladosLogEntry[],
  options: ResumeOptions = {}
): Promise<ResumeResult> {
  const { maxJobs, jobIds } = options;

  // Find all error leaves
  const errorLeaves = findErrorLeaves(logs);

  // Filter by jobIds if provided
  let candidates = errorLeaves;
  if (jobIds && jobIds.length > 0) {
    const jobIdSet = new Set(jobIds);
    candidates = errorLeaves.filter((e) => jobIdSet.has(e.log.job_id));
  }

  const result: ResumeResult = {
    resumed: 0,
    skipped: 0,
    jobs: [],
  };

  for (const errorLeaf of candidates) {
    // Check maxJobs limit
    if (maxJobs !== undefined && result.resumed >= maxJobs) {
      result.skipped++;
      continue;
    }

    // Skip non-retryable errors
    if (!errorLeaf.retryable) {
      result.skipped++;
      continue;
    }

    // Extract original request from the error log
    const originalLog = errorLeaf.log;
    const originalRequest = originalLog.received?.invocation?.request;

    if (!originalRequest) {
      // Cannot resume without original request
      result.skipped++;
      continue;
    }

    // Generate new job ID
    const newJobId = generateJobId();

    // Get target entity from original request or received
    const targetEntityId =
      (originalRequest.target as string) ||
      (originalLog.received?.target as string) ||
      '';

    // Re-invoke the klados
    client.invokeKlados(originalLog.klados_id, {
      jobId: newJobId,
      targetEntityId,
      originalRequest,
      resumedFrom: originalLog.id,
    });

    result.resumed++;
    result.jobs.push({
      originalJobId: originalLog.job_id,
      newJobId,
      kladosId: originalLog.klados_id,
      errorLogId: originalLog.id,
      targetEntityId,
    });
  }

  return result;
}

/**
 * Check if a workflow can be resumed
 *
 * Analyzes the log chain to find retryable errors.
 *
 * @param logs - The log chain for the workflow
 * @returns Information about resume possibility
 */
export function canResume(logs: KladosLogEntry[]): CanResumeResult {
  const errorLeaves = findErrorLeaves(logs);

  const errors: ErrorSummary[] = errorLeaves.map((e) => ({
    jobId: e.log.job_id,
    kladosId: e.log.klados_id,
    code: e.log.error?.code ?? 'UNKNOWN',
    message: e.log.error?.message ?? 'Unknown error',
    retryable: e.retryable,
  }));

  const retryableCount = errors.filter((e) => e.retryable).length;
  const nonRetryableCount = errors.filter((e) => !e.retryable).length;

  return {
    canResume: retryableCount > 0,
    totalErrors: errors.length,
    retryableCount,
    nonRetryableCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}
