/**
 * KladosLogger - In-memory log message collector
 *
 * Collects log messages during klados execution.
 * Messages are written to the log entry when execution completes.
 */

import type { LogMessage } from '../types';

/**
 * KladosLogger - In-memory log message collector
 *
 * Usage:
 * ```typescript
 * const logger = new KladosLogger();
 * logger.info('Starting processing', { target: entityId });
 * logger.success('Processing complete');
 *
 * // Get messages for log entry
 * const messages = logger.getMessages();
 * ```
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
