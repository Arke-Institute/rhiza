/**
 * Klados Error Utilities
 *
 * Standard error codes and helpers for klados error handling.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type { BatchContext } from '../types';
import { updateLogStatus, type LogError } from '../logging/writer';
import { errorBatchSlotWithCAS } from '../handoff/gather-api';

/**
 * Standard error codes for klados workers
 *
 * Codes are grouped by default retryability:
 * - Retryable: transient issues that may resolve on retry
 * - Non-retryable: permanent failures that won't change on retry
 */
export const KladosErrorCode = {
  // Retryable errors (transient)
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TEMPORARY_FAILURE: 'TEMPORARY_FAILURE',

  // Non-retryable errors (permanent)
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_INPUT: 'INVALID_INPUT',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',

  // Unknown/internal
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PROCESSING_ERROR: 'PROCESSING_ERROR',
} as const;

export type KladosErrorCodeType = (typeof KladosErrorCode)[keyof typeof KladosErrorCode];

/**
 * Klados error structure
 */
export interface KladosError {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Codes that are retryable by default
 */
const RETRYABLE_CODES: string[] = [
  KladosErrorCode.NETWORK_ERROR,
  KladosErrorCode.RATE_LIMITED,
  KladosErrorCode.TIMEOUT,
  KladosErrorCode.SERVICE_UNAVAILABLE,
  KladosErrorCode.TEMPORARY_FAILURE,
];

/**
 * Create a KladosError with a standard code
 *
 * @param code - Error code from KladosErrorCode
 * @param message - Human-readable error message
 * @param retryableOverride - Override the default retryability for this code
 */
export function createKladosError(
  code: KladosErrorCodeType,
  message: string,
  retryableOverride?: boolean
): KladosError {
  const defaultRetryable = RETRYABLE_CODES.includes(code);

  return {
    code,
    message,
    retryable: retryableOverride ?? defaultRetryable,
  };
}

/**
 * Convert an unknown error to a KladosError
 *
 * Attempts to classify common error types automatically.
 */
export function toKladosError(error: unknown): KladosError {
  // Already a KladosError
  if (isKladosError(error)) {
    return error;
  }

  // Standard Error
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network-related errors
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    ) {
      return createKladosError(KladosErrorCode.NETWORK_ERROR, error.message);
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out')) {
      return createKladosError(KladosErrorCode.TIMEOUT, error.message);
    }

    // Rate limiting
    if (message.includes('rate limit') || message.includes('429')) {
      return createKladosError(KladosErrorCode.RATE_LIMITED, error.message);
    }

    // Not found
    if (message.includes('not found') || message.includes('404')) {
      return createKladosError(KladosErrorCode.NOT_FOUND, error.message);
    }

    // Permission errors
    if (
      message.includes('permission') ||
      message.includes('forbidden') ||
      message.includes('403') ||
      message.includes('unauthorized') ||
      message.includes('401')
    ) {
      return createKladosError(KladosErrorCode.PERMISSION_DENIED, error.message);
    }

    // Default: processing error (retryable to be safe)
    return createKladosError(KladosErrorCode.PROCESSING_ERROR, error.message, true);
  }

  // Unknown type
  return createKladosError(
    KladosErrorCode.INTERNAL_ERROR,
    typeof error === 'string' ? error : 'Unknown error',
    false
  );
}

/**
 * Type guard for KladosError
 */
export function isKladosError(error: unknown): error is KladosError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'retryable' in error &&
    typeof (error as KladosError).code === 'string' &&
    typeof (error as KladosError).message === 'string' &&
    typeof (error as KladosError).retryable === 'boolean'
  );
}

/**
 * Options for failKlados
 */
export interface FailKladosOptions {
  /** Log file entity ID */
  logFileId: string;

  /** Batch context (if in a scatter/gather) */
  batchContext?: BatchContext;

  /** The error to record */
  error: KladosError | Error | unknown;

  /** Log messages to include */
  messages?: import('../types').LogMessage[];

  /** Job collection ID for adding final_error relationship */
  jobCollectionId?: string;
}

/**
 * Mark a klados job as failed
 *
 * Handles both the log status update AND the batch slot error (if applicable).
 * This is the recommended way to handle errors in klados workers.
 *
 * @param client - Arke client
 * @param options - Failure options
 */
export async function failKlados(
  client: ArkeClient,
  options: FailKladosOptions
): Promise<void> {
  const kladosError = toKladosError(options.error);
  const logError: LogError = {
    code: kladosError.code,
    message: kladosError.message,
    retryable: kladosError.retryable,
  };

  // Update log status with error and messages
  await updateLogStatus(client, options.logFileId, 'error', {
    logError,
    messages: options.messages,
    jobCollectionId: options.jobCollectionId,
  });

  // Also update batch slot if applicable
  if (options.batchContext) {
    await errorBatchSlotWithCAS(
      client,
      options.batchContext.id,
      options.batchContext.index,
      {
        code: kladosError.code,
        message: kladosError.message,
        retryable: kladosError.retryable,
      }
    );
  }

  // Add final_error relationship to job collection for O(1) failure discovery
  if (options.jobCollectionId) {
    await client.api.POST('/updates/additive', {
      body: {
        updates: [{
          entity_id: options.jobCollectionId,
          relationships_add: [{
            predicate: 'final_error',
            peer: options.logFileId,
            peer_type: 'klados_log',
          }],
          note: 'Mark log as final error (failed workflow node)',
        }],
      },
    });
  }
}
