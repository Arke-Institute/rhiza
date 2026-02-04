/**
 * Test assertions for klados logs
 */

import type { KladosLogEntry, LogMessage, LogMessageCriteria } from './types';

/**
 * Assert that a klados log completed successfully
 *
 * @example
 * ```typescript
 * const log = await waitForKladosLog(jobCollectionId);
 * assertLogCompleted(log);
 * ```
 *
 * @param log - The klados log entry (or null)
 * @throws Error if log is null or has error status
 */
export function assertLogCompleted(log: KladosLogEntry | null): asserts log is KladosLogEntry {
  if (!log) {
    throw new Error('Expected klados log but got null');
  }

  if (log.properties.status === 'error') {
    const entry = log.properties.log_data.entry;
    const errorMsg = entry.error
      ? `${entry.error.code}: ${entry.error.message}`
      : 'Unknown error';
    throw new Error(`Klados log has error status: ${errorMsg}`);
  }

  if (log.properties.status !== 'done') {
    throw new Error(
      `Expected log status 'done' but got '${log.properties.status}'`
    );
  }
}

/**
 * Assert that a klados log failed with an error
 *
 * @param log - The klados log entry (or null)
 * @param expectedCode - Optional expected error code
 * @throws Error if log is null or doesn't have error status
 */
export function assertLogFailed(
  log: KladosLogEntry | null,
  expectedCode?: string
): asserts log is KladosLogEntry {
  if (!log) {
    throw new Error('Expected klados log but got null');
  }

  if (log.properties.status !== 'error') {
    throw new Error(
      `Expected log status 'error' but got '${log.properties.status}'`
    );
  }

  if (expectedCode) {
    const actualCode = log.properties.log_data.entry.error?.code;
    if (actualCode !== expectedCode) {
      throw new Error(
        `Expected error code '${expectedCode}' but got '${actualCode}'`
      );
    }
  }
}

/**
 * Assert that a klados log contains specific messages
 *
 * @example
 * ```typescript
 * assertLogHasMessages(log, [
 *   { level: 'info', textContains: 'Processing' },
 *   { level: 'success', textContains: 'completed' },
 * ]);
 * ```
 *
 * @param log - The klados log entry
 * @param criteria - Array of message criteria to match
 * @throws Error if any criteria is not matched
 */
export function assertLogHasMessages(
  log: KladosLogEntry,
  criteria: LogMessageCriteria[]
): void {
  const messages = log.properties.log_data.messages;

  for (const criterion of criteria) {
    const found = messages.some((msg) => matchesMessageCriteria(msg, criterion));

    if (!found) {
      const criteriaStr = JSON.stringify(criterion);
      const availableMessages = messages
        .map((m) => `  - [${m.level}] ${m.message}`)
        .join('\n');
      throw new Error(
        `No message matching criteria ${criteriaStr}.\nAvailable messages:\n${availableMessages}`
      );
    }
  }
}

/**
 * Assert that a klados log has at least a minimum number of messages
 *
 * @param log - The klados log entry
 * @param minCount - Minimum number of messages expected
 */
export function assertLogMessageCount(
  log: KladosLogEntry,
  minCount: number
): void {
  const actualCount = log.properties.log_data.messages.length;
  if (actualCount < minCount) {
    throw new Error(
      `Expected at least ${minCount} log messages but got ${actualCount}`
    );
  }
}

/**
 * Assert that a klados log has a handoff of a specific type
 *
 * @param log - The klados log entry
 * @param handoffType - Expected handoff type
 */
export function assertLogHasHandoff(
  log: KladosLogEntry,
  handoffType: 'invoke' | 'scatter' | 'complete' | 'error' | 'none'
): void {
  const handoffs = log.properties.log_data.entry.handoffs ?? [];
  const found = handoffs.some((h) => h.type === handoffType);

  if (!found) {
    const available = handoffs.map((h) => h.type).join(', ') || '(none)';
    throw new Error(
      `Expected handoff of type '${handoffType}' but found: ${available}`
    );
  }
}

/**
 * Check if a log message matches the given criteria
 */
function matchesMessageCriteria(
  message: LogMessage,
  criteria: LogMessageCriteria
): boolean {
  if (criteria.level && message.level !== criteria.level) {
    return false;
  }

  if (criteria.textContains && !message.message.includes(criteria.textContains)) {
    return false;
  }

  if (criteria.textEquals && message.message !== criteria.textEquals) {
    return false;
  }

  return true;
}
