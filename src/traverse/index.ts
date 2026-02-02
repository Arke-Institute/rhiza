/**
 * Log Chain Traversal
 *
 * Functions for traversing log chains to find leaves, errors, and build trees.
 * Log chains represent the execution history of a workflow.
 */

import type { KladosLogEntry } from '../types';

/**
 * Node in a log tree
 */
export interface LogNode {
  log: KladosLogEntry;
  children: LogNode[];
}

/**
 * Error leaf with context for resume
 */
export interface ErrorLeaf {
  log: KladosLogEntry;
  path: string[];
  retryable: boolean;
}

/**
 * Find all leaf logs (logs with no children)
 *
 * A leaf is a log that has no other logs pointing to it via from_logs.
 * Leaves represent the current frontier of execution.
 *
 * @param logs - Array of log entries
 * @returns Array of leaf log entries
 */
export function findLeaves(logs: KladosLogEntry[]): KladosLogEntry[] {
  if (logs.length === 0) {
    return [];
  }

  // Build a set of all log IDs that are referenced as parents
  const parentIds = new Set<string>();
  for (const log of logs) {
    if (log.received?.from_logs) {
      for (const parentId of log.received.from_logs) {
        parentIds.add(parentId);
      }
    }
  }

  // Leaves are logs that are not parents of any other log
  const leaves = logs.filter((log) => {
    // A leaf is not referenced as a parent by any other log
    return !logs.some(
      (other) => other.received?.from_logs?.includes(log.id)
    );
  });

  return leaves;
}

/**
 * Find all error leaves with context for resume
 *
 * Returns logs with status: error that are also leaves (no successful children).
 * Includes the path from root for debugging and the retryable flag.
 *
 * @param logs - Array of log entries
 * @returns Array of error leaves with context
 */
export function findErrorLeaves(logs: KladosLogEntry[]): ErrorLeaf[] {
  if (logs.length === 0) {
    return [];
  }

  // Build parent map for path construction
  const parentMap = buildParentMap(logs);

  // Find leaves that are errors
  const leaves = findLeaves(logs);
  const errorLeaves = leaves.filter((l) => l.status === 'error');

  return errorLeaves.map((log) => ({
    log,
    path: buildPath(log, parentMap, logs),
    retryable: log.error?.retryable ?? false,
  }));
}

/**
 * Build a map from log ID to its parent log IDs
 */
function buildParentMap(logs: KladosLogEntry[]): Map<string, string[]> {
  const parentMap = new Map<string, string[]>();

  for (const log of logs) {
    if (log.received?.from_logs) {
      parentMap.set(log.id, log.received.from_logs);
    }
  }

  return parentMap;
}

/**
 * Build the path from root to a log
 */
function buildPath(
  log: KladosLogEntry,
  parentMap: Map<string, string[]>,
  logs: KladosLogEntry[]
): string[] {
  const logById = new Map(logs.map((l) => [l.id, l]));
  const path: string[] = [];
  const visited = new Set<string>();

  function traverse(currentId: string): boolean {
    if (visited.has(currentId)) {
      return false;
    }
    visited.add(currentId);

    const current = logById.get(currentId);
    if (!current) {
      return false;
    }

    const parents = parentMap.get(currentId);
    if (!parents || parents.length === 0) {
      // This is the root
      path.unshift(current.klados_id);
      return true;
    }

    // Traverse to first parent
    if (traverse(parents[0])) {
      path.push(current.klados_id);
      return true;
    }

    return false;
  }

  traverse(log.id);

  // If path is empty or doesn't include this log, add it
  if (path.length === 0 || path[path.length - 1] !== log.klados_id) {
    path.push(log.klados_id);
  }

  return path;
}

/**
 * Build a tree structure from log entries
 *
 * The tree starts from the root log (no parents) and follows the
 * from_logs references to build parent-child relationships.
 *
 * @param logs - Array of log entries
 * @returns Root node of the tree, or null if empty
 */
export function buildLogTree(logs: KladosLogEntry[]): LogNode | null {
  if (logs.length === 0) {
    return null;
  }

  const logById = new Map(logs.map((l) => [l.id, l]));

  // Find root(s) - logs with no parents
  const roots = logs.filter(
    (log) => !log.received?.from_logs || log.received.from_logs.length === 0
  );

  if (roots.length === 0) {
    // No clear root, use the first log
    return buildNode(logs[0], logById, logs);
  }

  // Use first root (typically there's only one)
  return buildNode(roots[0], logById, logs);
}

/**
 * Build a node and its children recursively
 */
function buildNode(
  log: KladosLogEntry,
  logById: Map<string, KladosLogEntry>,
  allLogs: KladosLogEntry[]
): LogNode {
  // Find children - logs that have this log as a parent
  const children = allLogs.filter(
    (other) => other.received?.from_logs?.includes(log.id)
  );

  return {
    log,
    children: children.map((child) => buildNode(child, logById, allLogs)),
  };
}
