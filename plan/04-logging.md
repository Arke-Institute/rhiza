# Logging

## Overview

The logging module handles writing klados execution logs to the job collection. Logs are written when execution completes successfully or upon an error. Logs form a chain via `received_from` relationships (stored both in the log entry and as entity relationships), enabling traversal and resumability.

---

## Log Chain Structure

```
Job Collection
│
├── Log Entry A (entry klados)
│   ├── properties: { status: done, produced: [...], handoffs: [...] }
│   └── relationships: (none - root entry)
│
├── Log Entry B (batch[0])
│   ├── properties: { status: done, received.from_logs: [A], ... }
│   └── relationships:
│       └── received_from: Log A
│
├── Log Entry C (batch[1])
│   ├── properties: { status: error, received.from_logs: [A], error: {...} }
│   └── relationships:
│       └── received_from: Log A
│
├── Log Entry D (batch[2])
│   ├── properties: { status: done, received.from_logs: [A], ... }
│   └── relationships:
│       └── received_from: Log A
│
└── Log Entry E (gather)
    ├── properties: { status: done, received.from_logs: [B, D], ... }
    └── relationships:
        ├── received_from: Log B
        └── received_from: Log D
```

---

## Relationship Predicates

| Predicate | Direction | Description |
|-----------|-----------|-------------|
| `received_from` | Child → Parent(s) | Points to the log entry(ies) that triggered this klados |

The `from_logs` array is stored in:
1. **Log entry properties** (`received.from_logs`) - for data access
2. **Entity relationships** (`received_from` predicate) - for graph traversal

This enables:
- **Forward traversal**: Query for logs where `received_from` points to a given log
- **Backward traversal**: Follow `received_from` relationships to find invoker(s)
- **Error detection**: Find leaves with `status: error`
- **Resume**: Re-invoke from the handoff's invocation record

---

## Implementation

### `src/logging/logger.ts`

```typescript
import type { LogMessage } from '../types';

/**
 * KladosLogger - In-memory log message collector
 *
 * Collects log messages during klados execution.
 * Messages are written to the log entry when execution completes or upon an error.
 */
export class KladosLogger {
  private messages: LogMessage[] = [];

  /**
   * Log an info message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.add('info', message, metadata);
  }

  /**
   * Log a warning message
   */
  warning(message: string, metadata?: Record<string, unknown>): void {
    this.add('warning', message, metadata);
  }

  /**
   * Log an error message
   */
  error(message: string, metadata?: Record<string, unknown>): void {
    this.add('error', message, metadata);
  }

  /**
   * Log a success message
   */
  success(message: string, metadata?: Record<string, unknown>): void {
    this.add('success', message, metadata);
  }

  /**
   * Add a log message
   */
  private add(
    level: LogMessage['level'],
    message: string,
    metadata?: Record<string, unknown>
  ): void {
    this.messages.push({
      level,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    });
  }

  /**
   * Get all collected messages
   */
  getMessages(): LogMessage[] {
    return [...this.messages];
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
  }
}
```

### `src/logging/writer.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type {
  KladosLogEntry,
  JobLog,
  LogMessage,
  HandoffRecord,
} from '../types';
import { sleep, generateId } from '../utils';

/**
 * Options for writing a klados log
 */
export interface WriteLogOptions {
  /** Arke client */
  client: ArkeClient;

  /** Job collection ID */
  jobCollectionId: string;

  /** Klados log entry data */
  entry: KladosLogEntry;

  /** Human-readable log messages */
  messages: LogMessage[];

  /** Agent info */
  agentId: string;
  agentVersion: string;
}

/**
 * Result of writing a klados log
 */
export interface WriteLogResult {
  /** Log entity ID */
  logId: string;

  /** Log file entity ID */
  fileId: string;
}

/**
 * Write a klados log entry to the job collection
 *
 * Creates a file entity with the log data and adds relationships
 * for chain traversal. The from_logs array is stored both in
 * properties and as received_from relationships.
 */
export async function writeKladosLog(
  options: WriteLogOptions
): Promise<WriteLogResult> {
  const {
    client,
    jobCollectionId,
    entry,
    messages,
    agentId,
    agentVersion,
  } = options;

  // Build the job log structure
  const jobLog: JobLog = {
    entry,
    agent_id: agentId,
    agent_version: agentVersion,
    messages,
  };

  // Generate log entity ID
  const logId = `log_${generateId()}`;
  const fileKey = `${entry.job_id}/${entry.klados_id}/${logId}.json`;

  // 1. Create file entity with log data
  const { data: fileEntity } = await client.api.POST('/files', {
    body: {
      key: fileKey,
      collection: jobCollectionId,
      content_type: 'application/json',
      properties: {
        type: 'klados_log',
        rhiza_id: entry.rhiza_id,
        klados_id: entry.klados_id,
        job_id: entry.job_id,
        status: entry.status,
        log_data: jobLog as Record<string, unknown>,
      },
    },
  });

  const fileId = fileEntity!.id;

  // 2. Build relationships
  const relationships: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
  }> = [
    // Contains relationship (file in collection)
    { predicate: 'contains', peer: fileId, peer_type: 'file' },
  ];

  // 3. Add received_from relationships for graph traversal
  // These mirror the from_logs array in the entry properties
  if (entry.received.from_logs && entry.received.from_logs.length > 0) {
    for (const parentLogId of entry.received.from_logs) {
      relationships.push({
        predicate: 'received_from',
        peer: parentLogId,
        peer_type: 'file',
      });
    }
  }

  // 4. Update job collection with relationships (CAS retry)
  await updateCollectionWithRetry(client, jobCollectionId, relationships);

  return { logId, fileId };
}

/**
 * Update log entry with handoff records
 *
 * Called after handoffs are made to record what was invoked.
 */
export async function updateLogWithHandoffs(
  client: ArkeClient,
  logFileId: string,
  handoffs: HandoffRecord[]
): Promise<void> {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      // Get current file
      const { data: tip } = await client.api.GET('/entities/{id}/tip', {
        params: { path: { id: logFileId } },
      });

      const { data: file } = await client.api.GET('/entities/{id}', {
        params: { path: { id: logFileId } },
      });

      const logData = file!.properties.log_data as JobLog;
      logData.entry.handoffs = handoffs;

      // Update file
      await client.api.PUT('/entities/{id}', {
        params: { path: { id: logFileId } },
        body: {
          expect_tip: tip!.cid,
          properties: {
            ...file!.properties,
            log_data: logData as Record<string, unknown>,
          },
        },
      });

      return;

    } catch (e) {
      if (e instanceof Error && (e.message.includes('409') || e.message.includes('Conflict'))) {
        retries++;
        await sleep(Math.pow(2, retries) * 100 + Math.random() * 200);
        continue;
      }
      throw e;
    }
  }

  throw new Error(`Failed to update log with handoffs after ${maxRetries} retries`);
}

/**
 * Update log entry status (e.g., to error)
 */
export async function updateLogStatus(
  client: ArkeClient,
  logFileId: string,
  status: 'running' | 'done' | 'error',
  error?: { code: string; message: string; retryable: boolean }
): Promise<void> {
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const { data: tip } = await client.api.GET('/entities/{id}/tip', {
        params: { path: { id: logFileId } },
      });

      const { data: file } = await client.api.GET('/entities/{id}', {
        params: { path: { id: logFileId } },
      });

      const logData = file!.properties.log_data as JobLog;
      logData.entry.status = status;
      logData.entry.completed_at = new Date().toISOString();

      if (error) {
        logData.entry.error = error;
      }

      await client.api.PUT('/entities/{id}', {
        params: { path: { id: logFileId } },
        body: {
          expect_tip: tip!.cid,
          properties: {
            ...file!.properties,
            status, // Also update top-level for easy querying
            log_data: logData as Record<string, unknown>,
          },
        },
      });

      return;

    } catch (e) {
      if (e instanceof Error && (e.message.includes('409') || e.message.includes('Conflict'))) {
        retries++;
        await sleep(Math.pow(2, retries) * 100);
        continue;
      }
      throw e;
    }
  }
}

/**
 * Update collection with relationships using CAS retry
 */
async function updateCollectionWithRetry(
  client: ArkeClient,
  collectionId: string,
  relationships: Array<{ predicate: string; peer: string; peer_type?: string }>
): Promise<void> {
  const maxRetries = 10;
  let retries = 0;

  // Initial random delay to spread concurrent writes
  await sleep(Math.random() * 2000);

  while (retries < maxRetries) {
    try {
      const { data: tip } = await client.api.GET('/entities/{id}/tip', {
        params: { path: { id: collectionId } },
      });

      await client.api.PUT('/collections/{id}', {
        params: { path: { id: collectionId } },
        body: {
          expect_tip: tip!.cid,
          relationships_add: relationships,
        },
      });

      return;

    } catch (e) {
      if (e instanceof Error && (e.message.includes('409') || e.message.includes('Conflict'))) {
        retries++;
        // Exponential backoff with jitter
        const delay = Math.pow(2, retries) * 200 + Math.random() * 1000;
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }

  throw new Error(`Failed to update collection after ${maxRetries} retries`);
}
```

### `src/logging/chain.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type { KladosLogEntry, JobLog } from '../types';

/**
 * Get all log entries in a job collection
 */
export async function getJobLogs(
  client: ArkeClient,
  jobCollectionId: string
): Promise<KladosLogEntry[]> {
  // Query for all klados_log files in the collection
  const { data: collection } = await client.api.GET('/collections/{id}', {
    params: { path: { id: jobCollectionId } },
  });

  const logFiles = collection!.relationships
    .filter((r) => r.predicate === 'contains' && r.peer_type === 'file')
    .map((r) => r.peer);

  const logs: KladosLogEntry[] = [];

  for (const fileId of logFiles) {
    const { data: file } = await client.api.GET('/entities/{id}', {
      params: { path: { id: fileId } },
    });

    if (file?.properties.type === 'klados_log') {
      const jobLog = file.properties.log_data as JobLog;
      logs.push(jobLog.entry);
    }
  }

  return logs;
}

/**
 * Get a specific log entry by ID
 */
export async function getLogEntry(
  client: ArkeClient,
  jobCollectionId: string,
  logId: string
): Promise<KladosLogEntry | null> {
  const logs = await getJobLogs(client, jobCollectionId);
  return logs.find((l) => l.id === logId) ?? null;
}

/**
 * Get the root log entry (entry klados)
 */
export async function getRootLog(
  client: ArkeClient,
  jobCollectionId: string
): Promise<KladosLogEntry | null> {
  const logs = await getJobLogs(client, jobCollectionId);
  // Root log has no from_logs
  return logs.find((l) => !l.received.from_logs || l.received.from_logs.length === 0) ?? null;
}

/**
 * Get child log entries (logs that received_from this log)
 */
export async function getChildLogs(
  client: ArkeClient,
  jobCollectionId: string,
  parentLogId: string
): Promise<KladosLogEntry[]> {
  const logs = await getJobLogs(client, jobCollectionId);
  return logs.filter((l) =>
    l.received.from_logs && l.received.from_logs.includes(parentLogId)
  );
}

/**
 * Get parent log entries
 * Returns multiple parents for gather operations
 */
export async function getParentLogs(
  client: ArkeClient,
  jobCollectionId: string,
  childLogId: string
): Promise<KladosLogEntry[]> {
  const logs = await getJobLogs(client, jobCollectionId);
  const child = logs.find((l) => l.id === childLogId);
  if (!child?.received.from_logs || child.received.from_logs.length === 0) {
    return [];
  }
  return logs.filter((l) => child.received.from_logs!.includes(l.id));
}

/**
 * Build a tree of log entries from root
 * Note: gather nodes appear under multiple parents in this representation
 */
export interface LogTree {
  entry: KladosLogEntry;
  children: LogTree[];
}

export async function buildLogTree(
  client: ArkeClient,
  jobCollectionId: string
): Promise<LogTree | null> {
  const logs = await getJobLogs(client, jobCollectionId);
  const root = logs.find((l) => !l.received.from_logs || l.received.from_logs.length === 0);

  if (!root) return null;

  function buildNode(log: KladosLogEntry): LogTree {
    const children = logs.filter((l) =>
      l.received.from_logs && l.received.from_logs.includes(log.id)
    );
    return {
      entry: log,
      children: children.map(buildNode),
    };
  }

  return buildNode(root);
}
```

### `src/logging/index.ts`

```typescript
export { KladosLogger } from './logger';

export {
  writeKladosLog,
  updateLogWithHandoffs,
  updateLogStatus,
} from './writer';
export type { WriteLogOptions, WriteLogResult } from './writer';

export {
  getJobLogs,
  getLogEntry,
  getRootLog,
  getChildLogs,
  getParentLogs,
  buildLogTree,
} from './chain';
export type { LogTree } from './chain';
```

---

## Usage Example

```typescript
import {
  KladosLogger,
  writeKladosLog,
  updateLogWithHandoffs,
  updateLogStatus,
} from '@arke-institute/rhiza';

// During klados execution
const logger = new KladosLogger();

logger.info('Starting processing', { target: entityId });
logger.info('Extracted 10 pages from PDF');
logger.success('Processing complete');

// Write log entry (on completion or error)
const { logId, fileId } = await writeKladosLog({
  client,
  jobCollectionId,
  entry: {
    id: logId,
    type: 'klados_log',
    rhiza_id: context.rhiza.id,
    klados_id: kladosId,
    job_id: context.job_id,
    started_at: startTime,
    completed_at: new Date().toISOString(),
    status: 'done',
    received: {
      target: context.target,
      // from_logs: single parent for pass/scatter, multiple parents for gather
      from_logs: context.rhiza.parent_logs,
      batch: context.rhiza.batch,
    },
    produced: {
      entity_ids: outputIds,
    },
    handoffs: [
      {
        type: 'scatter',
        target: 'ocr-service',
        target_type: 'klados',
        batch_id: batchId,
        invocations: [
          // Fire-and-forget: just the request we sent
          { request: ocrRequest1, batch_index: 0 },
          { request: ocrRequest2, batch_index: 1 },
          { request: ocrRequest3, batch_index: 2 },
        ],
      },
    ],
  },
  messages: logger.getMessages(),
  agentId,
  agentVersion,
});
```

---

## Key Design Points

### Fire-and-Forget Invocations

The `InvocationRecord` is simplified to just contain:
- `request`: The exact `KladosRequest` we sent (for replay on resume)
- `batch_index`: Optional batch index for scatter operations

We do not track the result of invocations. The invoked klados creates its own log entry pointing back to us via `received.from_logs`.

### Handoff Types

Only three handoff types exist:
- `pass`: 1:1 handoff to next klados or rhiza
- `scatter`: 1:N fan-out to multiple invocations
- `gather`: N:1 fan-in collecting results from siblings

The `target` can be either a klados ID or a rhiza ID. The `target_type` field records what was discovered at invocation time.

### Dual Storage of Parent References

The `from_logs` array is stored in two places:
1. **Properties** (`received.from_logs`): Direct data access when reading the log
2. **Relationships** (`received_from` predicate): Graph traversal via Arke's relationship queries

This enables both efficient data reading and graph-based log chain traversal.
