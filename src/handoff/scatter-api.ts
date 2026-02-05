/**
 * Scatter API Utilities
 *
 * SDK utilities for creating scatter batches and invoking targets.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type {
  BatchEntity,
  BatchProperties,
  InvocationRecord,
} from '../types';
import { invokeTarget, type InvokeOptions } from './invoke';

/**
 * Options for creating a scatter batch
 */
export interface CreateScatterOptions {
  /** Arke client */
  client: ArkeClient;

  /** Rhiza entity ID */
  rhizaId: string;

  /** Job ID */
  jobId: string;

  /** Collection for permission grant */
  targetCollection: string;

  /** Job collection ID for logs/outputs */
  jobCollectionId: string;

  /** Klados ID that created this batch */
  sourceKladosId: string;

  /** Target step name in the flow */
  targetStepName: string;

  /** Target klados ID for invocation */
  targetKladosId: string;

  /** Whether target is klados or rhiza */
  targetType: 'klados' | 'rhiza';

  /** Gather step name in the flow */
  gatherStepName: string;

  /** Klados ID that will receive gathered results */
  gatherKladosId: string;

  /** Output entity IDs to scatter */
  outputs: string[];

  /** Parent log ID for chain building */
  fromLogId: string;

  /** API base URL */
  apiBase: string;

  /** Permission duration in seconds (default: 3600) */
  expiresIn?: number;

  /** Network (test/main) */
  network: 'test' | 'main';

  /** Current path in workflow */
  path: string[];

  /** Concurrency limit for invocations (default: 10) */
  concurrency?: number;
}

/**
 * Result of creating a scatter batch
 */
export interface ScatterResult {
  /** Batch entity ID */
  batchId: string;

  /** The created batch entity */
  batch: BatchEntity;

  /** Invocation records for logging */
  invocations: InvocationRecord[];
}

/**
 * Create a scatter batch and invoke targets
 *
 * 1. Creates a batch entity in the job collection
 * 2. Invokes the target for each output
 * 3. Returns batch ID and invocation records for logging
 */
export async function createScatterBatch(
  options: CreateScatterOptions
): Promise<ScatterResult> {
  const {
    client,
    rhizaId,
    jobId,
    targetCollection,
    jobCollectionId,
    sourceKladosId,
    targetStepName,
    targetKladosId,
    targetType,
    gatherStepName,
    gatherKladosId,
    outputs,
    fromLogId,
    apiBase,
    expiresIn,
    network,
    path,
    concurrency = 10,
  } = options;

  // 1. Create batch entity
  const batchProperties: BatchProperties = {
    rhiza_id: rhizaId,
    job_id: jobId,
    source_klados: sourceKladosId,
    target_step: targetStepName,
    gather_step: gatherStepName,
    gather_klados: gatherKladosId,
    total: outputs.length,
    completed: 0,
    status: 'pending',
    slots: outputs.map((_, i) => ({
      index: i,
      status: 'pending' as const,
    })),
    created_at: new Date().toISOString(),
  };

  const { data: batchEntity, error: createError } = await client.api.POST('/entities', {
    body: {
      type: 'batch',
      collection: jobCollectionId,
      properties: batchProperties as unknown as Record<string, unknown>,
    },
  });

  if (createError || !batchEntity) {
    throw new Error(`Failed to create batch entity: ${createError?.error || 'Unknown error'}`);
  }

  const batch: BatchEntity = {
    id: batchEntity.id,
    type: 'batch',
    properties: batchProperties,
  };

  // 2. Invoke target for each output with concurrency limit
  const invocations: InvocationRecord[] = [];

  // Build the new path by appending the target step name
  const newPath = [...path, targetStepName];

  // Process outputs in chunks for concurrency control
  for (let i = 0; i < outputs.length; i += concurrency) {
    const chunk = outputs.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (output, chunkIndex) => {
      const globalIndex = i + chunkIndex;

      const invokeOptions: InvokeOptions = {
        targetCollection,
        jobCollectionId,
        apiBase,
        expiresIn,
        network,
        parentLogs: [fromLogId],
        batch: {
          id: batchEntity.id,
          index: globalIndex,
          total: outputs.length,
        },
        rhiza: {
          id: rhizaId,
          path: newPath,
        },
      };

      const result = await invokeTarget(
        client,
        targetKladosId,
        targetType,
        output,
        invokeOptions
      );

      return result.invocation;
    });

    const chunkResults = await Promise.all(chunkPromises);
    invocations.push(...chunkResults);
  }

  return {
    batchId: batchEntity.id,
    batch,
    invocations,
  };
}
