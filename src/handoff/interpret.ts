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
  Output,
} from '../types';
import {
  type RhizaRuntimeConfig,
  SCATTER_UTILITY_URL,
  DEFAULT_SCATTER_THRESHOLD,
} from '../types/config';
import { resolveTarget, groupOutputsByTarget, normalizeOutput } from './target';
import { findGatherTarget } from './scatter';
import { discoverTargetType, invokeTarget, type InvokeOptions } from './invoke';
import { createScatterBatch } from './scatter-api';
import { completeBatchSlotWithCAS } from './gather-api';
import { delegateToScatterUtility } from './scatter-delegate';

/**
 * Handoff action types
 */
export type HandoffAction =
  | 'done'
  | 'pass'
  | 'scatter'
  | 'gather_wait'
  | 'gather_trigger'
  | 'recurse';

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

  /** Output entities from current klados (string IDs or OutputItem objects) */
  outputs: Output[];

  /**
   * Properties of the primary output (for routing)
   * @deprecated Use OutputItem objects in outputs array for per-item routing
   */
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

  /** Auth token for scatter-utility delegation (optional - needed for automatic delegation) */
  authToken?: string;

  /** Current recursion depth (for recurse handoffs) */
  recurseDepth?: number;
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
 * @param config - Optional rhiza runtime configuration (for scatter utility delegation)
 * @returns The interpretation result
 */
export async function interpretThen(
  then: ThenSpec,
  context: InterpretContext,
  config?: RhizaRuntimeConfig
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
    return handleScatter(then, context, config);
  }

  // ═══════════════════════════════════════════════════════════════
  // Gather: N:1 fan-in
  // ═══════════════════════════════════════════════════════════════
  if ('gather' in then) {
    return handleGather(then, context);
  }

  // ═══════════════════════════════════════════════════════════════
  // Recurse: bounded loop back to earlier step
  // ═══════════════════════════════════════════════════════════════
  if ('recurse' in then) {
    return handleRecurse(then, context);
  }

  throw new Error(`Unknown ThenSpec type: ${JSON.stringify(then)}`);
}

/**
 * Handle a pass handoff (1:1 direct)
 *
 * With per-item routing, outputs are grouped by their resolved target.
 * Each group is invoked separately. Items routed to "done" are skipped.
 */
async function handlePass(
  then: { pass: string; route?: import('../types').RouteRule[] },
  context: InterpretContext
): Promise<InterpretResult> {
  const { client, flow, outputs } = context;

  // Group outputs by their resolved target (per-item routing)
  const groups = groupOutputsByTarget(outputs, then);

  // Track all invocations across groups
  const allInvocations: InvocationRecord[] = [];
  let primaryTarget: string | undefined;
  let primaryTargetType: 'klados' | 'rhiza' | undefined;

  for (const [targetStepName, items] of groups) {
    // Skip items routed to "done" - they're complete
    if (targetStepName === 'done') {
      continue;
    }

    // Look up the klados for the target step
    const targetStep = flow[targetStepName];
    if (!targetStep) {
      throw new Error(`Target step '${targetStepName}' not found in flow`);
    }
    const targetKladosRef = targetStep.klados;

    // Discover target type (klados or rhiza)
    const targetType = targetKladosRef.type || await discoverTargetType(client, targetKladosRef.id);

    // Track primary target (first non-done group)
    if (!primaryTarget) {
      primaryTarget = targetKladosRef.id;
      primaryTargetType = targetType;
    }

    // Build invoke options with updated path
    const invokeOptions = buildInvokeOptions(context, targetStepName);

    // Extract entity IDs from items
    const entityIds = items.map(item => item.entity_id);

    // Invoke the target klados with this group's outputs
    const result = await invokeTarget(
      client,
      targetKladosRef.id,
      targetType,
      entityIds,
      invokeOptions
    );

    // Check if invoke was accepted
    if (!result.accepted) {
      throw new Error(`Handoff invoke failed: ${result.error || 'Unknown error'}`);
    }

    allInvocations.push(result.invocation);
  }

  // If all items went to "done", this is effectively a terminal
  if (!primaryTarget) {
    return { action: 'done' };
  }

  return {
    action: 'pass',
    target: primaryTarget,
    targetType: primaryTargetType,
    invocations: allInvocations,
    handoffRecord: {
      type: 'pass',
      target: primaryTarget,
      target_type: primaryTargetType!,
      invocations: allInvocations,
    },
  };
}

/**
 * Handle a scatter handoff (1:N fan-out)
 *
 * Scatter can work with or without gather:
 * - With gather: creates batch entity for coordination, last slot triggers gather
 * - Without gather: just invokes targets in parallel, each completes independently
 *
 * For large scatters (outputs > threshold), delegates to scatter-utility service.
 */
async function handleScatter(
  then: { scatter: string; route?: import('../types').RouteRule[] },
  context: InterpretContext,
  config?: RhizaRuntimeConfig
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
  const targetType = targetKladosRef.type || await discoverTargetType(client, targetKladosRef.id);

  // Find the gather target step name from the scatter target's flow step (optional)
  const gatherStepName = findGatherTarget(flow, targetStepName);

  // Check if we should delegate to scatter-utility for large scatters
  // By default, delegation happens automatically for scatters > threshold
  // unless forceLocal is set or authToken is not available
  const forceLocal = config?.scatterUtility?.forceLocal === true;
  const threshold = config?.scatterUtility?.threshold ?? DEFAULT_SCATTER_THRESHOLD;
  const scatterUrl = config?.scatterUtility?.url ?? SCATTER_UTILITY_URL;
  const authToken = context.authToken;
  const shouldDelegate = !forceLocal && !!authToken && outputs.length > threshold;

  if (shouldDelegate) {
    // Build invoke options for delegation
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

    // If there's a gather, we need to create the batch entity first for coordination
    // The scatter-utility will include batch context in each invocation
    if (gatherStepName) {
      const gatherStep = flow[gatherStepName];
      if (!gatherStep) {
        throw new Error(`Gather step '${gatherStepName}' not found in flow`);
      }

      // Extract all entity IDs for batch creation (need all slots including "done")
      const allEntityIds = extractEntityIds(outputs);

      // Create batch entity for gather coordination
      const scatterResult = await createScatterBatch({
        client,
        rhizaId,
        jobId,
        targetCollection: context.targetCollection,
        jobCollectionId,
        sourceKladosId: kladosId,
        targetStepName,
        targetKladosId: targetKladosRef.id,
        targetType,
        gatherStepName,
        gatherKladosId: gatherStep.klados.id,
        outputs: allEntityIds,
        fromLogId,
        apiBase,
        expiresIn,
        network,
        path,
        // Skip invocations - scatter-utility will handle them
        skipInvocations: true,
      });

      // Add batch context to invoke options
      invokeOptions.batch = {
        id: scatterResult.batchId,
        index: 0, // Will be overridden per-item by scatter-utility
        total: allEntityIds.length,
      };

      // Build per-item delegate outputs
      const delegateOutputs: import('./scatter-delegate').DelegateOutputItem[] = [];
      const doneSlotIndices: number[] = [];
      let primaryTarget: string | undefined;
      let primaryTargetType: 'klados' | 'rhiza' | undefined;

      // Process outputs in order to maintain correct batch indices
      for (let i = 0; i < outputs.length; i++) {
        const item = normalizeOutput(outputs[i]);
        const resolvedTarget = resolveTarget(then, item);

        if (resolvedTarget === null || resolvedTarget === 'done') {
          // Track this slot for immediate completion
          doneSlotIndices.push(i);
        } else {
          // Look up the klados for this target step
          const step = flow[resolvedTarget];
          if (!step) {
            throw new Error(`Target step '${resolvedTarget}' not found in flow`);
          }
          const kladosRef = step.klados;
          const type = kladosRef.type || await discoverTargetType(client, kladosRef.id);

          // Track primary target (first non-done item)
          if (!primaryTarget) {
            primaryTarget = kladosRef.id;
            primaryTargetType = type;
          }

          delegateOutputs.push({
            id: item.entity_id,
            target: kladosRef.id,
            targetType: type,
            stepName: resolvedTarget,
          });
        }
      }

      // Mark "done" slots as complete immediately (with their entity ID as output)
      // This allows the gather to proceed correctly
      for (const slotIndex of doneSlotIndices) {
        const slotOutput = [allEntityIds[slotIndex]]; // Pass through the entity ID
        await completeBatchSlotWithCAS(
          client,
          scatterResult.batchId,
          slotIndex,
          slotOutput
        );
      }

      // If all items went to "done", all slots are complete - return done
      if (delegateOutputs.length === 0) {
        return {
          action: 'scatter',
          target: targetKladosRef.id,
          targetType,
          batch: scatterResult.batch,
          handoffRecord: {
            type: 'scatter',
            target: targetKladosRef.id,
            target_type: targetType,
            batch_id: scatterResult.batchId,
            outputs: allEntityIds,
            done_slots: doneSlotIndices.length,
          },
        };
      }

      // Delegate non-done items to scatter-utility
      const delegateResult = await delegateToScatterUtility({
        outputs: delegateOutputs,
        invokeOptions,
        scatterUtilityUrl: scatterUrl,
        authToken: authToken!,
      });

      if (!delegateResult.accepted) {
        // Fall back to local dispatch with warning
        console.warn(
          `Scatter-utility delegation failed: ${delegateResult.error}. ` +
          `Falling back to local dispatch for ${outputs.length} items.`
        );
        // Continue to normal scatter logic below
      } else {
        return {
          action: 'scatter',
          target: primaryTarget!,
          targetType: primaryTargetType,
          batch: scatterResult.batch,
          handoffRecord: {
            type: 'scatter',
            target: primaryTarget!,
            target_type: primaryTargetType!,
            batch_id: scatterResult.batchId,
            outputs: allEntityIds,
            delegated: true,
            dispatch_id: delegateResult.dispatchId,
            done_slots: doneSlotIndices.length,
          },
        };
      }
    } else {
      // No gather - delegate without batch coordination
      // Include scatterTotal so children know CAS concurrency for parent log updates
      invokeOptions.scatterTotal = outputs.length;

      // Group outputs by target for per-item routing
      const groups = groupOutputsByTarget(outputs, then);

      // Build per-item delegate outputs, filtering out "done" items
      const delegateOutputs: import('./scatter-delegate').DelegateOutputItem[] = [];
      let primaryTarget: string | undefined;
      let primaryTargetType: 'klados' | 'rhiza' | undefined;

      for (const [stepName, items] of groups) {
        // Skip items routed to "done" - they're complete, no invocation needed
        if (stepName === 'done') {
          continue;
        }

        // Look up the klados for this target step
        const step = flow[stepName];
        if (!step) {
          throw new Error(`Target step '${stepName}' not found in flow`);
        }
        const kladosRef = step.klados;
        const type = kladosRef.type || await discoverTargetType(client, kladosRef.id);

        // Track primary target (first non-done group)
        if (!primaryTarget) {
          primaryTarget = kladosRef.id;
          primaryTargetType = type;
        }

        // Add each item with its per-item target
        for (const item of items) {
          delegateOutputs.push({
            id: item.entity_id,
            target: kladosRef.id,
            targetType: type,
            stepName,
          });
        }
      }

      // If all items went to "done", return done
      if (delegateOutputs.length === 0) {
        return { action: 'done' };
      }

      const delegateResult = await delegateToScatterUtility({
        outputs: delegateOutputs,
        invokeOptions,
        scatterUtilityUrl: scatterUrl,
        authToken: authToken!,
      });

      if (!delegateResult.accepted) {
        console.warn(
          `Scatter-utility delegation failed: ${delegateResult.error}. ` +
          `Falling back to local dispatch for ${outputs.length} items.`
        );
        // Continue to normal scatter logic below
      } else {
        return {
          action: 'scatter',
          target: primaryTarget!,
          targetType: primaryTargetType,
          handoffRecord: {
            type: 'scatter',
            target: primaryTarget!,
            target_type: primaryTargetType!,
            outputs: extractEntityIds(outputs),
            delegated: true,
            dispatch_id: delegateResult.dispatchId,
          },
        };
      }
    }
  }

  // If there's a gather, use batch coordination with per-item routing
  if (gatherStepName) {
    // Look up the gather klados
    const gatherStep = flow[gatherStepName];
    if (!gatherStep) {
      throw new Error(`Gather step '${gatherStepName}' not found in flow`);
    }

    // Group outputs by target for per-item routing
    const groups = groupOutputsByTarget(outputs, then);

    // Extract all entity IDs for batch creation (need all slots including "done")
    const allEntityIds = extractEntityIds(outputs);

    // Create scatter batch without invocations (we'll handle per-item routing)
    const scatterResult = await createScatterBatch({
      client,
      rhizaId,
      jobId,
      targetCollection: context.targetCollection,
      jobCollectionId,
      sourceKladosId: kladosId,
      targetStepName,
      targetKladosId: targetKladosRef.id,
      targetType,
      gatherStepName,
      gatherKladosId: gatherStep.klados.id,
      outputs: allEntityIds,
      fromLogId,
      apiBase,
      expiresIn,
      network,
      path,
      skipInvocations: true,  // We'll handle invocations with per-item routing
    });

    const allInvocations: InvocationRecord[] = [];
    const doneSlotIndices: number[] = [];
    let primaryTarget: string | undefined;
    let primaryTargetType: 'klados' | 'rhiza' | undefined;

    // Find which slots go to "done"
    for (let i = 0; i < outputs.length; i++) {
      const item = normalizeOutput(outputs[i]);
      const resolvedTarget = resolveTarget(then, item);

      if (resolvedTarget === null || resolvedTarget === 'done') {
        // Mark this slot for immediate completion
        doneSlotIndices.push(i);
      }
    }

    // Mark "done" slots as complete immediately (with their entity ID as output)
    for (const slotIndex of doneSlotIndices) {
      const slotOutput = [allEntityIds[slotIndex]];
      await completeBatchSlotWithCAS(
        client,
        scatterResult.batchId,
        slotIndex,
        slotOutput
      );
    }

    // Invoke non-"done" items with their correct targets
    for (const [stepName, items] of groups) {
      // Skip items routed to "done" - already handled above
      if (stepName === 'done') {
        continue;
      }

      // Look up the klados for this target step
      const step = flow[stepName];
      if (!step) {
        throw new Error(`Target step '${stepName}' not found in flow`);
      }
      const kladosRef = step.klados;
      const type = kladosRef.type || await discoverTargetType(client, kladosRef.id);

      // Track primary target (first non-done group)
      if (!primaryTarget) {
        primaryTarget = kladosRef.id;
        primaryTargetType = type;
      }

      // Build invoke options for this target
      const newPath = [...path, stepName];

      // Find the original indices for these items
      for (const item of items) {
        const originalIndex = allEntityIds.indexOf(item.entity_id);

        const invokeOptions: InvokeOptions = {
          targetCollection: context.targetCollection,
          jobCollectionId,
          apiBase,
          expiresIn,
          network,
          parentLogs: [fromLogId],
          batch: {
            id: scatterResult.batchId,
            index: originalIndex,
            total: allEntityIds.length,
          },
          rhiza: {
            id: rhizaId,
            path: newPath,
          },
        };

        const result = await invokeTarget(
          client,
          kladosRef.id,
          type,
          item.entity_id,
          invokeOptions
        );

        if (!result.accepted) {
          console.warn(`Scatter invoke failed for slot ${originalIndex}: ${result.error}`);
        }
        allInvocations.push(result.invocation);
      }
    }

    // If all items went to "done", return with batch info
    if (!primaryTarget) {
      return {
        action: 'scatter',
        target: targetKladosRef.id,
        targetType,
        batch: scatterResult.batch,
        handoffRecord: {
          type: 'scatter',
          target: targetKladosRef.id,
          target_type: targetType,
          batch_id: scatterResult.batchId,
          outputs: allEntityIds,
          done_slots: doneSlotIndices.length,
        },
      };
    }

    return {
      action: 'scatter',
      target: primaryTarget,
      targetType: primaryTargetType,
      invocations: allInvocations,
      batch: scatterResult.batch,
      handoffRecord: {
        type: 'scatter',
        target: primaryTarget,
        target_type: primaryTargetType!,
        batch_id: scatterResult.batchId,
        outputs: allEntityIds,
        invocations: allInvocations,
        done_slots: doneSlotIndices.length,
      },
    };
  }

  // No gather - simple fan-out where each branch completes independently
  // Use per-item routing to group outputs by target
  const groups = groupOutputsByTarget(outputs, then);

  const concurrency = 10;
  const allInvocations: InvocationRecord[] = [];
  let primaryTarget: string | undefined;
  let primaryTargetType: 'klados' | 'rhiza' | undefined;

  for (const [stepName, items] of groups) {
    // Skip items routed to "done" - they're complete, no invocation needed
    if (stepName === 'done') {
      continue;
    }

    // Look up the klados for this target step
    const step = flow[stepName];
    if (!step) {
      throw new Error(`Target step '${stepName}' not found in flow`);
    }
    const kladosRef = step.klados;

    // Discover target type
    const type = kladosRef.type || await discoverTargetType(client, kladosRef.id);

    // Track primary target (first non-done group)
    if (!primaryTarget) {
      primaryTarget = kladosRef.id;
      primaryTargetType = type;
    }

    // Build invoke options for this target
    // Include scatterTotal so children know CAS concurrency for parent log updates
    const newPath = [...path, stepName];
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
      scatterTotal: outputs.length,
    };

    // Invoke target for each output in this group (with concurrency limit)
    const entityIds = items.map(item => item.entity_id);

    for (let i = 0; i < entityIds.length; i += concurrency) {
      const chunk = entityIds.slice(i, i + concurrency);
      const chunkPromises = chunk.map(async (entityId, chunkIndex) => {
        const globalIndex = i + chunkIndex;
        const result = await invokeTarget(
          client,
          kladosRef.id,
          type,
          entityId,
          invokeOptions
        );
        // Check if invoke was accepted - log warning but don't fail the scatter
        if (!result.accepted) {
          console.warn(`Scatter invoke failed for ${stepName}[${globalIndex}]: ${result.error}`);
        }
        return result.invocation;
      });

      const chunkResults = await Promise.all(chunkPromises);
      allInvocations.push(...chunkResults);
    }
  }

  // If all items went to "done", this is effectively a terminal
  if (!primaryTarget) {
    return { action: 'done' };
  }

  return {
    action: 'scatter',
    target: primaryTarget,
    targetType: primaryTargetType,
    invocations: allInvocations,
    handoffRecord: {
      type: 'scatter',
      target: primaryTarget,
      target_type: primaryTargetType!,
      outputs: extractEntityIds(outputs),
      invocations: allInvocations,
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

  // Extract entity IDs for batch slot completion
  const entityIds = extractEntityIds(outputs);

  // Complete this slot (CAS retry)
  const slotResult = await completeBatchSlotWithCAS(
    client,
    batchContext.id,
    batchContext.index,
    entityIds
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
  const targetType = targetKladosRef.type || await discoverTargetType(client, targetKladosRef.id);

  // Flatten all outputs from all slots
  const allOutputsFlat = slotResult.allOutputs?.flat() ?? [];

  // Build invoke options with the gather step name in path
  const invokeOptions = buildInvokeOptions(context, targetStepName);
  // Remove batch context - the gather target doesn't get batch context
  delete invokeOptions.batch;

  // Invoke the gather target with all outputs
  const result = await invokeTarget(
    client,
    targetKladosRef.id,
    targetType,
    allOutputsFlat,
    invokeOptions
  );

  return {
    action: 'gather_trigger',
    target: targetKladosRef.id,
    targetType,
    invocations: [result.invocation],
    batch: slotResult.batch,
    allOutputs: slotResult.allOutputs,
    handoffRecord: {
      type: 'gather',
      target: targetKladosRef.id,
      target_type: targetType,
      batch_id: batchContext.id,
      invocations: [result.invocation],
    },
  };
}

/**
 * Handle a recurse handoff (bounded loop back to earlier step)
 *
 * Recurse is like pass, but:
 * 1. Increments recurse_depth in context
 * 2. Checks max_depth before invoking
 * 3. Terminates when no outputs (base case)
 */
async function handleRecurse(
  then: { recurse: string; max_depth?: number; route?: import('../types').RouteRule[] },
  context: InterpretContext
): Promise<InterpretResult> {
  const { client, flow, outputs } = context;
  const maxDepth = then.max_depth ?? 100;
  const currentDepth = context.recurseDepth ?? 0;

  // Check max depth BEFORE processing outputs
  if (currentDepth >= maxDepth) {
    console.warn(`Recurse max_depth (${maxDepth}) reached, terminating recursion`);
    return { action: 'done' };
  }

  // Group outputs by their resolved target (per-item routing)
  const groups = groupOutputsByTarget(outputs, then);

  // Track all invocations across groups
  const allInvocations: InvocationRecord[] = [];
  let primaryTarget: string | undefined;
  let primaryTargetType: 'klados' | 'rhiza' | undefined;

  for (const [targetStepName, items] of groups) {
    // Skip items routed to "done" - they're complete
    if (targetStepName === 'done') {
      continue;
    }

    // Look up the klados for the target step
    const targetStep = flow[targetStepName];
    if (!targetStep) {
      throw new Error(`Target step '${targetStepName}' not found in flow`);
    }
    const targetKladosRef = targetStep.klados;

    // Discover target type (klados or rhiza)
    const targetType = targetKladosRef.type || await discoverTargetType(client, targetKladosRef.id);

    // Track primary target (first non-done group)
    if (!primaryTarget) {
      primaryTarget = targetKladosRef.id;
      primaryTargetType = targetType;
    }

    // Build invoke options with updated path and INCREMENTED depth
    const invokeOptions = buildInvokeOptions(context, targetStepName);
    invokeOptions.recurseDepth = currentDepth + 1;

    // Extract entity IDs from items
    const entityIds = items.map(item => item.entity_id);

    // Invoke the target klados with this group's outputs
    const result = await invokeTarget(
      client,
      targetKladosRef.id,
      targetType,
      entityIds,
      invokeOptions
    );

    // Check if invoke was accepted
    if (!result.accepted) {
      throw new Error(`Recurse invoke failed: ${result.error || 'Unknown error'}`);
    }

    allInvocations.push(result.invocation);
  }

  // If all items went to "done" or no outputs, this is effectively terminal
  if (!primaryTarget) {
    return { action: 'done' };
  }

  return {
    action: 'recurse',
    target: primaryTarget,
    targetType: primaryTargetType,
    invocations: allInvocations,
    handoffRecord: {
      type: 'recurse',
      target: primaryTarget,
      target_type: primaryTargetType!,
      depth: currentDepth,
      invocations: allInvocations,
    },
  };
}

/**
 * Extract entity IDs from outputs array
 */
function extractEntityIds(outputs: Output[]): string[] {
  return outputs.map(o => normalizeOutput(o).entity_id);
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
    recurseDepth: context.recurseDepth,  // Forward recurse depth unchanged
    rhiza: {
      id: context.rhizaId,
      path: newPath,
    },
  };
}
