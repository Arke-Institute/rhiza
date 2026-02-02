/**
 * Target Resolution
 *
 * Resolves targets from flow steps by evaluating route rules,
 * and discovers target types by fetching from the API.
 */

import type { ThenSpec, EntityRef } from '../types';
import type { MockArkeClient } from '../__tests__/fixtures/mock-client';
import { matchRoute } from './route';

/**
 * Resolve the target from a ThenSpec by evaluating route rules
 *
 * @param then - The ThenSpec to resolve
 * @param properties - The entity properties to match against route rules
 * @returns The resolved EntityRef, or null for done
 */
export function resolveTarget(
  then: ThenSpec,
  properties: Record<string, unknown>
): EntityRef | null {
  // Terminal - no target
  if ('done' in then) {
    return null;
  }

  // Get the default target and optional route rules
  let defaultTarget: EntityRef;
  let route: import('../types').RouteRule[] | undefined;

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
 * Discover the type of a target
 *
 * If the EntityRef has a type hint, returns it directly (no API call).
 * Otherwise, tries to fetch as klados first, then as rhiza.
 *
 * @param client - The Arke client
 * @param target - The target EntityRef
 * @returns 'klados' or 'rhiza'
 * @throws Error if target not found and no type hint
 */
export async function discoverTargetType(
  client: MockArkeClient,
  target: EntityRef
): Promise<'klados' | 'rhiza'> {
  // Fast path: type hint provided
  if (target.type === 'klados' || target.type === 'rhiza') {
    return target.type;
  }

  // Fallback: discover via API using target.pi
  const targetId = target.pi;

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
