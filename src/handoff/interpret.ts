/**
 * Handoff Interpretation
 *
 * The main orchestrator that interprets ThenSpec and executes handoffs.
 * Combines pure logic (routing, target resolution) with SDK utilities (invocation).
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type {
  ThenSpec,
  FlowStep,
  BatchContext,
  BatchEntity,
  HandoffRecord,
  InvocationRecord,
} from '../types';
import { resolveTarget } from './target';
import { findGatherTarget } from './scatter';
import { discoverTargetType, invokeTarget, type InvokeOptions } from './invoke';
import { createScatterBatch } from './scatter-api';
import { completeBatchSlotWithCAS } from './gather-api';

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
 * Context for interpreting a handoff
 */
export interface InterpretContext {
  /** Arke client */
  client: ArkeClient;

  /** Rhiza entity ID */
  rhizaId: string;

  /** Current klados ID */
  kladosId: string;

  /** Job ID */
  jobId: string;

  /** Collection for permission grant */
  targetCollection: string;

  /** Job collection ID for logs/outputs */
  jobCollectionId: string;

  /** The rhiza flow definition */
  flow: Record<string, FlowStep>;

  /** Output entity IDs from current klados */
  outputs: string[];

  /** Properties of the primary output (for routing) */
  outputProperties?: Record<string, unknown>;

  /** Current log entry ID (for chain building) */
  fromLogId: string;

  /** Current path in workflow */
  path: string[];

  /** API base URL */
  apiBase: string;

  /** Permission duration in seconds (default: 3600) */
  expiresIn?: number;

  /** Network (test/main) */
  network: 'test' | 'main';

  /** Batch context if part of scatter/gather */
  batchContext?: BatchContext;
}

/**
 * Result of interpreting a handoff
 */
export interface InterpretResult {
  /** What action was taken */
  action: HandoffAction;

  /** Target ID that was invoked (if any) */
  target?: string;

  /** Whether target is klados or rhiza (discovered at runtime) */
  targetType?: 'klados' | 'rhiza';

  /** Invocation records for logging */
  invocations?: InvocationRecord[];

  /** Batch info (for scatter/gather) */
  batch?: BatchEntity;

  /** All outputs collected in slot order (only for gather_trigger) */
  allOutputs?: string[][];

  /** Handoff record for logging */
  handoffRecord?: HandoffRecord;
}

/**
 * Interpret and execute a ThenSpec
 *
 * This is the core handoff logic. It:
 * 1. Examines the ThenSpec from the flow
 * 2. Resolves routing if present
 * 3. Executes the appropriate handoff operation
 * 4. Returns info for logging and status tracking
 *
 * @param then - The ThenSpec to interpret
 * @param context - The interpretation context
 * @returns The interpretation result
 */
export async function interpretThen(
  then: ThenSpec,
  context: InterpretContext
): Promise<InterpretResult> {
  // ═══════════════════════════════════════════════════════════════
  // Terminal: workflow ends here
  // ═══════════════════════════════════════════════════════════════
  if ('done' in then && then.done) {
    return { action: 'done' };
  }

  // ═══════════════════════════════════════════════════════════════
  // Pass: 1:1 direct handoff
  // ═══════════════════════════════════════════════════════════════
  if ('pass' in then) {
    return handlePass(then, context);
  }

  // ═══════════════════════════════════════════════════════════════
  // Scatter: 1:N fan-out
  // ═══════════════════════════════════════════════════════════════
  if ('scatter' in then) {
    return handleScatter(then, context);
  }

  // ═══════════════════════════════════════════════════════════════
  // Gather: N:1 fan-in
  // ═══════════════════════════════════════════════════════════════
  if ('gather' in then) {
    return handleGather(then, context);
  }

  throw new Error(`Unknown ThenSpec type: ${JSON.stringify(then)}`);
}

/**
 * Handle a pass handoff (1:1 direct)
 */
async function handlePass(
  then: { pass: string; route?: import('../types').RouteRule[] },
  context: InterpretContext
): Promise<InterpretResult> {
  const { client, flow, outputs, outputProperties } = context;

  // Resolve target step name (may be overridden by route)
  const targetStepName = resolveTarget(then, outputProperties ?? {});
  if (!targetStepName) {
    throw new Error('Failed to resolve target for pass handoff');
  }

  // Look up the klados for the target step
  const targetStep = flow[targetStepName];
  if (!targetStep) {
    throw new Error(`Target step '${targetStepName}' not found in flow`);
  }
  const targetKladosRef = targetStep.klados;

  // Discover target type (klados or rhiza) - always klados for flow steps
  const targetType = targetKladosRef.type || await discoverTargetType(client, targetKladosRef.pi);

  // Build invoke options with updated path
  const invokeOptions = buildInvokeOptions(context, targetStepName);

  // Invoke the target klados
  const result = await invokeTarget(
    client,
    targetKladosRef.pi,
    targetType,
    outputs,
    invokeOptions
  );

  // Check if invoke was accepted
  if (!result.accepted) {
    throw new Error(`Handoff invoke failed: ${result.error || 'Unknown error'}`);
  }

  return {
    action: 'pass',
    target: targetKladosRef.pi,
    targetType,
    invocations: [result.invocation],
    handoffRecord: {
      type: 'pass',
      target: targetKladosRef.pi,
      target_type: targetType,
      invocations: [result.invocation],
    },
  };
}

/**
 * Handle a scatter handoff (1:N fan-out)
 *
 * Scatter can work with or without gather:
 * - With gather: creates batch entity for coordination, last slot triggers gather
 * - Without gather: just invokes targets in parallel, each completes independently
 */
async function handleScatter(
  then: { scatter: string; route?: import('../types').RouteRule[] },
  context: InterpretContext
): Promise<InterpretResult> {
  const {
    client,
    rhizaId,
    kladosId,
    jobId,
    jobCollectionId,
    flow,
    outputs,
    outputProperties,
    fromLogId,
    apiBase,
    expiresIn,
    network,
    path,
  } = context;

  // Resolve target step name (may be overridden by route)
  const targetStepName = resolveTarget(then, outputProperties ?? {});
  if (!targetStepName) {
    throw new Error('Failed to resolve target for scatter handoff');
  }

  // Look up the klados for the target step
  const targetStep = flow[targetStepName];
  if (!targetStep) {
    throw new Error(`Target step '${targetStepName}' not found in flow`);
  }
  const targetKladosRef = targetStep.klados;

  // Discover target type
  const targetType = targetKladosRef.type || await discoverTargetType(client, targetKladosRef.pi);

  // Find the gather target step name from the scatter target's flow step (optional)
  const gatherStepName = findGatherTarget(flow, targetStepName);

  // If there's a gather, use batch coordination
  if (gatherStepName) {
    // Look up the gather klados
    const gatherStep = flow[gatherStepName];
    if (!gatherStep) {
      throw new Error(`Gather step '${gatherStepName}' not found in flow`);
    }

    // Create scatter batch and invoke targets
    const scatterResult = await createScatterBatch({
      client,
      rhizaId,
      jobId,
      targetCollection: context.targetCollection,
      jobCollectionId,
      sourceKladosId: kladosId,
      targetStepName,
      targetKladosId: targetKladosRef.pi,
      targetType,
      gatherStepName,
      gatherKladosId: gatherStep.klados.pi,
      outputs,
      fromLogId,
      apiBase,
      expiresIn,
      network,
      path,
    });

    return {
      action: 'scatter',
      target: targetKladosRef.pi,
      targetType,
      invocations: scatterResult.invocations,
      batch: scatterResult.batch,
      handoffRecord: {
        type: 'scatter',
        target: targetKladosRef.pi,
        target_type: targetType,
        batch_id: scatterResult.batchId,
        invocations: scatterResult.invocations,
      },
    };
  }

  // No gather - simple fan-out where each branch completes independently
  // Invoke targets directly without batch coordination
  const newPath = [...path, targetStepName];
  const invokeOptions: InvokeOptions = {
    targetCollection: context.targetCollection,
    jobCollectionId,
    apiBase,
    expiresIn,
    network,
    parentLogs: [fromLogId],
    rhiza: {
      id: rhizaId,
      path: newPath,
    },
  };

  // Invoke target for each output (with concurrency limit)
  const concurrency = 10;
  const invocations: InvocationRecord[] = [];

  for (let i = 0; i < outputs.length; i += concurrency) {
    const chunk = outputs.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (output) => {
      const result = await invokeTarget(
        client,
        targetKladosRef.pi,
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
    action: 'scatter',
    target: targetKladosRef.pi,
    targetType,
    invocations,
    handoffRecord: {
      type: 'scatter',
      target: targetKladosRef.pi,
      target_type: targetType,
      invocations,
    },
  };
}

/**
 * Handle a gather handoff (N:1 fan-in)
 */
async function handleGather(
  then: { gather: string; route?: import('../types').RouteRule[] },
  context: InterpretContext
): Promise<InterpretResult> {
  const { client, flow, outputs, outputProperties, batchContext } = context;

  // Gather requires batch context
  if (!batchContext) {
    throw new Error('Gather handoff requires batch context');
  }

  // Complete this slot (CAS retry)
  const slotResult = await completeBatchSlotWithCAS(
    client,
    batchContext.id,
    batchContext.index,
    outputs
  );

  if (!slotResult.isLast) {
    // Not the last slot - just waiting for others
    return {
      action: 'gather_wait',
      batch: slotResult.batch,
    };
  }

  // This is the last slot - trigger gather target
  // Resolve target step name (may be overridden by route)
  const targetStepName = resolveTarget(then, outputProperties ?? {});
  if (!targetStepName) {
    throw new Error('Failed to resolve target for gather handoff');
  }

  // Look up the klados for the target step
  const targetStep = flow[targetStepName];
  if (!targetStep) {
    throw new Error(`Target step '${targetStepName}' not found in flow`);
  }
  const targetKladosRef = targetStep.klados;

  // Discover target type
  const targetType = targetKladosRef.type || await discoverTargetType(client, targetKladosRef.pi);

  // Flatten all outputs from all slots
  const allOutputsFlat = slotResult.allOutputs?.flat() ?? [];

  // Build invoke options with the gather step name in path
  const invokeOptions = buildInvokeOptions(context, targetStepName);
  // Remove batch context - the gather target doesn't get batch context
  delete invokeOptions.batch;

  // Invoke the gather target with all outputs
  const result = await invokeTarget(
    client,
    targetKladosRef.pi,
    targetType,
    allOutputsFlat,
    invokeOptions
  );

  return {
    action: 'gather_trigger',
    target: targetKladosRef.pi,
    targetType,
    invocations: [result.invocation],
    batch: slotResult.batch,
    allOutputs: slotResult.allOutputs,
    handoffRecord: {
      type: 'gather',
      target: targetKladosRef.pi,
      target_type: targetType,
      batch_id: batchContext.id,
      invocations: [result.invocation],
    },
  };
}

/**
 * Build invoke options from context
 *
 * @param context - The interpretation context
 * @param targetStepName - The target step name to append to path (optional for gather)
 */
function buildInvokeOptions(context: InterpretContext, targetStepName?: string): InvokeOptions {
  // Build the new path by appending the target step name
  const newPath = targetStepName
    ? [...context.path, targetStepName]
    : context.path;

  return {
    targetCollection: context.targetCollection,
    jobCollectionId: context.jobCollectionId,
    apiBase: context.apiBase,
    expiresIn: context.expiresIn,
    network: context.network,
    parentLogs: [context.fromLogId],
    batch: context.batchContext,
    rhiza: {
      id: context.rhizaId,
      path: newPath,
    },
  };
}
