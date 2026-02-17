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
  /** Job collection for logs (optional - API creates one if not provided) */
  jobCollection?: string;
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
 *
 * Uses step-based flow format where:
 * - entry is a step name (string)
 * - flow keys are step names
 * - each step has { klados: { pi: string }, then: ThenSpec }
 * - ThenSpec targets are step names (strings)
 */
export interface CreateRhizaOptions {
  /** Display label for the rhiza */
  label: string;
  /** Description of what this workflow does */
  description?: string;
  /** Version string */
  version: string;
  /** Entry step name (first step in workflow) */
  entry: string;
  /** Flow definition - maps step names to their klados and handoff specs */
  flow: Record<string, FlowStep>;
  /** Collection to store the rhiza entity */
  collectionId: string;
}

/**
 * A step in the workflow flow definition
 */
export interface FlowStep {
  /** Which klados to invoke for this step */
  klados: { pi: string; type?: string };
  /** What happens after this step completes */
  then: ThenSpec;
}

/**
 * Handoff specification for a workflow step
 * Targets are step names (strings), not klados IDs
 */
export type ThenSpec =
  | { done: true }
  | { pass: string; route?: unknown[] }
  | { scatter: string; route?: unknown[] }
  | { gather: string; route?: unknown[] };

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
    confirm: options.confirm ?? true,
  };

  if (options.jobCollection) {
    body.job_collection = options.jobCollection;
  }

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
 * Uses step-based format where step names are the flow keys
 * and the same klados can be used in multiple steps.
 *
 * @example
 * ```typescript
 * const rhiza = await createRhiza({
 *   label: 'Stamp Chain',
 *   version: '2.0',
 *   entry: 'first_stamp',
 *   flow: {
 *     'first_stamp': { klados: { pi: 'klados_stamp' }, then: { pass: 'second_stamp' } },
 *     'second_stamp': { klados: { pi: 'klados_stamp' }, then: { done: true } },
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
    // Entry is now a step name (string), not an EntityRef
    entry: options.entry,
    // Flow is passed through directly - already in the correct format
    flow: options.flow,
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

// =============================================================================
// Workflow Logs
// =============================================================================

/**
 * Get all klados log entities from a job collection
 *
 * Queries the collection for all klados_log type entities.
 * All workflow logs are stored in the same job collection.
 *
 * @param jobCollectionId - Job collection ID
 * @returns Array of klados log entries
 */
export async function getWorkflowLogs(
  jobCollectionId: string
): Promise<KladosLogEntry[]> {
  // Query collection for all klados_log entities
  const response = await apiRequest<{
    entities: Array<{ id: string }>;
  }>('GET', `/collections/${jobCollectionId}/entities?type=klados_log`);

  if (!response.entities?.length) {
    return [];
  }

  // Fetch full entity details for each log
  const logs: KladosLogEntry[] = [];
  for (const entity of response.entities) {
    try {
      const log = await apiRequest<KladosLogEntry>(
        'GET',
        `/entities/${entity.id}`
      );
      logs.push(log);
    } catch {
      // Log may not exist yet or fetch failed, skip
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
