/**
 * Klados log utilities for testing
 *
 * Includes tree-based traversal for multi-step workflows and scatter/gather operations.
 */

import { apiRequest, sleep } from './client.js';
import type {
  Entity,
  KladosLogEntry,
  WaitForLogOptions,
  LogTreeNode,
  WorkflowLogTree,
  WaitForWorkflowTreeOptions,
} from './types.js';

/**
 * Get a klados log entry by ID
 *
 * @param logId - Log entity ID
 */
export async function getKladosLog(logId: string): Promise<KladosLogEntry> {
  return apiRequest<KladosLogEntry>('GET', `/entities/${logId}`);
}

/**
 * Get the first_log relationship from a job collection
 *
 * This is more reliable than the indexed /collections/{id}/entities endpoint
 * because it doesn't have indexing lag.
 *
 * @param collectionId - Job collection ID
 * @returns Log entity ID or null if not found
 */
export async function getFirstLogFromCollection(
  collectionId: string
): Promise<string | null> {
  const collection = await apiRequest<Entity>('GET', `/entities/${collectionId}`);

  // Find the first_log relationship
  const firstLogRel = collection.relationships?.find(
    (r) => r.predicate === 'first_log'
  );

  return firstLogRel?.peer ?? null;
}

/**
 * Wait for and retrieve the klados log from a job collection
 *
 * Uses the first_log relationship on the job collection for reliable discovery
 * (bypasses indexing lag of the /collections/{id}/entities endpoint).
 *
 * Waits for the log to reach a terminal state (done or error) before returning.
 *
 * @example
 * ```typescript
 * const log = await waitForKladosLog(result.jobCollectionId, {
 *   timeout: 30000,
 *   pollInterval: 1000,
 * });
 *
 * if (log) {
 *   console.log('Log status:', log.properties.status);
 * }
 * ```
 *
 * @param jobCollectionId - Job collection ID to search for logs
 * @param options - Wait options
 * @returns The log entry or null if not found within timeout
 */
export async function waitForKladosLog(
  jobCollectionId: string,
  options?: WaitForLogOptions
): Promise<KladosLogEntry | null> {
  const timeout = options?.timeout ?? 10000;
  const pollInterval = options?.pollInterval ?? 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      // Use first_log relationship for reliable discovery
      const firstLogId = await getFirstLogFromCollection(jobCollectionId);

      if (firstLogId) {
        const log = await getKladosLog(firstLogId);
        // Wait for terminal state (done or error)
        if (log.properties.status === 'done' || log.properties.status === 'error') {
          return log;
        }
        // Log exists but still running, continue polling
      }
    } catch {
      // Ignore errors during polling, just retry
    }

    await sleep(pollInterval);
  }

  return null;
}

/**
 * Get all log messages from a klados log
 *
 * @param log - The klados log entry
 */
export function getLogMessages(log: KladosLogEntry) {
  return log.properties.log_data.messages;
}

/**
 * Get the log entry details from a klados log
 *
 * @param log - The klados log entry
 */
export function getLogEntry(log: KladosLogEntry) {
  return log.properties.log_data.entry;
}

// =============================================================================
// Log Tree Traversal
// =============================================================================

/**
 * Get children of a log by querying for outgoing sent_to relationships
 *
 * In the Rhiza log tree:
 * - Parents have `sent_to` outgoing relationships pointing to children
 * - Children have `received_from` outgoing relationships pointing to parents
 * - We use `sent_to` for traversal since it's an outgoing relationship (no indexing lag)
 *
 * @param logEntityId - Log entity ID to find children of
 * @returns Array of child log entity IDs
 */
export async function getLogChildren(logEntityId: string): Promise<string[]> {
  try {
    const entity = await apiRequest<Entity>('GET', `/entities/${logEntityId}`);

    // Look for outgoing sent_to relationships
    // (this log has sent_to pointing to its children)
    const childIds =
      entity.relationships
        ?.filter(
          (r) => r.predicate === 'sent_to' && r.direction === 'outgoing'
        )
        .map((r) => r.peer) ?? [];

    return childIds;
  } catch {
    return [];
  }
}

/**
 * Calculate expected children count from handoffs
 *
 * The testing package uses handoff types: 'invoke' | 'scatter' | 'complete' | 'error' | 'none'
 * - 'invoke': Creates 1 child (pass operation)
 * - 'scatter': Creates N children (tracked via job_id, not invocations array in testing types)
 * - 'complete': No children (workflow done)
 * - 'error': No children (error state)
 * - 'none': No children (no handoff)
 *
 * @param log - Log entry to analyze
 * @returns Number of expected children
 */
function getExpectedChildrenCount(log: KladosLogEntry): number {
  const entry = log.properties.log_data.entry;
  const handoffs = entry.handoffs ?? [];

  if (handoffs.length === 0) {
    return 0; // No handoffs = leaf node
  }

  let total = 0;
  for (const handoff of handoffs) {
    if (handoff.type === 'invoke') {
      // Invoke/pass creates 1 child
      total += 1;
    } else if (handoff.type === 'scatter') {
      // Scatter creates N children
      // In the testing types, we don't have invocations array,
      // so we rely on discovering children via relationships
      // For now, mark as expecting at least 1 child
      total += 1; // Will discover actual count via relationships
    }
    // 'complete', 'error', 'none' = 0 children
  }

  return total;
}

/**
 * Build a log tree node recursively
 *
 * @param logEntityId - Entity ID of the log
 * @param logsMap - Map to collect all discovered logs
 * @param visited - Set of visited log IDs to prevent cycles
 */
async function buildTreeNode(
  logEntityId: string,
  logsMap: Map<string, KladosLogEntry>,
  visited: Set<string>
): Promise<LogTreeNode | null> {
  if (visited.has(logEntityId)) {
    // Prevent infinite loops on malformed data
    const existingLog = logsMap.get(logEntityId);
    if (existingLog) {
      return {
        log: existingLog,
        children: [],
        isLeaf: true,
        isTerminal:
          existingLog.properties.status === 'done' ||
          existingLog.properties.status === 'error',
        expectedChildren: 0,
      };
    }
    return null;
  }

  visited.add(logEntityId);

  // Fetch the log entry
  let log: KladosLogEntry;
  try {
    log = await getKladosLog(logEntityId);
    logsMap.set(logEntityId, log);
  } catch {
    // Log doesn't exist yet or fetch failed
    return null;
  }

  const isTerminal =
    log.properties.status === 'done' || log.properties.status === 'error';
  const expectedChildren = getExpectedChildrenCount(log);

  // Find children via incoming relationships
  const childIds = await getLogChildren(logEntityId);

  // Recursively build child nodes
  const children: LogTreeNode[] = [];
  for (const childId of childIds) {
    const childNode = await buildTreeNode(childId, logsMap, visited);
    if (childNode) {
      children.push(childNode);
    }
  }

  // A node is a leaf if it's terminal AND has no expected children
  // OR if it has error status (errors stop the branch)
  const isLeaf =
    log.properties.status === 'error' ||
    (isTerminal && expectedChildren === 0);

  return {
    log,
    children,
    isLeaf,
    isTerminal,
    expectedChildren,
  };
}

/**
 * Collect all leaf nodes from a tree
 */
function collectLeaves(node: LogTreeNode): LogTreeNode[] {
  if (node.children.length === 0) {
    return [node];
  }
  return node.children.flatMap(collectLeaves);
}

/**
 * Check if all expected children have been discovered in the tree
 *
 * For scatter operations, we can't know the exact count from the testing types,
 * so we check if we have at least the minimum expected and all discovered children
 * are themselves complete.
 */
function checkAllChildrenDiscovered(node: LogTreeNode): boolean {
  // If node is running, children may not exist yet
  if (!node.isTerminal) {
    return true; // Can't verify yet, assume OK for now
  }

  // If we expect children but have none, not complete
  if (node.expectedChildren > 0 && node.children.length === 0) {
    return false;
  }

  // Recursively check all children
  return node.children.every(checkAllChildrenDiscovered);
}

/**
 * Build a snapshot of the workflow log tree
 *
 * This traverses the log tree starting from the first_log relationship
 * on the job collection, following incoming received_from relationships
 * to discover all logs in the workflow.
 *
 * @example
 * ```typescript
 * const tree = await buildWorkflowTree(jobCollectionId);
 *
 * if (tree.isComplete) {
 *   console.log('Workflow finished with', tree.logs.size, 'logs');
 *   if (tree.hasErrors) {
 *     console.log('Errors:', tree.errors);
 *   }
 * }
 * ```
 *
 * @param jobCollectionId - Job collection ID
 * @returns Current state of the workflow log tree
 */
export async function buildWorkflowTree(
  jobCollectionId: string
): Promise<WorkflowLogTree> {
  const logsMap = new Map<string, KladosLogEntry>();
  const visited = new Set<string>();

  // Find root via first_log relationship
  const firstLogId = await getFirstLogFromCollection(jobCollectionId);

  if (!firstLogId) {
    return {
      root: null,
      logs: logsMap,
      isComplete: false,
      hasErrors: false,
      leaves: [],
      errors: [],
      allChildrenDiscovered: false,
    };
  }

  // Build tree starting from root
  const root = await buildTreeNode(firstLogId, logsMap, visited);

  if (!root) {
    return {
      root: null,
      logs: logsMap,
      isComplete: false,
      hasErrors: false,
      leaves: [],
      errors: [],
      allChildrenDiscovered: false,
    };
  }

  // Collect leaves and analyze tree
  const leaves = collectLeaves(root);
  const allChildrenDiscovered = checkAllChildrenDiscovered(root);

  // Workflow is complete when:
  // 1. All leaves are terminal (done or error)
  // 2. All expected children have been discovered
  const allLeavesTerminal = leaves.every((leaf) => leaf.isTerminal);
  const isComplete = allLeavesTerminal && allChildrenDiscovered;

  // Collect errors
  const errors: WorkflowLogTree['errors'] = [];
  for (const log of logsMap.values()) {
    if (log.properties.status === 'error') {
      const entry = log.properties.log_data.entry;
      if (entry.error) {
        errors.push({
          logId: log.id,
          kladosId: log.properties.klados_id,
          error: entry.error,
        });
      }
    }
  }

  return {
    root,
    logs: logsMap,
    isComplete,
    hasErrors: errors.length > 0,
    leaves,
    errors,
    allChildrenDiscovered,
  };
}

/**
 * Wait for a workflow to complete by polling the log tree
 *
 * This function properly handles:
 * - Multi-step workflows (A → B → C)
 * - Scatter operations (A → [B1, B2, B3])
 * - Nested scatters
 * - Gather operations
 * - Mixed success/error branches
 *
 * Unlike `waitForKladosLog` which only checks the first log, this function
 * traverses the entire log tree and waits for ALL branches to complete.
 *
 * @example
 * ```typescript
 * // Wait for a scatter workflow to complete
 * const tree = await waitForWorkflowTree(jobCollectionId, {
 *   timeout: 60000,
 *   pollInterval: 2000,
 * });
 *
 * if (tree.isComplete) {
 *   console.log('All', tree.logs.size, 'logs completed');
 *   if (tree.hasErrors) {
 *     console.log('Some branches failed:', tree.errors);
 *   } else {
 *     console.log('Workflow succeeded!');
 *   }
 * } else {
 *   console.log('Workflow timed out');
 * }
 * ```
 *
 * @param jobCollectionId - Job collection ID
 * @param options - Wait options
 * @returns Final state of the workflow log tree
 */
export async function waitForWorkflowTree(
  jobCollectionId: string,
  options?: WaitForWorkflowTreeOptions
): Promise<WorkflowLogTree> {
  const timeout = options?.timeout ?? 30000;
  const pollInterval = options?.pollInterval ?? 2000;
  const startTime = Date.now();

  let lastTree: WorkflowLogTree = {
    root: null,
    logs: new Map(),
    isComplete: false,
    hasErrors: false,
    leaves: [],
    errors: [],
    allChildrenDiscovered: false,
  };

  while (Date.now() - startTime < timeout) {
    try {
      const tree = await buildWorkflowTree(jobCollectionId);
      lastTree = tree;

      // Call optional progress callback
      if (options?.onPoll) {
        options.onPoll(tree, Date.now() - startTime);
      }

      if (tree.isComplete) {
        return tree;
      }
    } catch {
      // Ignore errors during polling, just retry
    }

    await sleep(pollInterval);
  }

  // Timeout - return last known state
  return lastTree;
}
