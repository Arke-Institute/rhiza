/**
 * Log Writer - SDK utilities for writing klados logs
 *
 * Uses fire-and-forget additive updates for log relationships.
 * Status updates use additive (awaited to ensure request is sent).
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type {
  KladosLogEntry,
  JobLog,
  LogMessage,
  HandoffRecord,
} from '../types';

/**
 * Queue additive updates (fire-and-forget)
 *
 * Uses /updates/additive for CAS-conflict-free updates.
 * Returns immediately, updates are processed asynchronously by the server.
 *
 * This eliminates the CAS retry delays that were causing 5+ minute handoff times.
 */
function queueAdditiveUpdates(
  client: ArkeClient,
  updates: Array<{
    entity_id: string;
    properties?: Record<string, unknown>;
    relationships_add?: Array<{
      predicate: string;
      peer: string;
      peer_type?: string;
    }>;
    note?: string;
  }>
): void {
  // Fire and forget - don't await
  client.api.POST('/updates/additive', {
    body: { updates },
  }).catch((err) => {
    console.error('[rhiza] Failed to queue additive updates:', err);
  });
}

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
  }> = [];

  // Add received_from relationships for graph traversal
  // These mirror the from_logs array in the entry properties
  if (hasParentLogs) {
    for (const parentLogId of entry.received.from_logs!) {
      relationships.push({
        predicate: 'received_from',
        peer: parentLogId,
      });
    }
  }

  // 3. Add relationships to the log entity if needed (fire-and-forget)
  if (relationships.length > 0) {
    queueAdditiveUpdates(client, [{
      entity_id: logEntityId,
      relationships_add: relationships,
      note: 'Add received_from relationships to log',
    }]);
  }

  // 4. If this is the first log (no parent logs), add a first_log relationship
  // from the job collection to this log for easy discovery (fire-and-forget)
  if (!hasParentLogs) {
    queueAdditiveUpdates(client, [{
      entity_id: jobCollectionId,
      relationships_add: [{
        predicate: 'first_log',
        peer: logEntityId,
      }],
      note: 'Add first_log relationship to job collection',
    }]);
  }

  // 5. Update parent logs to add sent_to relationship pointing to this log
  // This enables traversal using only outgoing relationships (no indexing lag)
  // IMPORTANT: Must await these updates - they're critical for tree traversal
  if (hasParentLogs) {
    const parentLogIds = entry.received.from_logs!;

    // Batch all parent updates into a single additive call (max 100 per call)
    const BATCH_SIZE = 100;
    for (let i = 0; i < parentLogIds.length; i += BATCH_SIZE) {
      const batch = parentLogIds.slice(i, i + BATCH_SIZE);
      await client.api.POST('/updates/additive', {
        body: {
          updates: batch.map(parentLogId => ({
            entity_id: parentLogId,
            relationships_add: [{
              predicate: 'sent_to',
              peer: logEntityId,
            }],
            note: 'Add sent_to relationship from parent log',
          })),
        },
      });
    }
  }

  // NOTE: Input entity linking (has_processing_log) is done in updateLogStatus,
  // AFTER the job completes. This avoids race conditions where our relationship
  // addition changes the entity tip before the worker's CAS update.

  return { logId: entry.id, fileId: logEntityId };
}

/**
 * Update log entry with handoff records
 *
 * Called after handoffs are made to record what was invoked.
 * Uses fire-and-forget additive updates with deep merge.
 */
export function updateLogWithHandoffs(
  client: ArkeClient,
  logFileId: string,
  handoffs: HandoffRecord[]
): void {
  queueAdditiveUpdates(client, [{
    entity_id: logFileId,
    properties: {
      log_data: {
        entry: {
          handoffs,
        },
      },
    },
    note: 'Add handoff records to log',
  }]);
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
  /** Output entity IDs produced by this job */
  outputs?: string[];
  /**
   * Input entity IDs that were processed (for has_processing_log).
   * Only used when linkEntitiesToLogs is true.
   */
  inputEntityIds?: string[];
  /**
   * Link entities to this log via relationships:
   * - has_processing_log: input entities → log
   * - has_creation_log: output entities → log
   *
   * Best-effort - failures are logged but don't fail the job.
   * @default false
   */
  linkEntitiesToLogs?: boolean;
}

/**
 * Update log entry status (e.g., to done or error)
 *
 * Returns a promise that resolves when the additive update is queued.
 * The actual update is eventually consistent.
 */
export async function updateLogStatus(
  client: ArkeClient,
  logFileId: string,
  status: 'running' | 'done' | 'error',
  options?: UpdateLogStatusOptions
): Promise<void> {
  const { logError, messages, outputs, inputEntityIds } = options ?? {};
  const completedAt = new Date().toISOString();

  // Build the nested property update
  const entryUpdate: Record<string, unknown> = {
    status,
    completed_at: completedAt,
  };

  if (logError) {
    entryUpdate.error = logError;
  }

  if (outputs && outputs.length > 0) {
    entryUpdate.outputs = outputs;
  }

  const logDataUpdate: Record<string, unknown> = {
    entry: entryUpdate,
  };

  if (messages) {
    logDataUpdate.messages = messages;
  }

  // Await additive update to ensure request is sent before worker terminates
  await client.api.POST('/updates/additive', {
    body: {
      updates: [{
        entity_id: logFileId,
        properties: {
          status, // Top-level for easy querying
          log_data: logDataUpdate,
        },
        note: `Update log status to ${status}`,
      }],
    },
  });

  // Link input entities to this log (if enabled)
  // Done here (after job completes) to avoid race conditions with worker's CAS updates
  // IMPORTANT: Must await to ensure completion before worker terminates
  if (options?.linkEntitiesToLogs && inputEntityIds && inputEntityIds.length > 0) {
    try {
      await client.api.POST('/updates/additive', {
        body: {
          updates: inputEntityIds.map(entityId => ({
            entity_id: entityId,
            relationships_add: [{
              predicate: 'has_processing_log',
              peer: logFileId,
              peer_type: 'klados_log',
            }],
            note: 'Link input entity to processing log',
          })),
        },
      });
    } catch (err) {
      console.warn('[rhiza] Failed to link input entities to log:', (err as Error).message || err);
    }
  }

  // Link output entities to this log (if enabled)
  // Best-effort - don't fail job if this fails (e.g., missing entity:update permission)
  // IMPORTANT: Must await to ensure completion before worker terminates
  if (options?.linkEntitiesToLogs && outputs && outputs.length > 0) {
    try {
      await client.api.POST('/updates/additive', {
        body: {
          updates: outputs.map(entityId => ({
            entity_id: entityId,
            relationships_add: [{
              predicate: 'has_creation_log',
              peer: logFileId,
              peer_type: 'klados_log',
            }],
            note: 'Link output entity to creation log',
          })),
        },
      });
    } catch (err) {
      console.warn('[rhiza] Failed to link output entities to log:', (err as Error).message || err);
    }
  }
}
