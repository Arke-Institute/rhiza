/**
 * Rhiza workflow utilities for testing
 *
 * These utilities help test complete workflow compositions by:
 * - Invoking rhiza workflows
 * - Polling for workflow completion across multiple steps
 * - Retrieving all logs from a workflow execution
 */

import { apiRequest, sleep } from './client.js';
import type { KladosLogEntry, WaitForLogOptions, Entity } from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for invoking a rhiza workflow
 */
export interface InvokeRhizaOptions {
  /** Rhiza ID to invoke */
  rhizaId: string;
  /** Collection for permission scope (required) */
  targetCollection: string;
  /** Single entity to process (for entry klados with cardinality: 'one') */
  targetEntity?: string;
  /** Multiple entities to process (for entry klados with cardinality: 'many') */
  targetEntities?: string[];
  /** Job collection for logs */
  jobCollection: string;
  /** Execute (true) or preview (false) */
  confirm?: boolean;
  /** Optional input data passed to entry klados */
  input?: Record<string, unknown>;
}

/**
 * Result of invoking a rhiza workflow
 */
export interface InvokeRhizaResult {
  status: 'started' | 'rejected' | 'pending_confirmation';
  job_id?: string;
  job_collection?: string;
  rhiza_id?: string;
  error?: string;
  message?: string;
}

/**
 * Result of waiting for workflow completion
 */
export interface WorkflowCompletionResult {
  /** Overall workflow status */
  status: 'done' | 'error' | 'timeout';
  /** All klados log entries from the workflow */
  logs: KladosLogEntry[];
  /** Final output entity IDs (from last step) */
  finalOutputs: string[];
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Options for creating a rhiza entity
 */
export interface CreateRhizaOptions {
  /** Display label for the rhiza */
  label: string;
  /** Description of what this workflow does */
  description?: string;
  /** Version string */
  version: string;
  /** Entry klados ID (first step in workflow) */
  entry: string;
  /** Flow definition - maps klados IDs to their handoff specs */
  flow: Record<string, FlowStep>;
  /** Collection to store the rhiza entity */
  collectionId: string;
}

/**
 * A step in the workflow flow definition
 */
export interface FlowStep {
  then: ThenSpec;
}

/**
 * Handoff specification for a workflow step
 */
export type ThenSpec =
  | { done: true }
  | { pass: string }
  | { scatter: string }
  | { gather: string };

// =============================================================================
// Rhiza Invocation
// =============================================================================

/**
 * Invoke a rhiza workflow
 *
 * @example
 * ```typescript
 * const result = await invokeRhiza({
 *   rhizaId: 'rhiza_abc123',
 *   targetEntity: entity.id,
 *   targetCollection: collection.id,
 *   jobCollection: jobCollection.id,
 *   confirm: true,
 * });
 *
 * if (result.status === 'started') {
 *   console.log('Workflow started:', result.job_id);
 * }
 * ```
 *
 * @param options - Invocation options
 * @returns The invocation result
 */
export async function invokeRhiza(
  options: InvokeRhizaOptions
): Promise<InvokeRhizaResult> {
  const body: Record<string, unknown> = {
    target_collection: options.targetCollection,
    job_collection: options.jobCollection,
    confirm: options.confirm ?? true,
  };

  if (options.targetEntity) {
    body.target_entity = options.targetEntity;
  }

  if (options.targetEntities) {
    body.target_entities = options.targetEntities;
  }

  if (options.input) {
    body.input = options.input;
  }

  return apiRequest<InvokeRhizaResult>(
    'POST',
    `/rhizai/${options.rhizaId}/invoke`,
    body
  );
}

// =============================================================================
// Rhiza Creation
// =============================================================================

/**
 * Create a rhiza workflow entity on the Arke network
 *
 * @example
 * ```typescript
 * const rhiza = await createRhiza({
 *   label: 'Stamp Chain',
 *   version: '1.0',
 *   entry: 'klados_stamp_1',
 *   flow: {
 *     'klados_stamp_1': { then: { pass: 'klados_stamp_2' } },
 *     'klados_stamp_2': { then: { done: true } },
 *   },
 *   collectionId: collection.id,
 * });
 * ```
 *
 * @param options - Rhiza creation options
 * @returns The created rhiza entity
 */
export async function createRhiza(
  options: CreateRhizaOptions
): Promise<{ id: string }> {
  const properties: Record<string, unknown> = {
    label: options.label,
    version: options.version,
    status: 'active',
    entry: { pi: options.entry },
    flow: Object.fromEntries(
      Object.entries(options.flow).map(([kladosId, step]) => [
        kladosId,
        {
          then: formatThenSpec(step.then),
        },
      ])
    ),
  };

  if (options.description) {
    properties.description = options.description;
  }

  const result = await apiRequest<{ id: string }>('POST', '/entities', {
    type: 'rhiza',
    properties,
    collection_id: options.collectionId,
  });

  return result;
}

/**
 * Format a ThenSpec for the API
 */
function formatThenSpec(spec: ThenSpec): Record<string, unknown> {
  if ('done' in spec) {
    return { done: true };
  }
  if ('pass' in spec) {
    return { pass: { pi: spec.pass } };
  }
  if ('scatter' in spec) {
    return { scatter: { pi: spec.scatter } };
  }
  if ('gather' in spec) {
    return { gather: { pi: spec.gather } };
  }
  throw new Error(`Unknown ThenSpec type: ${JSON.stringify(spec)}`);
}

// =============================================================================
// Workflow Logs
// =============================================================================

/**
 * Get all klados log entities from a job collection
 *
 * Uses the collection's relationships to find all logs.
 * Note: This may be affected by indexing lag for recently created logs.
 *
 * @param jobCollectionId - Job collection ID
 * @returns Array of klados log entries
 */
export async function getWorkflowLogs(
  jobCollectionId: string
): Promise<KladosLogEntry[]> {
  // Get the collection with its relationships
  const collection = await apiRequest<Entity>(
    'GET',
    `/entities/${jobCollectionId}`
  );

  // Find all log relationships (first_log and any contains relationships to logs)
  const logIds = new Set<string>();

  // Add first_log if present
  const firstLogRel = collection.relationships?.find(
    (r) => r.predicate === 'first_log'
  );
  if (firstLogRel) {
    logIds.add(firstLogRel.peer);
  }

  // Add any contained klados_log entities
  const containsRels = collection.relationships?.filter(
    (r) => r.predicate === 'contains' && r.peer_type === 'klados_log'
  );
  for (const rel of containsRels ?? []) {
    logIds.add(rel.peer);
  }

  // Fetch all logs
  const logs: KladosLogEntry[] = [];
  for (const logId of logIds) {
    try {
      const log = await apiRequest<KladosLogEntry>('GET', `/entities/${logId}`);
      logs.push(log);
    } catch {
      // Log may not exist yet, skip
    }
  }

  return logs;
}

/**
 * Wait for a rhiza workflow to complete
 *
 * Polls the job collection until all logs are in terminal state (done or error).
 * For simple workflows, this waits for the expected number of steps.
 * For scatter workflows, this waits for all scattered invocations plus gather.
 *
 * @example
 * ```typescript
 * const result = await waitForWorkflowCompletion(jobCollection.id, {
 *   timeout: 60000,
 *   pollInterval: 2000,
 *   expectedSteps: 2,  // For a 2-step chain
 * });
 *
 * if (result.status === 'done') {
 *   console.log('Workflow completed with', result.logs.length, 'steps');
 * }
 * ```
 *
 * @param jobCollectionId - Job collection ID
 * @param options - Wait options
 * @returns Workflow completion result
 */
export async function waitForWorkflowCompletion(
  jobCollectionId: string,
  options?: WaitForLogOptions & { expectedSteps?: number }
): Promise<WorkflowCompletionResult> {
  const timeout = options?.timeout ?? 30000;
  const pollInterval = options?.pollInterval ?? 2000;
  const expectedSteps = options?.expectedSteps;
  const startTime = Date.now();

  let lastLogs: KladosLogEntry[] = [];

  while (Date.now() - startTime < timeout) {
    try {
      const logs = await getWorkflowLogs(jobCollectionId);
      lastLogs = logs;

      // Check if we have any logs
      if (logs.length === 0) {
        await sleep(pollInterval);
        continue;
      }

      // Check if all logs are in terminal state
      const allTerminal = logs.every(
        (log) =>
          log.properties.status === 'done' || log.properties.status === 'error'
      );

      // Check if we have the expected number of steps (if specified)
      const hasExpectedSteps = expectedSteps
        ? logs.length >= expectedSteps
        : true;

      if (allTerminal && hasExpectedSteps) {
        // Check if any log has error status
        const hasError = logs.some(
          (log) => log.properties.status === 'error'
        );

        // Get final outputs from the last step (by completion time)
        const sortedLogs = [...logs].sort((a, b) => {
          const aTime = a.properties.log_data.entry.completed_at ?? '';
          const bTime = b.properties.log_data.entry.completed_at ?? '';
          return aTime.localeCompare(bTime);
        });

        const lastLog = sortedLogs[sortedLogs.length - 1];
        const finalOutputs =
          lastLog?.properties.log_data.entry.handoffs
            ?.filter((h) => h.type === 'complete' || h.type === 'invoke')
            .flatMap(() => []) ?? [];

        return {
          status: hasError ? 'error' : 'done',
          logs,
          finalOutputs,
          error: hasError
            ? logs.find((l) => l.properties.status === 'error')?.properties
                .log_data.entry.error?.message
            : undefined,
        };
      }
    } catch {
      // Ignore errors during polling, just retry
    }

    await sleep(pollInterval);
  }

  // Timeout
  return {
    status: 'timeout',
    logs: lastLogs,
    finalOutputs: [],
    error: `Workflow did not complete within ${timeout}ms`,
  };
}

// =============================================================================
// Assertions
// =============================================================================

/**
 * Assert that a workflow completed successfully with the expected number of steps
 *
 * @param result - Workflow completion result
 * @param expectedSteps - Expected number of klados steps
 * @throws Error if workflow failed or wrong number of steps
 */
export function assertWorkflowCompleted(
  result: WorkflowCompletionResult,
  expectedSteps?: number
): void {
  if (result.status === 'timeout') {
    throw new Error(
      `Workflow timed out. Got ${result.logs.length} logs, ` +
        `statuses: ${result.logs.map((l) => l.properties.status).join(', ')}`
    );
  }

  if (result.status === 'error') {
    throw new Error(`Workflow failed: ${result.error}`);
  }

  if (expectedSteps !== undefined && result.logs.length !== expectedSteps) {
    throw new Error(
      `Expected ${expectedSteps} workflow steps, got ${result.logs.length}`
    );
  }
}

/**
 * Assert that logs show the expected workflow path (klados execution order)
 *
 * @param logs - Array of klados log entries
 * @param expectedPath - Expected klados IDs in execution order
 */
export function assertWorkflowPath(
  logs: KladosLogEntry[],
  expectedPath: string[]
): void {
  // Sort by start time
  const sortedLogs = [...logs].sort((a, b) => {
    const aTime = a.properties.log_data.entry.started_at;
    const bTime = b.properties.log_data.entry.started_at;
    return aTime.localeCompare(bTime);
  });

  const actualPath = sortedLogs.map((l) => l.properties.klados_id);

  const match =
    actualPath.length === expectedPath.length &&
    actualPath.every((id, i) => id === expectedPath[i]);

  if (!match) {
    throw new Error(
      `Workflow path mismatch.\n` +
        `Expected: ${expectedPath.join(' → ')}\n` +
        `Actual:   ${actualPath.join(' → ')}`
    );
  }
}
