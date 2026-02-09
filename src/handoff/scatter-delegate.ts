/**
 * Scatter Utility Delegation
 *
 * Delegates large scatter operations to an external scatter-utility service
 * that uses Durable Objects for reliable batch dispatch.
 */

import type { InvokeOptions } from './invoke';

/**
 * Options for delegating scatter to external service
 */
export interface DelegateScatterOptions {
  /** Target klados or rhiza ID */
  targetId: string;

  /** Target type */
  targetType: 'klados' | 'rhiza';

  /** Output entity IDs to dispatch */
  outputs: string[];

  /** Invocation options (passed through to scatter-utility) */
  invokeOptions: InvokeOptions;

  /** Scatter utility service URL */
  scatterUtilityUrl: string;

  /** Auth token for scatter-utility service */
  authToken: string;
}

/**
 * Result of scatter delegation
 */
export interface DelegateScatterResult {
  /** Whether delegation was accepted */
  accepted: boolean;

  /** Dispatch ID for tracking (if accepted) */
  dispatchId?: string;

  /** Total items queued (if accepted) */
  totalItems?: number;

  /** Error message (if not accepted) */
  error?: string;
}

/**
 * Get the appropriate Authorization header format for a token
 */
function getAuthHeader(token: string): string {
  if (token.startsWith('ak_') || token.startsWith('uk_')) {
    return `ApiKey ${token}`;
  }
  return `Bearer ${token}`;
}

/**
 * Delegate scatter dispatch to external scatter-utility service
 *
 * The scatter-utility service handles:
 * - Batched dispatch via Durable Objects
 * - Retry with exponential backoff
 * - Progress tracking
 *
 * @param options - Delegation options
 * @returns Delegation result with dispatch ID
 */
export async function delegateToScatterUtility(
  options: DelegateScatterOptions
): Promise<DelegateScatterResult> {
  const {
    targetId,
    targetType,
    outputs,
    invokeOptions,
    scatterUtilityUrl,
    authToken,
  } = options;

  try {
    const response = await fetch(`${scatterUtilityUrl}/dispatch`, {
      method: 'POST',
      headers: {
        'Authorization': getAuthHeader(authToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetId,
        targetType,
        outputs,
        invokeOptions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || `HTTP ${response.status}`;
      } catch {
        errorMessage = errorText || `HTTP ${response.status}`;
      }

      return {
        accepted: false,
        error: `Scatter-utility error: ${errorMessage}`,
      };
    }

    const result = await response.json() as {
      accepted: boolean;
      dispatchId: string;
      totalItems: number;
    };

    return {
      accepted: result.accepted,
      dispatchId: result.dispatchId,
      totalItems: result.totalItems,
    };
  } catch (error) {
    return {
      accepted: false,
      error: `Scatter-utility request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
