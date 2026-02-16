/**
 * Target Resolution
 *
 * Resolves step names from flow steps by evaluating route rules.
 * Pure function - no API calls.
 */

import type { ThenSpec, Output, OutputItem } from '../types';
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
  } else if ('recurse' in then) {
    defaultTarget = then.recurse;
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
 * Normalize an output to OutputItem format
 *
 * @param output - String entity ID or OutputItem object
 * @returns OutputItem with entity_id and any routing properties
 */
export function normalizeOutput(output: Output): OutputItem {
  return typeof output === 'string'
    ? { entity_id: output }
    : output;
}

/**
 * Group outputs by their resolved target step
 *
 * Evaluates route rules for each output item individually and groups them
 * by their resolved target. Items without matching routes go to the default target.
 *
 * @param outputs - Array of outputs (string IDs or OutputItem objects)
 * @param then - The ThenSpec containing default target and optional routes
 * @returns Map of target step name to array of OutputItems
 *
 * Example:
 * ```typescript
 * const groups = groupOutputsByTarget(
 *   [
 *     { entity_id: "abc", entity_class: "canonical" },
 *     { entity_id: "xyz", entity_class: "mention" },
 *   ],
 *   { scatter: "describe", route: [{ where: { property: "entity_class", equals: "mention" }, target: "done" }] }
 * );
 * // Returns: Map { "describe" => [{ entity_id: "abc", ... }], "done" => [{ entity_id: "xyz", ... }] }
 * ```
 */
export function groupOutputsByTarget(
  outputs: Output[],
  then: ThenSpec
): Map<string, OutputItem[]> {
  const groups = new Map<string, OutputItem[]>();

  for (const output of outputs) {
    const item = normalizeOutput(output);
    const target = resolveTarget(then, item);

    // target is null only for { done: true } ThenSpec, which shouldn't have routes
    // but handle gracefully
    const targetKey = target ?? 'done';

    if (!groups.has(targetKey)) {
      groups.set(targetKey, []);
    }
    groups.get(targetKey)!.push(item);
  }

  return groups;
}
