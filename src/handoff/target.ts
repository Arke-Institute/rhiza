/**
 * Target Resolution
 *
 * Resolves step names from flow steps by evaluating route rules.
 * Pure function - no API calls.
 */

import type { ThenSpec } from '../types';
import { matchRoute } from './route';

/**
 * Resolve the target step name from a ThenSpec by evaluating route rules
 *
 * @param then - The ThenSpec to resolve
 * @param properties - The entity properties to match against route rules
 * @returns The resolved step name (string), or null for done
 */
export function resolveTarget(
  then: ThenSpec,
  properties: Record<string, unknown>
): string | null {
  // Terminal - no target
  if ('done' in then) {
    return null;
  }

  // Get the default target step name and optional route rules
  let defaultTarget: string;
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
