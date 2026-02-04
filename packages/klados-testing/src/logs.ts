/**
 * Klados log utilities for testing
 */

import { apiRequest, sleep } from './client';
import type { Entity, KladosLogEntry, WaitForLogOptions } from './types';

/**
 * Get a klados log entry by ID
 *
 * @param logId - Log entity ID
 */
export async function getKladosLog(logId: string): Promise<KladosLogEntry> {
  return apiRequest<KladosLogEntry>('GET', `/entities/${logId}`);
}

/**
 * Get the first_log relationship from a job collection
 *
 * This is more reliable than the indexed /collections/{id}/entities endpoint
 * because it doesn't have indexing lag.
 *
 * @param collectionId - Job collection ID
 * @returns Log entity ID or null if not found
 */
export async function getFirstLogFromCollection(
  collectionId: string
): Promise<string | null> {
  const collection = await apiRequest<Entity>('GET', `/entities/${collectionId}`);

  // Find the first_log relationship
  const firstLogRel = collection.relationships?.find(
    (r) => r.predicate === 'first_log'
  );

  return firstLogRel?.peer ?? null;
}

/**
 * Wait for and retrieve the klados log from a job collection
 *
 * Uses the first_log relationship on the job collection for reliable discovery
 * (bypasses indexing lag of the /collections/{id}/entities endpoint).
 *
 * Waits for the log to reach a terminal state (done or error) before returning.
 *
 * @example
 * ```typescript
 * const log = await waitForKladosLog(result.jobCollectionId, {
 *   timeout: 30000,
 *   pollInterval: 1000,
 * });
 *
 * if (log) {
 *   console.log('Log status:', log.properties.status);
 * }
 * ```
 *
 * @param jobCollectionId - Job collection ID to search for logs
 * @param options - Wait options
 * @returns The log entry or null if not found within timeout
 */
export async function waitForKladosLog(
  jobCollectionId: string,
  options?: WaitForLogOptions
): Promise<KladosLogEntry | null> {
  const timeout = options?.timeout ?? 10000;
  const pollInterval = options?.pollInterval ?? 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      // Use first_log relationship for reliable discovery
      const firstLogId = await getFirstLogFromCollection(jobCollectionId);

      if (firstLogId) {
        const log = await getKladosLog(firstLogId);
        // Wait for terminal state (done or error)
        if (log.properties.status === 'done' || log.properties.status === 'error') {
          return log;
        }
        // Log exists but still running, continue polling
      }
    } catch {
      // Ignore errors during polling, just retry
    }

    await sleep(pollInterval);
  }

  return null;
}

/**
 * Get all log messages from a klados log
 *
 * @param log - The klados log entry
 */
export function getLogMessages(log: KladosLogEntry) {
  return log.properties.log_data.messages;
}

/**
 * Get the log entry details from a klados log
 *
 * @param log - The klados log entry
 */
export function getLogEntry(log: KladosLogEntry) {
  return log.properties.log_data.entry;
}
