/**
 * Log Writer - SDK utilities for writing klados logs
 *
 * All additive updates are awaited to ensure completion before
 * Tier 1 workers terminate. Uses /updates/additive for CAS-conflict-free
 * updates (no retries needed, single POST per call).
 */

import type { ArkeClient } from '@arke-institute/sdk';
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

  /** Human-readable agent label (used for log entity label) */
  agentLabel?: string;
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

  // Generate a human-readable label for the log
  const logLabel = options.agentLabel || `${entry.klados_id} - ${entry.job_id}`;

  // 1. Create entity with log data
  const { data: logEntity, error: createError } = await client.api.POST('/entities', {
    body: {
      type: 'klados_log',
      collection: jobCollectionId,
      properties: {
        label: logLabel,
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

  // 3. Batch: received_from on log + log_started on job collection (single request)
  const additiveUpdates: Array<{
    entity_id: string;
    relationships_add: Array<{
      predicate: string;
      peer: string;
      peer_type?: string;
      properties?: Record<string, unknown>;
    }>;
    note: string;
  }> = [];

  if (relationships.length > 0) {
    additiveUpdates.push({
      entity_id: logEntityId,
      relationships_add: relationships,
      note: 'Add received_from relationships to log',
    });
  }

  additiveUpdates.push({
    entity_id: jobCollectionId,
    relationships_add: [{
      predicate: 'log_started',
      peer: logEntityId,
      peer_type: 'klados_log',
      properties: {
        started_at: entry.started_at,
        klados_id: entry.klados_id,
      },
    }],
    note: 'Track log start for progress',
  });

  await client.api.POST('/updates/additive', {
    body: { updates: additiveUpdates },
  });

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

  // NOTE: Input entity linking (log_input) is done in updateLogStatus,
  // AFTER the job completes. This avoids race conditions where our relationship
  // addition changes the entity tip before the worker's CAS update.

  return { logId: entry.id, fileId: logEntityId };
}

/**
 * Update log entry with handoff records
 *
 * Called after handoffs are made to record what was invoked.
 * Uses additive updates with deep merge.
 */
export async function updateLogWithHandoffs(
  client: ArkeClient,
  logFileId: string,
  handoffs: HandoffRecord[]
): Promise<void> {
  await client.api.POST('/updates/additive', {
    body: {
      updates: [{
        entity_id: logFileId,
        properties: {
          log_data: {
            entry: {
              handoffs,
            },
          },
        },
        note: 'Add handoff records to log',
      }],
    },
  });
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
   * Input entity IDs that were processed (for log_input relationship).
   * Only used when linkEntitiesToLogs is true.
   */
  inputEntityIds?: string[];
  /** Job collection ID for progress tracking */
  jobCollectionId?: string;
  /**
   * Whether this is a terminal workflow node (done handoff or no then spec).
   * When true and status is 'done', adds final_output relationship to job collection.
   * @default false
   */
  isTerminal?: boolean;
  /**
   * Link entities to this log via relationships:
   * - log_input: input entities → log
   * - log_output: output entities → log
   *
   * Best-effort - failures are logged but don't fail the job.
   * @default true
   */
  linkEntitiesToLogs?: boolean;
}

/**
 * Update log entry status (e.g., to done or error)
 *
 * Awaits all additive updates to ensure they complete before the worker terminates.
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

  // Write log_done to job collection for progress tracking
  // IMPORTANT: Must await to ensure completion before Tier 1 worker terminates
  if (status === 'done' && options?.jobCollectionId) {
    const relationships: Array<{ predicate: string; peer: string; peer_type: string; properties?: Record<string, unknown> }> = [{
      predicate: 'log_done',
      peer: logFileId,
      peer_type: 'klados_log',
      properties: {
        completed_at: completedAt,
      },
    }];

    // Add final_output for terminal workflow nodes (done handoff or no then spec)
    if (options.isTerminal) {
      relationships.push({
        predicate: 'final_output',
        peer: logFileId,
        peer_type: 'klados_log',
      });
    }

    await client.api.POST('/updates/additive', {
      body: {
        updates: [{
          entity_id: options.jobCollectionId,
          relationships_add: relationships,
          note: options.isTerminal
            ? 'Track log completion and mark as final output'
            : 'Track log completion for progress',
        }],
      },
    });
  }

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
              predicate: 'log_input',
              peer: logFileId,
              peer_type: 'klados_log',
            }],
            note: 'Link input entity to log',
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
              predicate: 'log_output',
              peer: logFileId,
              peer_type: 'klados_log',
            }],
            note: 'Link output entity to log',
          })),
        },
      });
    } catch (err) {
      console.warn('[rhiza] Failed to link output entities to log:', (err as Error).message || err);
    }
  }
}
