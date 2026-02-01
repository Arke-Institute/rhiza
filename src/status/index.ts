/**
 * Status Module
 *
 * Functions for building workflow status from log chains.
 * Status provides an overview of workflow execution progress.
 */

import type { KladosLogEntry } from '../types';
import { findLeaves } from '../traverse';

/**
 * Overall workflow status
 */
export type WorkflowStatusType = 'pending' | 'running' | 'done' | 'error' | 'unknown';

/**
 * Progress counters
 */
export interface ProgressCounters {
  total: number;
  pending: number;
  running: number;
  done: number;
  error: number;
}

/**
 * Error summary in status
 */
export interface StatusError {
  kladosId: string;
  jobId: string;
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Complete workflow status
 */
export interface WorkflowStatus {
  rhizaId: string;
  status: WorkflowStatusType;
  progress: ProgressCounters;
  currentKladoi: string[];
  errors: StatusError[];
  startedAt?: string;
  completedAt?: string;
}

/**
 * Build workflow status from log chain
 *
 * Analyzes all logs to determine overall status, progress,
 * current execution points, and any errors.
 *
 * @param logs - The log chain for the workflow
 * @returns Complete workflow status
 */
export function buildStatusFromLogs(logs: KladosLogEntry[]): WorkflowStatus {
  if (logs.length === 0) {
    return {
      rhizaId: '',
      status: 'unknown',
      progress: { total: 0, pending: 0, running: 0, done: 0, error: 0 },
      currentKladoi: [],
      errors: [],
    };
  }

  // Get rhiza ID from first log
  const rhizaId = logs[0].rhiza_id;

  // Count by status
  const progress: ProgressCounters = {
    total: logs.length,
    pending: logs.filter((l) => l.status === 'pending').length,
    running: logs.filter((l) => l.status === 'running').length,
    done: logs.filter((l) => l.status === 'done').length,
    error: logs.filter((l) => l.status === 'error').length,
  };

  // Find currently running kladoi
  const currentKladoi = logs
    .filter((l) => l.status === 'running')
    .map((l) => l.klados_id);

  // Collect errors
  const errors: StatusError[] = logs
    .filter((l) => l.status === 'error')
    .map((l) => ({
      kladosId: l.klados_id,
      jobId: l.job_id,
      code: l.error?.code ?? 'UNKNOWN',
      message: l.error?.message ?? 'Unknown error',
      retryable: l.error?.retryable ?? false,
    }));

  // Determine overall status from leaves
  const leaves = findLeaves(logs);
  const status = determineOverallStatus(leaves);

  // Timing
  const startedAt = findEarliestStart(logs);
  const completedAt = status === 'running' ? undefined : findLatestCompletion(logs);

  return {
    rhizaId,
    status,
    progress,
    currentKladoi,
    errors,
    startedAt,
    completedAt,
  };
}

/**
 * Determine overall status from leaf nodes
 */
function determineOverallStatus(leaves: KladosLogEntry[]): WorkflowStatusType {
  if (leaves.length === 0) {
    return 'unknown';
  }

  // If any leaf is running, workflow is running
  if (leaves.some((l) => l.status === 'running')) {
    return 'running';
  }

  // If any leaf is error, workflow has errors
  if (leaves.some((l) => l.status === 'error')) {
    return 'error';
  }

  // If any leaf is pending, workflow is pending/running
  if (leaves.some((l) => l.status === 'pending')) {
    return 'running';
  }

  // All leaves are done
  return 'done';
}

/**
 * Find earliest start time
 */
function findEarliestStart(logs: KladosLogEntry[]): string | undefined {
  const starts = logs
    .map((l) => l.started_at)
    .filter((s): s is string => s !== undefined)
    .sort();

  return starts[0];
}

/**
 * Find latest completion time
 */
function findLatestCompletion(logs: KladosLogEntry[]): string | undefined {
  const completions = logs
    .map((l) => l.completed_at)
    .filter((c): c is string => c !== undefined)
    .sort()
    .reverse();

  return completions[0];
}
