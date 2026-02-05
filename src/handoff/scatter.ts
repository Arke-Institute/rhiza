/**
 * Scatter Helpers
 *
 * Pure functions for scatter/gather operations.
 * No API calls - workers should use SDK directly for invocations.
 */

import type { FlowStep } from '../types';

/**
 * Find the gather target step name for a scatter operation
 *
 * Looks up the target step in the flow and returns the gather target step name
 * if the target has a gather handoff.
 *
 * @param flow - The rhiza flow definition
 * @param targetStepName - The scatter target step name
 * @returns The gather target step name, or null if not a gather handoff
 */
export function findGatherTarget(
  flow: Record<string, FlowStep>,
  targetStepName: string
): string | null {
  const step = flow[targetStepName];
  if (!step || !step.then) {
    return null;
  }

  if ('gather' in step.then) {
    return step.then.gather;
  }

  return null;
}
