/**
 * Log Writer - SDK utilities for writing klados logs
 *
 * Uses the SDK to write log entries to the job collection.
 * CAS retry is handled by the SDK's withCasRetry utility.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import { withCasRetry } from '@arke-institute/sdk';
import type {
  KladosLogEntry,
  JobLog,
  LogMessage,
  HandoffRecord,
} from '../types';

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
  /** Log entity ID (the generated log ID) */
  logId: string;

  /** Log file entity ID (the actual file entity) */
  fileId: string;
}

/**
 * Write a klados log entry to the job collection
 *
 * Creates an entity with the log data and adds relationships
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

  // 1. Create entity with log data
  const { data: logEntity, error: createError } = await client.api.POST('/entities', {
    body: {
      type: 'klados_log',
      collection: jobCollectionId,
      properties: {
        rhiza_id: entry.rhiza_id,
        klados_id: entry.klados_id,
        job_id: entry.job_id,
        status: entry.status,
        log_data: jobLog as unknown as Record<string, unknown>,
      },
    },
  });

  if (createError || !logEntity) {
    throw new Error(`Failed to create log entity in ${jobCollectionId}: ${JSON.stringify(createError) || 'Unknown error'}`);
  }

  const logEntityId = logEntity.id;
  const hasParentLogs = entry.received.from_logs && entry.received.from_logs.length > 0;

  // 2. Build relationships for received_from chain traversal
  const relationships: Array<{
    predicate: string;
    peer: string;
    direction: 'outgoing';
  }> = [];

  // Add received_from relationships for graph traversal
  // These mirror the from_logs array in the entry properties
  if (hasParentLogs) {
    for (const parentLogId of entry.received.from_logs!) {
      relationships.push({
        predicate: 'received_from',
        peer: parentLogId,
        direction: 'outgoing',
      });
    }
  }

  // 3. Add relationships to the log entity if needed (CAS retry)
  if (relationships.length > 0) {
    await withCasRetry(
      {
        getTip: async () => {
          const { data, error } = await client.api.GET('/entities/{id}/tip', {
            params: { path: { id: logEntityId } },
          });
          if (error || !data) throw new Error('Failed to get log entity tip');
          return data.cid;
        },
        update: async (tip: string) => {
          return client.api.PUT('/entities/{id}', {
            params: { path: { id: logEntityId } },
            body: {
              expect_tip: tip,
              relationships_add: relationships,
            },
          });
        },
      },
      { concurrency: 100 }
    );
  }

  // 4. If this is the first log (no parent logs), add a first_log relationship
  // from the job collection to this log for easy discovery
  if (!hasParentLogs) {
    await withCasRetry(
      {
        getTip: async () => {
          const { data, error } = await client.api.GET('/entities/{id}/tip', {
            params: { path: { id: jobCollectionId } },
          });
          if (error || !data) throw new Error('Failed to get job collection tip');
          return data.cid;
        },
        update: async (tip: string) => {
          return client.api.PUT('/entities/{id}', {
            params: { path: { id: jobCollectionId } },
            body: {
              expect_tip: tip,
              relationships_add: [
                {
                  predicate: 'first_log',
                  peer: logEntityId,
                  direction: 'outgoing',
                },
              ],
            },
          });
        },
      },
      { concurrency: 10 }
    );
  }

  // 5. Update parent logs to add sent_to relationship pointing to this log
  // This enables traversal using only outgoing relationships (no indexing lag)
  if (hasParentLogs) {
    const parentLogIds = entry.received.from_logs!;
    const batchContext = entry.received.batch;

    // Determine concurrency based on context:
    // - Scatter: many siblings update same parent → use batch.total
    // - Gather/Pass: only this child updates each parent → use 1
    const isScatterChild = batchContext && parentLogIds.length === 1;
    const concurrencyPerParent = isScatterChild ? batchContext.total : 1;

    // Batch parallel updates for gather scenarios (many parents)
    const PARENT_UPDATE_BATCH_SIZE = 100;

    for (let i = 0; i < parentLogIds.length; i += PARENT_UPDATE_BATCH_SIZE) {
      const parentBatch = parentLogIds.slice(i, i + PARENT_UPDATE_BATCH_SIZE);

      await Promise.all(
        parentBatch.map((parentLogId) =>
          withCasRetry(
            {
              getTip: async () => {
                const { data, error } = await client.api.GET('/entities/{id}/tip', {
                  params: { path: { id: parentLogId } },
                });
                if (error || !data) throw new Error(`Failed to get parent log tip: ${parentLogId}`);
                return data.cid;
              },
              update: async (tip: string) => {
                return client.api.PUT('/entities/{id}', {
                  params: { path: { id: parentLogId } },
                  body: {
                    expect_tip: tip,
                    relationships_add: [
                      {
                        predicate: 'sent_to',
                        peer: logEntityId,
                        direction: 'outgoing',
                      },
                    ],
                  },
                });
              },
            },
            { concurrency: concurrencyPerParent }
          )
        )
      );
    }
  }

  return { logId: entry.id, fileId: logEntityId };
}

/**
 * Update log entry with handoff records
 *
 * Called after handoffs are made to record what was invoked.
 * Uses CAS retry for concurrent safety.
 */
export async function updateLogWithHandoffs(
  client: ArkeClient,
  logFileId: string,
  handoffs: HandoffRecord[]
): Promise<void> {
  await withCasRetry(
    {
      getTip: async () => {
        const { data, error } = await client.api.GET('/entities/{id}/tip', {
          params: { path: { id: logFileId } },
        });
        if (error || !data) throw new Error('Failed to get log tip');
        return data.cid;
      },
      update: async (tip: string) => {
        // Get current entity to merge with existing data
        const { data: entity, error: getError } = await client.api.GET('/entities/{id}', {
          params: { path: { id: logFileId } },
        });

        if (getError || !entity) {
          throw new Error('Failed to get log entity');
        }

        const logData = entity.properties.log_data as JobLog;
        logData.entry.handoffs = handoffs;

        return client.api.PUT('/entities/{id}', {
          params: { path: { id: logFileId } },
          body: {
            expect_tip: tip,
            properties: {
              ...entity.properties,
              log_data: logData as unknown as Record<string, unknown>,
            },
          },
        });
      },
    },
    { concurrency: 10 }
  );
}

/**
 * Log error info for status updates
 */
export interface LogError {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Options for updating log status
 */
export interface UpdateLogStatusOptions {
  /** Log error details (for error status) */
  logError?: LogError;
  /** Messages to append to the log */
  messages?: LogMessage[];
}

/**
 * Update log entry status (e.g., to done or error)
 *
 * Uses CAS retry for concurrent safety.
 */
export async function updateLogStatus(
  client: ArkeClient,
  logFileId: string,
  status: 'running' | 'done' | 'error',
  options?: UpdateLogStatusOptions
): Promise<void> {
  const { logError, messages } = options ?? {};

  await withCasRetry(
    {
      getTip: async () => {
        const { data, error } = await client.api.GET('/entities/{id}/tip', {
          params: { path: { id: logFileId } },
        });
        if (error || !data) throw new Error('Failed to get log tip');
        return data.cid;
      },
      update: async (tip: string) => {
        const { data: entity, error: getError } = await client.api.GET('/entities/{id}', {
          params: { path: { id: logFileId } },
        });

        if (getError || !entity) {
          throw new Error('Failed to get log entity');
        }

        const logData = entity.properties.log_data as JobLog;
        logData.entry.status = status;
        logData.entry.completed_at = new Date().toISOString();

        if (logError) {
          logData.entry.error = logError;
        }

        // Update messages if provided
        if (messages) {
          logData.messages = messages;
        }

        return client.api.PUT('/entities/{id}', {
          params: { path: { id: logFileId } },
          body: {
            expect_tip: tip,
            properties: {
              ...entity.properties,
              status, // Also update top-level for easy querying
              log_data: logData as unknown as Record<string, unknown>,
            },
          },
        });
      },
    },
    { concurrency: 10 }
  );
}
