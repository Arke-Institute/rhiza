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
} from '../types';
import { generateId } from '../utils';

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
 * Invoke a sub-rhiza via POST /rhizai/:id/invoke
 *
 * Fire-and-forget: the sub-rhiza creates log entries pointing back to parent.
 * Parent does not track children.
 *
 * Note: The current API doesn't support passing parent_logs directly.
 * Sub-rhiza invocations with parent tracking would need API extension.
 */
export async function invokeRhiza(
  client: ArkeClient,
  rhizaId: string,
  entityTarget: string | string[],
  options: InvokeOptions
): Promise<InvokeResult> {
  const jobId = `job_${generateId()}`;
  const isMany = Array.isArray(entityTarget);
  const expiresIn = options.expiresIn ?? 3600;

  // Build a minimal request for logging
  const request: KladosRequest = {
    job_id: jobId,
    target_entity: isMany ? undefined : entityTarget,
    target_entities: isMany ? entityTarget : undefined,
    target_collection: options.targetCollection,
    job_collection: options.jobCollectionId,
    api_base: options.apiBase,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    network: options.network,
  };

  const invocation: InvocationRecord = {
    request,
    batch_index: options.batch?.index,
  };

  try {
    // Map to API format (will be updated when API supports new format)
    const apiTarget = request.target_entity ?? request.target_entities?.[0] ?? '';

    // Invoke via POST /rhizai/:id/invoke
    // TODO: Update body schema when API supports new target fields
    const { data, error } = await client.api.POST('/rhizai/{id}/invoke', {
      params: { path: { id: rhizaId } },
      body: {
        target: apiTarget,
        target_collection: request.target_collection,
        input: options.input,
        expires_in: expiresIn,
        confirm: true,
      },
    });

    if (error) {
      return {
        jobId,
        accepted: false,
        error: error.error || 'Unknown error',
        invocation,
      };
    }

    // Check if it's a started response
    if (data && 'status' in data && data.status === 'started' && 'job_id' in data) {
      return {
        jobId: data.job_id,
        accepted: true,
        invocation,
      };
    }

    return {
      jobId,
      accepted: false,
      error: 'Unexpected response from invoke',
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
