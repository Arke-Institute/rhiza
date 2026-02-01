/**
 * Route Matching
 *
 * Evaluates where conditions and matches route rules for conditional routing.
 */

import type { WhereCondition, RouteRule } from '../types';

/**
 * Get a nested property value using dot notation
 * e.g., "metadata.format" on { metadata: { format: "pdf" } } returns "pdf"
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluate a where condition against entity properties
 *
 * @param properties - The entity properties to evaluate against
 * @param where - The where condition to evaluate
 * @returns true if the condition matches
 */
export function evaluateWhere(
  properties: Record<string, unknown>,
  where: WhereCondition
): boolean {
  // Simple equality check
  if ('property' in where && 'equals' in where) {
    const value = getNestedValue(properties, where.property);
    return value === where.equals;
  }

  // AND condition - all must match
  if ('and' in where) {
    return where.and.every((condition) => evaluateWhere(properties, condition));
  }

  // OR condition - any must match
  if ('or' in where) {
    return where.or.some((condition) => evaluateWhere(properties, condition));
  }

  // Unknown condition type - should not match
  return false;
}

/**
 * Match route rules against entity properties
 *
 * Evaluates rules in order and returns the first matching rule.
 *
 * @param properties - The entity properties to match against
 * @param rules - The route rules to evaluate
 * @returns The first matching rule, or null if none match
 */
export function matchRoute(
  properties: Record<string, unknown>,
  rules: RouteRule[]
): RouteRule | null {
  for (const rule of rules) {
    if (rule.where && evaluateWhere(properties, rule.where)) {
      return rule;
    }
  }
  return null;
}
