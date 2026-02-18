/**
 * Invocation Utilities
 *
 * SDK utilities for invoking kladoi and rhizai.
 * Fire-and-forget model: we invoke and record what we sent.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type {
  KladosRequest,
  BatchContext,
  InvocationRecord,
  AnyEntityRef,
} from '../types';
import { generateId } from '../utils';
import { getRefId } from '../types/refs';

/**
 * Options for invoking a target
 */
export interface InvokeOptions {
  /** Collection for permission grant */
  targetCollection: string;

  /** Job collection ID for logs/outputs */
  jobCollectionId: string;

  /** API base URL */
  apiBase: string;

  /** Permission duration in seconds (default: 3600) */
  expiresIn?: number;

  /** Network (test/main) */
  network: 'test' | 'main';

  /** Parent log IDs for chain building */
  parentLogs: string[];

  /** Optional input data */
  input?: Record<string, unknown>;

  /** Batch context if part of scatter */
  batch?: BatchContext;

  /** Rhiza context (if part of workflow) */
  rhiza?: {
    id: string;
    path: string[];
  };

  /**
   * Total number of scatter outputs (for scatter without gather)
   * Used for CAS concurrency when updating parent log with sent_to relationships.
   */
  scatterTotal?: number;

  /**
   * Current recursion depth (for recurse handoffs)
   * Passed through to invoked klados so they know the current depth.
   */
  recurseDepth?: number;
}

/**
 * Result of an invocation
 */
export interface InvokeResult {
  /** Job ID for the invoked target */
  jobId: string;

  /** Whether invocation was accepted */
  accepted: boolean;

  /** Error message if not accepted */
  error?: string;

  /** The invocation record for logging */
  invocation: InvocationRecord;
}

/**
 * Discover target type by fetching the entity
 *
 * @param client - Arke client
 * @param targetId - Target entity ID
 * @returns 'klados' or 'rhiza'
 */
export async function discoverTargetType(
  client: ArkeClient,
  targetId: string
): Promise<'klados' | 'rhiza'> {
  const { data: entity, error } = await client.api.GET('/entities/{id}', {
    params: { path: { id: targetId } },
  });

  if (error || !entity) {
    throw new Error(`Failed to fetch target entity: ${targetId}`);
  }

  const entityType = entity.type;

  if (entityType === 'rhiza') {
    return 'rhiza';
  }
  if (entityType === 'klados') {
    return 'klados';
  }

  throw new Error(`Target ${targetId} has unknown type: ${entityType}`);
}

/**
 * Invoke a target (klados or rhiza) based on its type
 *
 * @param client - Arke client
 * @param targetId - Target klados or rhiza ID
 * @param targetType - Whether target is klados or rhiza
 * @param entityTarget - Entity ID(s) to process
 * @param options - Invocation options
 * @returns Invocation result
 */
export async function invokeTarget(
  client: ArkeClient,
  targetId: string,
  targetType: 'klados' | 'rhiza',
  entityTarget: string | string[],
  options: InvokeOptions
): Promise<InvokeResult> {
  if (targetType === 'rhiza') {
    return invokeRhiza(client, targetId, entityTarget, options);
  }
  return invokeKlados(client, targetId, entityTarget, options);
}

/**
 * Invoke a klados via POST /kladoi/:id/invoke
 *
 * Fire-and-forget: we invoke and record what we sent.
 * The invoked klados creates its own log entry pointing back to us.
 */
export async function invokeKlados(
  client: ArkeClient,
  kladosId: string,
  entityTarget: string | string[],
  options: InvokeOptions
): Promise<InvokeResult> {
  const jobId = `job_${generateId()}`;
  const expiresIn = options.expiresIn ?? 3600;

  // Normalize target: single-element array becomes single entity
  // This handles the common case of pass handoffs returning [entityId]
  // while the target klados expects cardinality: one
  const isArray = Array.isArray(entityTarget);
  const isSingleElementArray = isArray && entityTarget.length === 1;
  const targetEntity = isArray ? (isSingleElementArray ? entityTarget[0] : undefined) : entityTarget;
  const targetEntities = isArray && !isSingleElementArray ? entityTarget : undefined;

  // Build the klados request (for logging/replay)
  const request: KladosRequest = {
    job_id: jobId,
    target_entity: targetEntity,
    target_entities: targetEntities,
    target_collection: options.targetCollection,
    job_collection: options.jobCollectionId,
    api_base: options.apiBase,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    network: options.network,
    input: options.input,
  };

  // Add rhiza context if present
  // Note: path already includes the target step name (set by buildInvokeOptions)
  if (options.rhiza) {
    request.rhiza = {
      id: options.rhiza.id,
      path: options.rhiza.path,
      parent_logs: options.parentLogs,
      batch: options.batch,
      scatter_total: options.scatterTotal,
      recurse_depth: options.recurseDepth,
    };
  }

  // Build the invocation record first (for logging regardless of success)
  const invocation: InvocationRecord = {
    request,
    batch_index: options.batch?.index,
  };

  try {
    // Invoke via POST /kladoi/:id/invoke
    // Note: API expects target_entity/target_entities but SDK types use 'target'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await client.api.POST('/kladoi/{id}/invoke', {
      params: { path: { id: kladosId } },
      body: {
        target_entity: request.target_entity,
        target_entities: request.target_entities,
        target_collection: request.target_collection,
        job_collection: request.job_collection,
        input: request.input,
        expires_in: expiresIn,
        confirm: true,
        rhiza: request.rhiza,
      } as any,
    });

    if (error) {
      return {
        jobId,
        accepted: false,
        error: error.error || 'Unknown error',
        invocation,
      };
    }

    // Check if it's a started response (has status: 'started' and job_id)
    if (data && 'status' in data && data.status === 'started' && 'job_id' in data) {
      return {
        jobId: data.job_id,
        accepted: true,
        invocation,
      };
    }

    // Preview response or rejected - not what we expected with confirm: true
    return {
      jobId,
      accepted: false,
      error: `Unexpected response from invoke: ${JSON.stringify(data)}`,
      invocation,
    };
  } catch (e) {
    return {
      jobId,
      accepted: false,
      error: e instanceof Error ? e.message : 'Unknown error',
      invocation,
    };
  }
}

/**
 * Invoke a sub-rhiza by resolving its entry klados and invoking directly
 *
 * This unifies sub-rhiza invocation with regular klados-to-klados handoffs:
 * - Fetches the rhiza entity to find the entry klados
 * - Invokes the entry klados directly via invokeKlados()
 * - Preserves full context (job_collection, parent_logs, input, etc.)
 *
 * Fire-and-forget: the sub-rhiza creates log entries pointing back to parent.
 *
 * Note: This is different from the Arke API's /rhizai/{id}/invoke endpoint,
 * which is used for external/direct rhiza invocation. This function is for
 * workflow handoffs where we need to preserve context.
 */
export async function invokeRhiza(
  client: ArkeClient,
  rhizaId: string,
  entityTarget: string | string[],
  options: InvokeOptions
): Promise<InvokeResult> {
  const jobId = `job_${generateId()}`;

  try {
    // Fetch rhiza entity to get entry point and flow
    const { data: rhiza, error: fetchError } = await client.api.GET('/entities/{id}', {
      params: { path: { id: rhizaId } },
    });

    if (fetchError || !rhiza) {
      // Build minimal invocation record for error case
      const errorRequest: KladosRequest = {
        job_id: jobId,
        target_entity: Array.isArray(entityTarget) ? undefined : entityTarget,
        target_entities: Array.isArray(entityTarget) ? entityTarget : undefined,
        target_collection: options.targetCollection,
        job_collection: options.jobCollectionId,
        api_base: options.apiBase,
        expires_at: new Date(Date.now() + (options.expiresIn ?? 3600) * 1000).toISOString(),
        network: options.network,
      };

      return {
        jobId,
        accepted: false,
        error: `Failed to fetch rhiza: ${rhizaId}`,
        invocation: { request: errorRequest },
      };
    }

    // Extract entry point from rhiza properties
    const entryStepName = rhiza.properties.entry as string;
    const flow = rhiza.properties.flow as Record<string, { klados: { id: string } }>;

    if (!entryStepName || !flow || !flow[entryStepName]) {
      return {
        jobId,
        accepted: false,
        error: `Invalid rhiza: missing entry point or flow definition`,
        invocation: {
          request: {
            job_id: jobId,
            target_collection: options.targetCollection,
            job_collection: options.jobCollectionId,
            api_base: options.apiBase,
            expires_at: new Date().toISOString(),
            network: options.network,
          },
        },
      };
    }

    const entryKladosId = getRefId(flow[entryStepName].klados as AnyEntityRef);

    // Build options for the sub-rhiza's entry klados
    // Key: we create a NEW rhiza context for the sub-workflow,
    // but preserve parent linkage via parentLogs
    const subRhizaOptions: InvokeOptions = {
      ...options,
      rhiza: {
        id: rhizaId,
        path: [entryStepName],  // Fresh path within sub-rhiza
      },
      // parentLogs, recurseDepth, input all flow through from options
    };

    // Invoke entry klados directly - this preserves all context
    return invokeKlados(client, entryKladosId, entityTarget, subRhizaOptions);
  } catch (e) {
    // Build minimal invocation record for error case
    const errorRequest: KladosRequest = {
      job_id: jobId,
      target_entity: Array.isArray(entityTarget) ? undefined : entityTarget,
      target_entities: Array.isArray(entityTarget) ? entityTarget : undefined,
      target_collection: options.targetCollection,
      job_collection: options.jobCollectionId,
      api_base: options.apiBase,
      expires_at: new Date(Date.now() + (options.expiresIn ?? 3600) * 1000).toISOString(),
      network: options.network,
    };

    return {
      jobId,
      accepted: false,
      error: e instanceof Error ? e.message : 'Unknown error',
      invocation: { request: errorRequest },
    };
  }
}
