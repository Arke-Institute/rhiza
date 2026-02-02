/**
 * Handoff Interpretation
 *
 * Interprets ThenSpec to determine the correct handoff action.
 * Analyzes the flow step and entity properties to decide whether
 * to pass, scatter, gather, or mark as done.
 */

import type { ThenSpec, FlowStep, EntityRef, RouteRule } from '../types';
import type { MockArkeClient } from '../__tests__/fixtures/mock-client';
import { resolveTarget, discoverTargetType } from './target';
import {
  createScatterBatch,
  findGatherTarget,
  type ScatterBatchEntity,
  type ScatterInvocation,
  type BatchContext,
} from './scatter';
import { completeBatchSlot } from './gather';

/**
 * Handoff action types
 */
export type HandoffAction =
  | 'done'
  | 'pass'
  | 'scatter'
  | 'gather_wait'
  | 'gather_trigger';

/**
 * Handoff record for logging
 */
export interface HandoffRecord {
  type: 'pass' | 'scatter' | 'gather';
  target: string;
  targetType: 'klados' | 'rhiza';
  batchId?: string;
  invocations?: Array<{ jobId: string; targetEntityId: string }>;
}

/**
 * Context for interpreting a handoff
 */
export interface InterpretContext {
  rhizaId: string;
  kladosId: string;
  jobId: string;
  outputs: string[];
  outputProperties?: Record<string, unknown>;
  flow: Record<string, FlowStep>;
  batchContext?: BatchContext;
  batch?: ScatterBatchEntity;
}

/**
 * Result of interpreting a handoff
 */
export interface InterpretResult {
  action: HandoffAction;
  target?: string;
  targetType?: 'klados' | 'rhiza';
  outputs?: string[];
  handoffRecord?: HandoffRecord;

  // Scatter-specific
  batch?: ScatterBatchEntity;
  invocations?: ScatterInvocation[];

  // Gather-specific
  updatedBatch?: ScatterBatchEntity;
  allOutputs?: string[][];
}

/**
 * Interpret a ThenSpec and determine the handoff action
 *
 * @param client - The Arke client for API calls
 * @param then - The ThenSpec to interpret
 * @param context - The interpretation context
 * @returns The interpretation result
 */
export async function interpretThen(
  client: MockArkeClient,
  then: ThenSpec,
  context: InterpretContext
): Promise<InterpretResult> {
  // Terminal - done
  if ('done' in then) {
    return {
      action: 'done',
      outputs: context.outputs,
    };
  }

  // Pass handoff
  if ('pass' in then) {
    return handlePass(client, then, context);
  }

  // Scatter handoff
  if ('scatter' in then) {
    return handleScatter(client, then, context);
  }

  // Gather handoff
  if ('gather' in then) {
    return handleGather(client, then, context);
  }

  throw new Error(`Unknown handoff type: ${JSON.stringify(then)}`);
}

/**
 * Handle a pass handoff
 */
async function handlePass(
  client: MockArkeClient,
  then: { pass: EntityRef; route?: RouteRule[] },
  context: InterpretContext
): Promise<InterpretResult> {
  // Resolve target (with routing if applicable)
  const targetRef = resolveTarget(then, context.outputProperties ?? {});

  if (!targetRef) {
    throw new Error('Failed to resolve target for pass handoff');
  }

  // Discover target type (uses type hint if available)
  const targetType = await discoverTargetType(client, targetRef);

  return {
    action: 'pass',
    target: targetRef.pi,
    targetType,
    outputs: context.outputs,
    handoffRecord: {
      type: 'pass',
      target: targetRef.pi,
      targetType,
    },
  };
}

/**
 * Handle a scatter handoff
 */
async function handleScatter(
  client: MockArkeClient,
  then: { scatter: EntityRef; route?: RouteRule[] },
  context: InterpretContext
): Promise<InterpretResult> {
  // Resolve target (with routing if applicable)
  const targetRef = resolveTarget(then, context.outputProperties ?? {});

  if (!targetRef) {
    throw new Error('Failed to resolve target for scatter handoff');
  }

  const targetId = targetRef.pi;

  // Find the gather target from the worker's flow step
  const gatherTargetRef = findGatherTarget(context.flow, targetId);

  if (!gatherTargetRef && context.outputs.length > 0) {
    throw new Error(`Scatter target '${targetId}' does not have a gather handoff`);
  }

  // Discover target type (uses type hint if available)
  const targetType = await discoverTargetType(client, targetRef);

  // Create the scatter batch
  const scatterResult = await createScatterBatch(client, {
    rhizaId: context.rhizaId,
    sourceKladosId: context.kladosId,
    targetKladosId: targetId,
    gatherTargetId: gatherTargetRef?.pi ?? '',
    outputs: context.outputs,
    parentJobId: context.jobId,
  });

  return {
    action: 'scatter',
    target: targetId,
    targetType,
    outputs: context.outputs,
    batch: scatterResult.batch,
    invocations: scatterResult.invocations,
    handoffRecord: {
      type: 'scatter',
      target: targetId,
      targetType,
      batchId: scatterResult.batch.id,
      invocations: scatterResult.invocations.map((i) => ({
        jobId: i.jobId,
        targetEntityId: i.targetEntityId,
      })),
    },
  };
}

/**
 * Handle a gather handoff
 */
async function handleGather(
  client: MockArkeClient,
  then: { gather: EntityRef; route?: RouteRule[] },
  context: InterpretContext
): Promise<InterpretResult> {
  // Gather requires batch context
  if (!context.batchContext || !context.batch) {
    throw new Error('Gather handoff requires batch context');
  }

  // Complete this slot
  const slotResult = await completeBatchSlot(
    context.batch,
    context.batchContext.index,
    context.outputs
  );

  if (slotResult.isLast) {
    // This is the last slot - trigger gather
    const targetType = await discoverTargetType(client, then.gather);

    return {
      action: 'gather_trigger',
      target: then.gather.pi,
      targetType,
      outputs: context.outputs,
      updatedBatch: slotResult.batch,
      allOutputs: slotResult.allOutputs,
      handoffRecord: {
        type: 'gather',
        target: then.gather.pi,
        targetType,
        batchId: context.batch.id,
      },
    };
  }

  // Not the last slot - wait for others
  return {
    action: 'gather_wait',
    outputs: context.outputs,
    updatedBatch: slotResult.batch,
  };
}
