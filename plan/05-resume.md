# Resumability

## Overview

The resume module enables recovery from failed workflow executions. By traversing the log chain, we can find error leaves and re-invoke the exact same requests.

---

## How Resume Works

1. **Traverse log chain** to find all terminal nodes (leaves)
2. **Identify error leaves** - logs with `status: error`
3. **Check retryability** - skip non-retryable errors
4. **Find invocation record** in parent log
5. **Re-invoke** with the same request (new job_id)
6. **Update parent** to track the new job

```
Before Resume:
                    ┌─────────────┐
                    │   Root Log  │
                    │   (done)    │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Log B   │    │  Log C   │    │  Log D   │
    │  (done)  │    │ (ERROR)  │    │  (done)  │
    └──────────┘    └──────────┘    └──────────┘

After Resume:
                    ┌─────────────┐
                    │   Root Log  │
                    │   (done)    │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Log B   │    │  Log C   │    │  Log D   │
    │  (done)  │    │ (ERROR)  │    │  (done)  │
    └──────────┘    └──────────┘    └──────────┘
                           │
                           ▼ (retry)
                    ┌──────────┐
                    │  Log C'  │
                    │ (running)│
                    └──────────┘
```

---

## Implementation

### `src/resume/traverse.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type { KladosLogEntry, LogTree } from '../types';
import { getJobLogs, buildLogTree } from '../logging/chain';

/**
 * Traverse the log chain and return all leaf nodes
 *
 * A leaf is a log entry with no children (no other logs received_from it)
 */
export async function findLeaves(
  client: ArkeClient,
  jobCollectionId: string
): Promise<KladosLogEntry[]> {
  const logs = await getJobLogs(client, jobCollectionId);

  // Build set of all logs that are parents (have children pointing to them)
  const parentIds = new Set<string>();
  for (const log of logs) {
    if (log.received.from_log) {
      parentIds.add(log.received.from_log);
    }
  }

  // Leaves are logs that are not parents
  return logs.filter((log) => !parentIds.has(log.id));
}

/**
 * Find all leaf nodes in the execution tree recursively
 */
export function findLeavesInTree(tree: LogTree): KladosLogEntry[] {
  if (tree.children.length === 0) {
    return [tree.entry];
  }

  return tree.children.flatMap(findLeavesInTree);
}

/**
 * Get execution path from root to a specific log
 */
export async function getPathToLog(
  client: ArkeClient,
  jobCollectionId: string,
  targetLogId: string
): Promise<KladosLogEntry[]> {
  const logs = await getJobLogs(client, jobCollectionId);
  const path: KladosLogEntry[] = [];

  let current = logs.find((l) => l.id === targetLogId);

  while (current) {
    path.unshift(current);
    if (!current.received.from_log) break;
    current = logs.find((l) => l.id === current!.received.from_log);
  }

  return path;
}
```

### `src/resume/find-errors.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type { KladosLogEntry } from '../types';
import { findLeaves } from './traverse';
import { getJobLogs } from '../logging/chain';

/**
 * Error leaf with additional context
 */
export interface ErrorLeaf {
  /** The error log entry */
  log: KladosLogEntry;

  /** Whether the error is retryable */
  retryable: boolean;

  /** Path from root to this error */
  path: string[];
}

/**
 * Find all error leaves in the log chain
 */
export async function findErrorLeaves(
  client: ArkeClient,
  jobCollectionId: string
): Promise<ErrorLeaf[]> {
  const leaves = await findLeaves(client, jobCollectionId);
  const logs = await getJobLogs(client, jobCollectionId);

  const errorLeaves: ErrorLeaf[] = [];

  for (const leaf of leaves) {
    if (leaf.status === 'error') {
      // Build path for context
      const path = buildPath(leaf, logs);

      errorLeaves.push({
        log: leaf,
        retryable: leaf.error?.retryable ?? false,
        path,
      });
    }
  }

  return errorLeaves;
}

/**
 * Find stuck jobs - invocations that were made but never completed
 */
export async function findStuckJobs(
  client: ArkeClient,
  jobCollectionId: string
): Promise<ErrorLeaf[]> {
  const logs = await getJobLogs(client, jobCollectionId);
  const stuckJobs: ErrorLeaf[] = [];

  for (const log of logs) {
    if (!log.handoffs) continue;

    for (const handoff of log.handoffs) {
      for (const invocation of handoff.invocations) {
        if (invocation.status === 'pending') {
          // Check if there's a corresponding log entry
          const childLog = logs.find((l) => l.job_id === invocation.job_id);

          if (!childLog) {
            // Invocation was made but no log exists - stuck
            stuckJobs.push({
              log: {
                ...log,
                status: 'error',
                error: {
                  code: 'STUCK',
                  message: `Invocation ${invocation.job_id} was made but never started`,
                  retryable: true,
                },
              },
              retryable: true,
              path: buildPath(log, logs),
            });
          }
        }
      }
    }
  }

  return stuckJobs;
}

/**
 * Build path from root to a log entry
 */
function buildPath(
  target: KladosLogEntry,
  allLogs: KladosLogEntry[]
): string[] {
  const path: string[] = [];
  let current: KladosLogEntry | undefined = target;

  while (current) {
    path.unshift(current.klados);
    if (!current.received.from_log) break;
    current = allLogs.find((l) => l.id === current!.received.from_log);
  }

  return path;
}

/**
 * Get summary of workflow errors
 */
export interface ErrorSummary {
  totalErrors: number;
  retryableErrors: number;
  nonRetryableErrors: number;
  stuckJobs: number;
  errors: Array<{
    klados: string;
    jobId: string;
    error: string;
    retryable: boolean;
    path: string;
  }>;
}

export async function getErrorSummary(
  client: ArkeClient,
  jobCollectionId: string
): Promise<ErrorSummary> {
  const errorLeaves = await findErrorLeaves(client, jobCollectionId);
  const stuckJobs = await findStuckJobs(client, jobCollectionId);

  const allErrors = [...errorLeaves, ...stuckJobs];

  return {
    totalErrors: allErrors.length,
    retryableErrors: allErrors.filter((e) => e.retryable).length,
    nonRetryableErrors: allErrors.filter((e) => !e.retryable).length,
    stuckJobs: stuckJobs.length,
    errors: allErrors.map((e) => ({
      klados: e.log.klados,
      jobId: e.log.job_id,
      error: e.log.error?.message ?? 'Unknown error',
      retryable: e.retryable,
      path: e.path.join(' → '),
    })),
  };
}
```

### `src/resume/resume.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type {
  KladosLogEntry,
  InvocationRecord,
  ResumeResult,
  ResumedJob,
} from '../types';
import { findErrorLeaves, findStuckJobs } from './find-errors';
import { getJobLogs, getLogEntry } from '../logging/chain';
import { invokeKladosRaw } from '../handoff/invoke';
import { generateId } from '../utils';

/**
 * Options for resume operation
 */
export interface ResumeOptions {
  /** Only resume retryable errors (default: true) */
  retryableOnly?: boolean;

  /** Maximum number of jobs to resume (default: unlimited) */
  maxJobs?: number;

  /** Specific job IDs to resume (default: all errors) */
  jobIds?: string[];
}

/**
 * Resume a failed workflow
 *
 * Finds all error leaves, looks up their invocation records in parent logs,
 * and re-invokes with the same request (new job_id).
 */
export async function resumeWorkflow(
  client: ArkeClient,
  jobCollectionId: string,
  options: ResumeOptions = {}
): Promise<ResumeResult> {
  const {
    retryableOnly = true,
    maxJobs,
    jobIds,
  } = options;

  // Find all error leaves
  const errorLeaves = await findErrorLeaves(client, jobCollectionId);
  const stuckJobs = await findStuckJobs(client, jobCollectionId);
  const allErrors = [...errorLeaves, ...stuckJobs];

  // Get all logs for parent lookup
  const logs = await getJobLogs(client, jobCollectionId);

  const result: ResumeResult = {
    resumed: 0,
    skipped: 0,
    jobs: [],
  };

  for (const errorLeaf of allErrors) {
    // Check limits
    if (maxJobs && result.resumed >= maxJobs) break;

    // Filter by job ID if specified
    if (jobIds && !jobIds.includes(errorLeaf.log.job_id)) {
      continue;
    }

    // Check retryability
    if (retryableOnly && !errorLeaf.retryable) {
      result.skipped++;
      continue;
    }

    // Find parent log
    const parentLogId = errorLeaf.log.received.from_log;
    if (!parentLogId) {
      // This is the root log - can't resume from parent
      // Would need to re-invoke the entire workflow
      result.skipped++;
      continue;
    }

    const parentLog = logs.find((l) => l.id === parentLogId);
    if (!parentLog || !parentLog.handoffs) {
      result.skipped++;
      continue;
    }

    // Find the invocation record for this job
    let invocation: InvocationRecord | undefined;
    for (const handoff of parentLog.handoffs) {
      invocation = handoff.invocations.find(
        (inv) => inv.job_id === errorLeaf.log.job_id
      );
      if (invocation) break;
    }

    if (!invocation) {
      result.skipped++;
      continue;
    }

    // Re-invoke with same request, new job_id
    const newJobId = `job_${generateId()}`;
    const newRequest = {
      ...invocation.request,
      job_id: newJobId,
    };

    try {
      await invokeKladosRaw(client, newRequest);

      // Update parent's invocation record to point to new job
      await updateInvocationInParent(
        client,
        parentLog,
        invocation.job_id,
        newJobId
      );

      result.jobs.push({
        original_job_id: errorLeaf.log.job_id,
        new_job_id: newJobId,
        klados: errorLeaf.log.klados,
        target: invocation.target_entity,
        error: errorLeaf.log.error?.message ?? 'Unknown error',
      });
      result.resumed++;

    } catch (e) {
      // Failed to resume - skip
      result.skipped++;
    }
  }

  return result;
}

/**
 * Update a parent log's invocation record with new job ID
 */
async function updateInvocationInParent(
  client: ArkeClient,
  parentLog: KladosLogEntry,
  oldJobId: string,
  newJobId: string
): Promise<void> {
  // Find the log file entity
  // Note: We need the file ID, not the log ID
  // The log ID is stored in the log entry, but we need to query by job_id

  // This is a simplified version - in practice we'd need to find the file
  // by querying the job collection

  // For now, assume we can update via a helper
  // In the real implementation, we'd update the file entity's properties

  // The parent log's handoffs would be updated to change:
  // invocations[].job_id from oldJobId to newJobId
  // invocations[].status from 'error' to 'pending'
}

/**
 * Resume a specific failed job by ID
 */
export async function resumeJob(
  client: ArkeClient,
  jobCollectionId: string,
  jobId: string
): Promise<ResumedJob | null> {
  const result = await resumeWorkflow(client, jobCollectionId, {
    jobIds: [jobId],
    retryableOnly: false,
  });

  return result.jobs[0] ?? null;
}

/**
 * Check if a workflow can be resumed
 */
export async function canResume(
  client: ArkeClient,
  jobCollectionId: string
): Promise<{
  canResume: boolean;
  retryableCount: number;
  nonRetryableCount: number;
}> {
  const errorLeaves = await findErrorLeaves(client, jobCollectionId);
  const stuckJobs = await findStuckJobs(client, jobCollectionId);
  const allErrors = [...errorLeaves, ...stuckJobs];

  const retryableCount = allErrors.filter((e) => e.retryable).length;
  const nonRetryableCount = allErrors.filter((e) => !e.retryable).length;

  return {
    canResume: retryableCount > 0,
    retryableCount,
    nonRetryableCount,
  };
}
```

### `src/resume/index.ts`

```typescript
export { findLeaves, findLeavesInTree, getPathToLog } from './traverse';

export {
  findErrorLeaves,
  findStuckJobs,
  getErrorSummary,
} from './find-errors';
export type { ErrorLeaf, ErrorSummary } from './find-errors';

export {
  resumeWorkflow,
  resumeJob,
  canResume,
} from './resume';
export type { ResumeOptions } from './resume';
```

---

## Usage Example

```typescript
import {
  getErrorSummary,
  canResume,
  resumeWorkflow,
} from '@arke-institute/rhiza';

// Check workflow status
const summary = await getErrorSummary(client, jobCollectionId);
console.log(`${summary.totalErrors} errors found`);
console.log(`${summary.retryableErrors} can be retried`);

for (const error of summary.errors) {
  console.log(`  ${error.path}: ${error.error}`);
}

// Check if we can resume
const { canResume: canResumeWorkflow, retryableCount } = await canResume(
  client,
  jobCollectionId
);

if (canResumeWorkflow) {
  console.log(`Resuming ${retryableCount} failed jobs...`);

  const result = await resumeWorkflow(client, jobCollectionId, {
    retryableOnly: true,
  });

  console.log(`Resumed: ${result.resumed}`);
  console.log(`Skipped: ${result.skipped}`);

  for (const job of result.jobs) {
    console.log(`  ${job.klados}: ${job.original_job_id} → ${job.new_job_id}`);
  }
}
```

---

## Resume Endpoint

The API will expose resume via:

```
POST /rhizai/{id}/jobs/{job_id}/resume
```

Request:
```json
{
  "retryable_only": true,
  "max_jobs": 10,
  "job_ids": ["job_abc", "job_def"]  // optional filter
}
```

Response:
```json
{
  "resumed": 3,
  "skipped": 1,
  "jobs": [
    {
      "original_job_id": "job_abc",
      "new_job_id": "job_xyz",
      "klados": "ocr-service",
      "target": "IIentity123",
      "error": "Timeout waiting for OCR service"
    }
  ]
}
```
