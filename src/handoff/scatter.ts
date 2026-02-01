/**
 * Scatter Operations
 *
 * Handles fan-out (scatter) operations that split a producer's outputs
 * into individual invocations of a worker klados.
 */

import type { FlowStep } from '../types';
import type { MockArkeClient } from '../__tests__/fixtures/mock-client';

/**
 * Batch slot status
 */
export interface BatchSlot {
  status: 'pending' | 'complete' | 'error';
  outputIds?: string[];
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

/**
 * Batch entity representing a scatter operation
 */
export interface ScatterBatchEntity {
  id: string;
  rhizaId: string;
  sourceKladosId: string;
  targetKladosId: string;
  gatherTargetId: string;
  parentJobId: string;
  total: number;
  completed: number;
  status: 'pending' | 'running' | 'complete' | 'error';
  slots: BatchSlot[];
  createdAt: string;
}

/**
 * Batch context passed to each scattered invocation
 */
export interface BatchContext {
  batchId: string;
  index: number;
  total: number;
}

/**
 * Individual invocation in a scatter operation
 */
export interface ScatterInvocation {
  jobId: string;
  targetEntityId: string;
  batchContext: BatchContext;
}

/**
 * Result of a scatter operation
 */
export interface ScatterResult {
  batch: ScatterBatchEntity;
  invocations: ScatterInvocation[];
}

/**
 * Parameters for creating a scatter batch
 */
export interface CreateScatterParams {
  rhizaId: string;
  sourceKladosId: string;
  targetKladosId: string;
  gatherTargetId: string;
  outputs: string[];
  parentJobId: string;
}

/**
 * Find the gather target for a scatter operation
 *
 * Looks up the target klados in the flow and returns the gather target
 * if the target has a gather handoff.
 *
 * @param flow - The rhiza flow definition
 * @param targetKladosId - The scatter target klados ID
 * @returns The gather target ID, or null if not a gather handoff
 */
export function findGatherTarget(
  flow: Record<string, FlowStep>,
  targetKladosId: string
): string | null {
  const step = flow[targetKladosId];
  if (!step || !step.then) {
    return null;
  }

  if ('gather' in step.then) {
    return step.then.gather;
  }

  return null;
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique batch ID
 */
function generateBatchId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a scatter batch and invoke the target klados for each output
 *
 * @param client - The Arke client
 * @param params - Scatter parameters
 * @returns The batch entity and all invocations
 */
export async function createScatterBatch(
  client: MockArkeClient,
  params: CreateScatterParams
): Promise<ScatterResult> {
  const {
    rhizaId,
    sourceKladosId,
    targetKladosId,
    gatherTargetId,
    outputs,
    parentJobId,
  } = params;

  const batchId = generateBatchId();
  const total = outputs.length;

  // Create slots for each output
  const slots: BatchSlot[] = outputs.map(() => ({
    status: 'pending',
  }));

  // Create batch entity
  const batch: ScatterBatchEntity = {
    id: batchId,
    rhizaId,
    sourceKladosId,
    targetKladosId,
    gatherTargetId,
    parentJobId,
    total,
    completed: 0,
    status: total === 0 ? 'complete' : 'pending',
    slots,
    createdAt: new Date().toISOString(),
  };

  // Generate invocations
  const invocations: ScatterInvocation[] = [];

  for (let i = 0; i < outputs.length; i++) {
    const jobId = generateJobId();
    const targetEntityId = outputs[i];

    const invocation: ScatterInvocation = {
      jobId,
      targetEntityId,
      batchContext: {
        batchId,
        index: i,
        total,
      },
    };

    invocations.push(invocation);

    // Record the invocation with the mock client
    client.invokeKlados(targetKladosId, {
      jobId,
      targetEntityId,
      batchContext: invocation.batchContext,
      rhizaId,
      parentJobId,
    });
  }

  return {
    batch,
    invocations,
  };
}
