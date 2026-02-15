/**
 * Scatter Utility Delegation
 *
 * Delegates large scatter operations to an external scatter-utility service
 * that uses Durable Objects for reliable batch dispatch.
 */

import type { InvokeOptions } from './invoke';

/**
 * Per-item dispatch output with its own target
 */
export interface DelegateOutputItem {
  /** Entity ID to dispatch */
  id: string;
  /** Target klados or rhiza ID for this item */
  target: string;
  /** Target type for this item */
  targetType?: 'klados' | 'rhiza';
  /** Step name for rhiza path building (when routing to different steps) */
  stepName?: string;
}

/**
 * Output for delegation - either a simple entity ID or an item with per-item target
 */
export type DelegateOutput = string | DelegateOutputItem;

/**
 * Options for delegating scatter to external service
 *
 * Supports two modes:
 * 1. Single target: All outputs go to the same targetId
 *    - targetId and targetType required
 *    - outputs is string[] of entity IDs
 *
 * 2. Per-item targets: Each output specifies its own target
 *    - targetId and targetType optional
 *    - outputs is DelegateOutputItem[] with per-item targets
 */
export interface DelegateScatterOptions {
  /** Default target klados or rhiza ID (required for single-target, optional for per-item) */
  targetId?: string;

  /** Default target type (required for single-target, optional for per-item) */
  targetType?: 'klados' | 'rhiza';

  /** Output entity IDs or items with per-item targets to dispatch */
  outputs: DelegateOutput[];

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
