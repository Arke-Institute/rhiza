/**
 * Klados log utilities for testing
 *
 * Includes tree-based traversal for multi-step workflows and scatter/gather operations.
 * Uses single-fetch-per-node (1 GET instead of 2) for efficient traversal.
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
 * Get the root log from a job collection
 *
 * Uses log_started relationships (sorted by started_at) to find the earliest log.
 * Falls back to legacy first_log relationship for old workflows.
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
  const rels = collection.relationships ?? [];

  // Prefer log_started relationships — root is the earliest by started_at
  const logStartedRels = rels.filter((r) => r.predicate === 'log_started');

  if (logStartedRels.length > 0) {
    logStartedRels.sort((a, b) => {
      const aTime = (a as any).properties?.started_at ?? '';
      const bTime = (b as any).properties?.started_at ?? '';
      return aTime.localeCompare(bTime);
    });
    return logStartedRels[0].peer;
  }

  // Fallback: legacy first_log relationship (old workflows)
  const firstLogRel = rels.find((r) => r.predicate === 'first_log');
  return firstLogRel?.peer ?? null;
}

/**
 * Wait for and retrieve the klados log from a job collection
 *
 * Uses the log_started relationship on the job collection for reliable discovery
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
      // Use log_started relationship for reliable discovery
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

/** Simple concurrency limiter (no external dependencies) */
function createPool(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= concurrency) {
        await new Promise<void>((resolve) => queue.push(resolve));
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
        if (queue.length > 0) queue.shift()!();
      }
    },
  };
}

/** Shared concurrency pool for tree traversal (50+ reads are safe per CLIENT_CONCURRENCY.md) */
const fetchPool = createPool(30);

/**
 * Result of getting log children
 */
interface LogChildrenResult {
  /** Array of child log entity IDs */
  childIds: string[];
  /** Total count of sent_to relationships (may be more than childIds if some don't exist yet) */
  sentToCount: number;
}

/**
 * Extract sent_to child IDs from an entity's relationships
 */
function extractChildIds(entity: Entity): string[] {
  return (entity.relationships?.filter((r) => r.predicate === 'sent_to') ?? []).map((r) => r.peer);
}

/**
 * Get children of a log by querying for outgoing sent_to relationships
 *
 * In the Rhiza log tree:
 * - Parents have `sent_to` outgoing relationships pointing to children
 * - Children have `received_from` outgoing relationships pointing to parents
 * - We use `sent_to` for traversal since it's an outgoing relationship (no indexing lag)
 *
 * @param logEntityId - Log entity ID to find children of
 * @returns Object with child IDs and total sent_to count
 */
export async function getLogChildren(logEntityId: string): Promise<LogChildrenResult> {
  try {
    const entity = await apiRequest<Entity>('GET', `/entities/${logEntityId}`);

    // Look for sent_to relationships pointing to children
    // Note: GET /entities/{id} only returns outgoing relationships,
    // so no direction check is needed.
    const sentToRels = entity.relationships?.filter((r) => r.predicate === 'sent_to') ?? [];
    const childIds = sentToRels.map((r) => r.peer);

    return {
      childIds,
      sentToCount: sentToRels.length,
    };
  } catch {
    return { childIds: [], sentToCount: 0 };
  }
}

/**
 * Extract expected children count from log messages
 *
 * Scatter workers log numCopies in their success message metadata.
 * This is the most reliable source for expected children count.
 *
 * @param log - Log entry to analyze
 * @returns Number of expected children from messages, or null if not found
 */
function extractExpectedChildrenFromMessages(log: KladosLogEntry): number | null {
  const messages = log.properties.log_data.messages ?? [];
  for (const msg of messages) {
    // Check for numCopies in message metadata (from scatter worker)
    if (msg.metadata?.numCopies !== undefined) {
      return msg.metadata.numCopies as number;
    }
  }
  return null;
}

/**
 * Calculate expected children count from handoffs
 *
 * Priority:
 * 1. numCopies from log messages (worker-provided, legacy support)
 * 2. outputs array from handoff record (framework-provided, most reliable)
 * 3. invocations array length (for local scatters without outputs field)
 * 4. Handoff type analysis (pass = 1, etc.)
 *
 * @param log - Log entry to analyze
 * @returns Number of expected children, or -1 if unknown (keep polling)
 */
function getExpectedChildrenCount(log: KladosLogEntry): number {
  // First, check log messages for numCopies (from scatter worker - legacy support)
  const numCopies = extractExpectedChildrenFromMessages(log);
  if (numCopies !== null) {
    return numCopies;
  }

  // Fall back to handoff analysis
  const entry = log.properties.log_data.entry;
  const handoffs = entry.handoffs ?? [];

  if (handoffs.length === 0) {
    return 0; // No handoffs = leaf node
  }

  let total = 0;
  for (const handoff of handoffs) {
    if (handoff.type === 'invoke' || handoff.type === 'pass') {
      // Invoke/pass creates 1 child
      total += 1;
    } else if (handoff.type === 'scatter') {
      // Scatter creates N children
      // Priority: outputs array (framework-provided) > invocations > unknown
      if (handoff.outputs && handoff.outputs.length > 0) {
        // Use outputs array - this is the most reliable source
        // Subtract done_slots since those don't create children
        const doneSlots = (handoff as { done_slots?: number }).done_slots ?? 0;
        total += handoff.outputs.length - doneSlots;
      } else if (handoff.invocations && handoff.invocations.length > 0) {
        // Use invocations array for local scatters (legacy)
        total += handoff.invocations.length;
      } else if (handoff.delegated) {
        // Delegated scatter without outputs field (shouldn't happen with new code)
        // Return -1 to indicate we need to keep polling
        total = -1;
        break;
      } else {
        // Fallback: expect at least 1 child
        total += 1;
      }
    } else if (handoff.type === 'gather') {
      // Gather creates 1 child (the gather target)
      total += 1;
    }
    // Other types = 0 children
  }

  return total;
}

/**
 * Check if a log is in a terminal state (will not change)
 */
function isTerminalStatus(log: KladosLogEntry): boolean {
  return log.properties.status === 'done' || log.properties.status === 'error';
}

/**
 * Cache for incremental tree traversal.
 * Stable subtrees (terminal + all expected children discovered + all children stable)
 * are reused between polls to avoid redundant API calls.
 */
interface TreeCache {
  /** IDs of nodes whose entire subtree is stable */
  stableIds: Set<string>;
  /** All nodes from the previous tree */
  nodes: Map<string, LogTreeNode>;
}

/**
 * Compute cache from a completed tree poll.
 * Marks nodes as stable if they and all descendants are terminal with all expected children.
 */
function computeTreeCache(tree: WorkflowLogTree): TreeCache {
  const stableIds = new Set<string>();
  const nodes = new Map<string, LogTreeNode>();

  if (tree.root) {
    markStableRecursive(tree.root, stableIds, nodes);
  }

  return { stableIds, nodes };
}

function markStableRecursive(
  node: LogTreeNode,
  stableIds: Set<string>,
  nodes: Map<string, LogTreeNode>
): boolean {
  nodes.set(node.log.id, node);

  if (!node.isTerminal) return false;
  if (node.expectedChildren < 0) return false;
  if (node.children.length < node.expectedChildren) return false;

  const childrenStable = node.children.every((child) =>
    markStableRecursive(child, stableIds, nodes)
  );
  if (childrenStable) {
    stableIds.add(node.log.id);
  }
  return childrenStable;
}

/** Mark all nodes in a subtree as visited (for cache hits) */
function markVisited(node: LogTreeNode, visited: Set<string>): void {
  visited.add(node.log.id);
  for (const child of node.children) {
    markVisited(child, visited);
  }
}

/**
 * Build a tree node recursively with:
 * - Single-fetch-per-node (1 GET instead of 2)
 * - Concurrent child fetching (bounded by fetchPool)
 * - Incremental caching (stable subtrees reused from previous poll)
 *
 * @param logId - Log entity ID
 * @param visited - Set of visited node IDs (prevents cycles)
 * @param cache - Optional cache from previous poll
 * @param fetchCount - Mutable counter for tracking API calls
 */
async function buildTreeNode(
  logId: string,
  visited: Set<string>,
  cache?: TreeCache,
  fetchCount?: { value: number }
): Promise<LogTreeNode | null> {
  if (visited.has(logId)) return null;
  visited.add(logId);

  // Use cached subtree if node was previously stable
  if (cache?.stableIds.has(logId)) {
    const cached = cache.nodes.get(logId);
    if (cached) {
      markVisited(cached, visited);
      return cached;
    }
  }

  // Single fetch: get entity with both properties and relationships
  let entity: Entity;
  try {
    entity = await fetchPool.run(() => apiRequest<Entity>('GET', `/entities/${logId}`));
    if (fetchCount) fetchCount.value++;
  } catch {
    return null;
  }

  const log = entity as KladosLogEntry;
  const childIds = extractChildIds(entity);

  const isTerminal = isTerminalStatus(log);
  const expectedChildren = getExpectedChildrenCount(log);

  // Fetch children concurrently (bounded by fetchPool)
  const childResults = await Promise.all(
    childIds.map((childId) => buildTreeNode(childId, visited, cache, fetchCount))
  );
  const children = childResults.filter((c): c is LogTreeNode => c !== null);

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
 * Extract output entity IDs from leaf nodes
 *
 * Collects all `produced.entity_ids` from terminal leaf nodes.
 * Only includes outputs from successfully completed nodes (status: 'done').
 *
 * @param leaves - Leaf nodes from the workflow tree
 * @returns Array of output entity IDs
 */
function extractOutputsFromLeaves(leaves: LogTreeNode[]): string[] {
  const outputs: string[] = [];
  for (const leaf of leaves) {
    // Only collect outputs from successful completions
    if (leaf.log.properties.status !== 'done') {
      continue;
    }
    const produced = leaf.log.properties.log_data.entry.produced;
    if (produced?.entity_ids) {
      outputs.push(...produced.entity_ids);
    }
  }
  return outputs;
}

/**
 * Extract all output entity IDs from a completed workflow tree
 *
 * This is a convenience function for getting final outputs from a workflow.
 * Use this after `waitForWorkflowTree` completes to get all produced entities.
 *
 * @example
 * ```typescript
 * const tree = await waitForWorkflowTree(jobCollectionId);
 * if (tree.isComplete && !tree.hasErrors) {
 *   const outputs = extractWorkflowOutputs(tree);
 *   console.log('Produced entities:', outputs);
 * }
 * ```
 *
 * @param tree - Completed workflow log tree
 * @returns Array of output entity IDs from all leaf nodes
 */
export function extractWorkflowOutputs(tree: WorkflowLogTree): string[] {
  if (!tree.isComplete) {
    return [];
  }
  return extractOutputsFromLeaves(tree.leaves);
}

/**
 * Check if all expected children have been discovered in the tree
 *
 * Returns false if:
 * - We don't know how many children to expect (expectedChildren === -1)
 * - We have fewer children than expected
 * - Any child hasn't discovered all its children (recursive)
 */
function checkAllChildrenDiscovered(node: LogTreeNode): boolean {
  // If node is still running, children may not exist yet - assume OK for now
  if (!node.isTerminal) {
    return true;
  }

  // If we don't know expected children count, keep polling
  if (node.expectedChildren < 0) {
    return false;
  }

  // If we have fewer children than expected, not complete
  if (node.children.length < node.expectedChildren) {
    return false;
  }

  // Recursively check all children
  for (const child of node.children) {
    if (!checkAllChildrenDiscovered(child)) {
      return false;
    }
  }
  return true;
}

/**
 * Collect all logs from a tree into a flat map
 */
function collectLogs(node: LogTreeNode, logsMap: Map<string, KladosLogEntry>): void {
  logsMap.set(node.log.id, node.log);
  for (const child of node.children) {
    collectLogs(child, logsMap);
  }
}

/**
 * Build a snapshot of the workflow log tree
 *
 * Uses recursive DFS with:
 * - Single-fetch-per-node (1 GET instead of 2)
 * - Concurrent child fetching (bounded concurrency pool)
 * - Incremental caching (stable subtrees reused from previous poll)
 *
 * @param jobCollectionId - Job collection ID
 * @param cache - Optional cache from previous poll for incremental updates
 * @returns Current state of the workflow log tree (includes fetchCount for diagnostics)
 */
export async function buildWorkflowTree(
  jobCollectionId: string,
  cache?: TreeCache,
): Promise<WorkflowLogTree> {
  // Find root via log_started relationship (earliest by started_at)
  const firstLogId = await getFirstLogFromCollection(jobCollectionId);

  if (!firstLogId) {
    return {
      root: null,
      logs: new Map(),
      isComplete: false,
      hasErrors: false,
      leaves: [],
      errors: [],
      allChildrenDiscovered: false,
      outputs: [],
      fetchCount: 1,
    };
  }

  // Build tree recursively with caching
  const visited = new Set<string>();
  const fetchCount = { value: 1 }; // 1 for the job collection fetch above
  const root = await buildTreeNode(firstLogId, visited, cache, fetchCount);

  if (!root) {
    return {
      root: null,
      logs: new Map(),
      isComplete: false,
      hasErrors: false,
      leaves: [],
      errors: [],
      allChildrenDiscovered: false,
      outputs: [],
      fetchCount: fetchCount.value,
    };
  }

  // Collect all logs into a flat map
  const logsMap = new Map<string, KladosLogEntry>();
  collectLogs(root, logsMap);

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

  // Extract outputs from leaf nodes (only if complete)
  const outputs = isComplete ? extractOutputsFromLeaves(leaves) : [];

  return {
    root,
    logs: logsMap,
    isComplete,
    hasErrors: errors.length > 0,
    leaves,
    errors,
    allChildrenDiscovered,
    outputs,
    fetchCount: fetchCount.value,
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
 * Uses single-fetch-per-node optimization (1 GET per node instead of 2).
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
    outputs: [],
    fetchCount: 0,
  };

  // Track stability: require the same log count for 2 consecutive polls
  // before declaring complete. This handles async sent_to relationship updates.
  let stableCount = 0;
  let lastLogCount = 0;

  // Incremental cache: stable subtrees are reused between polls
  let cache: TreeCache | undefined;

  while (Date.now() - startTime < timeout) {
    try {
      const tree = await buildWorkflowTree(jobCollectionId, cache);
      cache = computeTreeCache(tree);
      lastTree = tree;

      // Call optional progress callback
      if (options?.onPoll) {
        options.onPoll(tree, Date.now() - startTime);
      }

      if (tree.isComplete) {
        // Check if the tree is stable (same log count as last poll)
        if (tree.logs.size === lastLogCount) {
          stableCount++;
          // Require 2 stable polls before returning (handles async relationship updates)
          if (stableCount >= 2) {
            return tree;
          }
        } else {
          // Log count changed, reset stability counter
          stableCount = 0;
        }
      } else {
        stableCount = 0;
      }

      lastLogCount = tree.logs.size;
    } catch {
      // Ignore errors during polling, just retry
      stableCount = 0;
    }

    await sleep(pollInterval);
  }

  // Timeout - return last known state
  return lastTree;
}
