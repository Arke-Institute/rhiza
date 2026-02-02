/**
 * Scatter Helpers
 *
 * Pure functions for scatter/gather operations.
 * No API calls - workers should use SDK directly for invocations.
 */

import type { FlowStep, EntityRef } from '../types';

/**
 * Find the gather target for a scatter operation
 *
 * Looks up the target klados in the flow and returns the gather target
 * if the target has a gather handoff.
 *
 * @param flow - The rhiza flow definition
 * @param targetKladosId - The scatter target klados ID
 * @returns The gather target EntityRef, or null if not a gather handoff
 */
export function findGatherTarget(
  flow: Record<string, FlowStep>,
  targetKladosId: string
): EntityRef | null {
  const step = flow[targetKladosId];
  if (!step || !step.then) {
    return null;
  }

  if ('gather' in step.then) {
    return step.then.gather;
  }

  return null;
}
