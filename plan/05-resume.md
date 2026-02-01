# Resumability

## Overview

The resume module enables recovery from failed workflow executions. By traversing the log chain (children point to parents), we can find error leaves and re-invoke the exact same requests.

**Key architectural principle**: Fire-and-forget. Parents invoke children and log the invocation, then they're done. Children create their own log entries pointing BACK to parent logs. No parent updates occur when children complete or fail.

---

## How Resume Works

1. **Traverse log chain** to find all terminal nodes (leaves)
2. **Identify error leaves** - logs with `status: error`
3. **Check retryability** - skip non-retryable errors
4. **Find invocation record** in the errored log's `received.invocation`
5. **Re-invoke** with the same request (new job_id)
6. **New job's log points to failed log** - maintaining the audit chain

The log chain is built by children pointing to parents via `received.from_log`. Resume creates a new job that points to the original failed log, preserving the complete history.

```
Before Resume:
                    ┌─────────────┐
                    │   Root Log  │
                    │   (done)    │
                    └──────┬──────┘
                           │ children point up
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────┴───┐    ┌──────┴───┐    ┌──────┴───┐
    │  Log B   │    │  Log C   │    │  Log D   │
    │  (done)  │    │ (ERROR)  │    │  (done)  │
    └──────────┘    └──────────┘    └──────────┘

After Resume:
                    ┌─────────────┐
                    │   Root Log  │
                    │   (done)    │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────┴───┐    ┌──────┴───┐    ┌──────┴───┐
    │  Log B   │    │  Log C   │    │  Log D   │
    │  (done)  │    │ (ERROR)  │    │  (done)  │
    └──────────┘    └──────────┘    └──────────┘
                           │
                           │ retry points to failed log
                           ▼
                    ┌──────────┐
                    │  Log C'  │ ← new job_id, points to Log C
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
 * A leaf is a log entry with no children (no other logs point to it via received.from_log)
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

  return {
    totalErrors: errorLeaves.length,
    retryableErrors: errorLeaves.filter((e) => e.retryable).length,
    nonRetryableErrors: errorLeaves.filter((e) => !e.retryable).length,
    errors: errorLeaves.map((e) => ({
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
  ResumeResult,
  ResumedJob,
} from '../types';
import { findErrorLeaves } from './find-errors';
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
 * Fire-and-forget architecture:
 * - Find error leaves by traversing the log chain (children → parents)
 * - Extract the invocation record from the errored log's `received.invocation`
 * - Re-invoke with the same request but a new job_id
 * - The new job's log will point to the failed log via `received.from_log`
 * - NO parent updates - the chain is maintained by children pointing to parents
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

  const result: ResumeResult = {
    resumed: 0,
    skipped: 0,
    jobs: [],
  };

  for (const errorLeaf of errorLeaves) {
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

    // Get the invocation record from the errored log
    // This contains the original request that can be replayed
    const invocation = errorLeaf.log.received.invocation;
    if (!invocation) {
      // No invocation record - this was a root job or missing data
      result.skipped++;
      continue;
    }

    // Re-invoke with same request, new job_id
    // The new log will point to the failed log, maintaining the audit chain
    const newJobId = `job_${generateId()}`;
    const newRequest = {
      ...invocation.request,
      job_id: newJobId,
      // Point to the failed log for audit trail
      from_log: errorLeaf.log.id,
    };

    try {
      await invokeKladosRaw(client, newRequest);

      result.jobs.push({
        original_job_id: errorLeaf.log.job_id,
        new_job_id: newJobId,
        klados: errorLeaf.log.klados,
        target: invocation.request.target,
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

  const retryableCount = errorLeaves.filter((e) => e.retryable).length;
  const nonRetryableCount = errorLeaves.filter((e) => !e.retryable).length;

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

## Key Concepts

### Fire-and-Forget Architecture

Parents never track children. The flow is:

1. Parent invokes child, logs the handoff (with `invocations` array)
2. Child receives invocation, creates its own log pointing to parent
3. Child completes or fails - its log records the outcome
4. Parent is NEVER updated

The log chain is built entirely by children pointing to parents via `received.from_log`.

### InvocationRecord in Logs

Each log entry contains `received.invocation` which stores the original request:

```typescript
interface KladosLogEntry {
  received: {
    from_log?: string;           // Parent log ID (builds the chain)
    invocation?: InvocationRecord; // The request that created this job
  };
  // ... other fields
}

interface InvocationRecord {
  request: KladosRequest;  // Everything needed for replay
  batch_index?: number;    // Position in batch if applicable
}
```

### Resume Creates New Jobs

When resuming:
- A NEW `job_id` is generated for the retry
- The original `job_id` stays in the log chain for audit
- The new job's log points to the failed log via `from_log`
- This creates a clear retry history: `Original → Failed → Retry1 → Retry2 → Success`

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
  "job_ids": ["job_abc", "job_def"]
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
