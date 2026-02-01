/**
 * Target Resolution
 *
 * Resolves targets from flow steps by evaluating route rules,
 * and discovers target types by fetching from the API.
 */

import type { ThenSpec } from '../types';
import type { MockArkeClient } from '../__tests__/fixtures/mock-client';
import { matchRoute } from './route';

/**
 * Resolve the target from a ThenSpec by evaluating route rules
 *
 * @param then - The ThenSpec to resolve
 * @param properties - The entity properties to match against route rules
 * @returns The resolved target ID, or null for done
 */
export function resolveTarget(
  then: ThenSpec,
  properties: Record<string, unknown>
): string | null {
  // Terminal - no target
  if ('done' in then) {
    return null;
  }

  // Get the default target and optional route rules
  let defaultTarget: string;
  let route: Array<{ where: import('../types').WhereCondition; target: string }> | undefined;

  if ('pass' in then) {
    defaultTarget = then.pass;
    route = then.route;
  } else if ('scatter' in then) {
    defaultTarget = then.scatter;
    route = then.route;
  } else if ('gather' in then) {
    defaultTarget = then.gather;
    route = then.route;
  } else {
    // Should not happen with well-typed ThenSpec
    return null;
  }

  // If no route rules, return default
  if (!route || route.length === 0) {
    return defaultTarget;
  }

  // Evaluate route rules - first match wins
  const matched = matchRoute(properties, route);
  if (matched) {
    return matched.target;
  }

  // No route matched - return default
  return defaultTarget;
}

/**
 * Discover the type of a target by fetching it from the API
 *
 * Tries to fetch as klados first, then as rhiza.
 *
 * @param client - The Arke client
 * @param targetId - The target ID to discover
 * @returns 'klados' or 'rhiza'
 * @throws Error if target not found
 */
export async function discoverTargetType(
  client: MockArkeClient,
  targetId: string
): Promise<'klados' | 'rhiza'> {
  // Try as klados first
  const kladosResult = await client.api.GET('/kladoi/{id}', {
    params: { path: { id: targetId } },
  });

  if (!kladosResult.error && kladosResult.data) {
    return 'klados';
  }

  // Try as rhiza
  const rhizaResult = await client.api.GET('/rhizai/{id}', {
    params: { path: { id: targetId } },
  });

  if (!rhizaResult.error && rhizaResult.data) {
    return 'rhiza';
  }

  throw new Error(`Target '${targetId}' not found as klados or rhiza`);
}
