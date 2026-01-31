# Handoff Logic

## Overview

The handoff module is the core of the protocol. It interprets `then` specs and executes the appropriate handoff operation (pass, scatter, gather, route).

---

## Handoff Types

### Pass (1:1)

Direct handoff of outputs to the next klados.

```
Klados A (produces: one) → pass → Klados B (accepts: one)
Klados A (produces: many) → pass → Klados B (accepts: many)
```

### Scatter (1:N Fan-Out)

Creates a batch and invokes the next klados once per output.

```
Klados A (produces: many [N items])
    ↓ scatter
    ├── Klados B instance 0 (accepts: one, batch[0])
    ├── Klados B instance 1 (accepts: one, batch[1])
    └── Klados B instance N (accepts: one, batch[N])
```

### Gather (N:1 Fan-In)

Waits for all batch slots to complete, then invokes next klados with collected outputs.

```
Klados B instance 0 → complete slot 0
Klados B instance 1 → complete slot 1
Klados B instance N → complete slot N (LAST)
    ↓ gather (triggered by last)
Klados C (accepts: many [all outputs])
```

### Route (Conditional)

Matches output against conditions and follows the matching branch.

```
Klados A
    ↓ route
    ├── where: type = "file/pdf" → pass → PDF Handler
    ├── where: type = "file/jpeg" → pass → Image Handler
    └── where: type = "file/text" → pass → Text Handler
```

---

## Implementation

### `src/handoff/interpret.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type {
  RhizaContext,
  KladosSpec,
  ThenSpec,
  TargetRef,
  KladosLogEntry,
  HandoffRecord,
  InvocationRecord,
} from '../types';
import { createScatter } from './scatter';
import { completeBatchSlot } from './gather';
import { matchRoute } from './route';
import { invokeTarget } from './invoke';

/**
 * Result of interpreting a then spec
 */
export interface InterpretResult {
  /** What action was taken */
  action: 'done' | 'pass' | 'scatter' | 'gather_wait' | 'gather_trigger' | 'route';

  /** Target that was invoked (if any) */
  target?: TargetRef;

  /** Invocation records for logging */
  invocations?: InvocationRecord[];

  /** Batch info (for scatter/gather) */
  batch?: {
    id: string;
    isLast: boolean;
    allOutputs?: string[];
  };

  /** Handoff record for logging */
  handoffRecord?: HandoffRecord;
}

/**
 * Interpret and execute a then spec
 *
 * This is the core handoff logic. It:
 * 1. Examines the then spec
 * 2. Executes the appropriate handoff operation
 * 3. Returns info for logging and status tracking
 */
export async function interpretThen(
  client: ArkeClient,
  context: RhizaContext,
  spec: KladosSpec,
  outputs: string[],
  logEntryId: string
): Promise<InterpretResult> {
  const { then } = spec;

  // ═══════════════════════════════════════════════════════════════
  // Terminal: workflow ends here
  // ═══════════════════════════════════════════════════════════════
  if ('done' in then && then.done) {
    // If we're a sub-rhiza, handle parent callback
    if (context.parent) {
      return handleSubRhizaComplete(client, context, outputs, logEntryId);
    }
    return { action: 'done' };
  }

  // ═══════════════════════════════════════════════════════════════
  // Pass: 1:1 direct handoff
  // ═══════════════════════════════════════════════════════════════
  if ('pass' in then) {
    const invocations = await invokeTarget(
      client,
      context,
      then.pass,
      outputs,
      logEntryId
    );

    return {
      action: 'pass',
      target: then.pass,
      invocations,
      handoffRecord: {
        type: 'pass',
        target: typeof then.pass === 'string' ? then.pass : then.pass.rhiza,
        target_type: typeof then.pass === 'string' ? 'klados' : 'rhiza',
        invocations,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Scatter: 1:N fan-out
  // ═══════════════════════════════════════════════════════════════
  if ('scatter' in then) {
    const scatterResult = await createScatter(
      client,
      context,
      then.scatter,
      outputs,
      logEntryId
    );

    return {
      action: 'scatter',
      target: then.scatter,
      invocations: scatterResult.invocations,
      batch: {
        id: scatterResult.batchId,
        isLast: false,
      },
      handoffRecord: {
        type: 'scatter',
        target: typeof then.scatter === 'string' ? then.scatter : then.scatter.rhiza,
        target_type: typeof then.scatter === 'string' ? 'klados' : 'rhiza',
        batch_id: scatterResult.batchId,
        invocations: scatterResult.invocations,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Gather: N:1 fan-in
  // ═══════════════════════════════════════════════════════════════
  if ('gather' in then) {
    // We must be in a batch context
    if (!context.batch) {
      throw new Error('Gather requires batch context but none provided');
    }

    const gatherResult = await completeBatchSlot(
      client,
      context.batch,
      outputs
    );

    if (gatherResult.isLast) {
      // We're the last one - trigger gather target
      const invocations = await invokeTarget(
        client,
        context,
        then.gather,
        gatherResult.allOutputs!,
        logEntryId
      );

      return {
        action: 'gather_trigger',
        target: then.gather,
        invocations,
        batch: gatherResult,
        handoffRecord: {
          type: 'gather',
          target: typeof then.gather === 'string' ? then.gather : then.gather.rhiza,
          target_type: typeof then.gather === 'string' ? 'klados' : 'rhiza',
          invocations,
        },
      };
    }

    // Not last - just waiting
    return {
      action: 'gather_wait',
      batch: gatherResult,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Route: conditional
  // ═══════════════════════════════════════════════════════════════
  if ('route' in then) {
    const matchedRule = await matchRoute(client, outputs, then.route);

    if (!matchedRule) {
      throw new Error(`No route matched for outputs: ${outputs.join(', ')}`);
    }

    // Recursively interpret the matched rule's then
    const result = await interpretThen(
      client,
      context,
      { ...spec, then: matchedRule.then },
      outputs,
      logEntryId
    );

    // Wrap the result to indicate it came from routing
    return {
      ...result,
      action: 'route',
    };
  }

  throw new Error(`Unknown then spec: ${JSON.stringify(then)}`);
}

/**
 * Handle completion of a sub-rhiza
 */
async function handleSubRhizaComplete(
  client: ArkeClient,
  context: RhizaContext,
  outputs: string[],
  logEntryId: string
): Promise<InterpretResult> {
  const parent = context.parent!;

  if (parent.on_complete === 'update_batch') {
    // We're part of a parent's scatter - update our batch slot
    const gatherResult = await completeBatchSlot(
      client,
      {
        id: parent.batch_id!,
        index: parent.batch_index!,
        total: 0, // Will be read from batch entity
        gather_target: '', // Will be read from batch entity
      },
      outputs
    );

    if (gatherResult.isLast && parent.next_target) {
      // Trigger parent's next step
      const invocations = await invokeTarget(
        client,
        {
          ...context,
          // Switch back to parent context
          id: parent.rhiza_id,
          // Note: we'd need to load parent's rhiza definition here
          // For now, assume next_target is a klados in parent
        },
        parent.next_target,
        gatherResult.allOutputs!,
        logEntryId
      );

      return {
        action: 'gather_trigger',
        invocations,
        batch: gatherResult,
      };
    }

    return {
      action: 'gather_wait',
      batch: gatherResult,
    };
  }

  if (parent.on_complete === 'invoke_next' && parent.next_target) {
    // Direct invocation of parent's next step
    const invocations = await invokeTarget(
      client,
      context,
      parent.next_target,
      outputs,
      logEntryId
    );

    return {
      action: 'pass',
      target: parent.next_target,
      invocations,
    };
  }

  // No further action needed
  return { action: 'done' };
}
```

### `src/handoff/scatter.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type {
  RhizaContext,
  TargetRef,
  InvocationRecord,
  BatchProperties,
} from '../types';
import { invokeKlados, invokeRhiza, buildKladosRequest } from './invoke';
import { generateId } from '../utils';

export interface ScatterResult {
  batchId: string;
  invocations: InvocationRecord[];
}

/**
 * Create a scatter operation (fan-out)
 *
 * 1. Creates batch entity in job collection
 * 2. Invokes target once per output
 * 3. Returns batch ID and invocation records
 */
export async function createScatter(
  client: ArkeClient,
  context: RhizaContext,
  target: TargetRef,
  outputs: string[],
  fromLogId: string
): Promise<ScatterResult> {
  const gatherTarget = findGatherTarget(context.definition, context.position, target);

  // 1. Create batch entity
  const batchProperties: BatchProperties = {
    rhiza_id: context.id,
    job_id: context.job_id,
    source_klados: context.position,
    gather_klados: gatherTarget,
    total: outputs.length,
    completed: 0,
    status: 'pending',
    slots: outputs.map((_, i) => ({ index: i, status: 'pending' })),
    created_at: new Date().toISOString(),
  };

  const { data: batchEntity } = await client.api.POST('/entities', {
    body: {
      type: 'batch',
      collection: context.job_collection,
      properties: batchProperties as Record<string, unknown>,
    },
  });

  const batchId = batchEntity!.id;

  // 2. Invoke target for each output
  const invocations: InvocationRecord[] = [];

  // Parallel invocation with concurrency limit
  const CONCURRENCY = 10;
  const chunks = chunk(outputs, CONCURRENCY);

  for (const outputChunk of chunks) {
    const chunkInvocations = await Promise.all(
      outputChunk.map(async (output, chunkIndex) => {
        const globalIndex = chunks.indexOf(outputChunk) * CONCURRENCY + chunkIndex;

        const batchContext = {
          id: batchId,
          index: globalIndex,
          total: outputs.length,
          gather_target: gatherTarget,
        };

        const request = buildKladosRequest(
          context,
          target,
          output,
          fromLogId,
          batchContext
        );

        const result = typeof target === 'string'
          ? await invokeKlados(client, context, target, request)
          : await invokeRhiza(client, target.rhiza, request);

        return {
          job_id: result.job_id,
          target_entity: output,
          batch_index: globalIndex,
          status: 'pending' as const,
          request,
        };
      })
    );

    invocations.push(...chunkInvocations);
  }

  return { batchId, invocations };
}

/**
 * Find the gather target for a scatter operation
 *
 * Traces forward from the scatter target to find the klados
 * that has `gather` in its then spec.
 */
export function findGatherTarget(
  rhiza: Rhiza,
  sourceKlados: string,
  scatterTarget: TargetRef
): string {
  if (typeof scatterTarget !== 'string') {
    // Scattering to a sub-rhiza - gather target is determined by parent
    // The sub-rhiza's terminal will call back to parent
    return '';
  }

  // Trace forward from scatter target to find gather
  const targetSpec = rhiza.kladoi[scatterTarget];
  if (!targetSpec) {
    throw new Error(`Scatter target '${scatterTarget}' not found in rhiza`);
  }

  const then = targetSpec.then;
  if ('gather' in then) {
    const gatherTarget = then.gather;
    return typeof gatherTarget === 'string' ? gatherTarget : '';
  }

  throw new Error(`Scatter target '${scatterTarget}' does not have a gather in its then spec`);
}

/**
 * Split array into chunks
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
```

### `src/handoff/gather.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type { BatchContext, BatchProperties, BatchSlot } from '../types';
import { sleep } from '../utils';

export interface GatherResult {
  isLast: boolean;
  allOutputs?: string[];
  completed: number;
  total: number;
}

/**
 * Complete a batch slot and check if we're the last
 *
 * Uses CAS (Compare-And-Swap) to atomically update the batch entity.
 * If we're the last to complete, returns all outputs for gather.
 */
export async function completeBatchSlot(
  client: ArkeClient,
  batchContext: BatchContext,
  outputs: string[]
): Promise<GatherResult> {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      // Get current batch state
      const { data: tip } = await client.api.GET('/entities/{id}/tip', {
        params: { path: { id: batchContext.id } },
      });

      const { data: batchEntity } = await client.api.GET('/entities/{id}', {
        params: { path: { id: batchContext.id } },
      });

      const props = batchEntity!.properties as BatchProperties;

      // Update our slot
      const updatedSlot: BatchSlot = {
        index: batchContext.index,
        status: 'complete',
        output_ids: outputs,
        completed_at: new Date().toISOString(),
      };

      props.slots[batchContext.index] = updatedSlot;

      // Count completed
      const completed = props.slots.filter((s) => s.status === 'complete').length;
      props.completed = completed;

      const isLast = completed === props.total;
      if (isLast) {
        props.status = 'complete';
        props.completed_at = new Date().toISOString();
      }

      // Atomic update with CAS
      await client.api.PUT('/entities/{id}', {
        params: { path: { id: batchContext.id } },
        body: {
          expect_tip: tip!.cid,
          properties: props as Record<string, unknown>,
        },
      });

      if (isLast) {
        // Collect all outputs in slot order
        const allOutputs = props.slots
          .sort((a, b) => a.index - b.index)
          .flatMap((s) => s.output_ids ?? []);

        return { isLast: true, allOutputs, completed, total: props.total };
      }

      return { isLast: false, completed, total: props.total };

    } catch (e) {
      // Check for CAS conflict (409)
      if (e instanceof Error && (e.message.includes('409') || e.message.includes('Conflict'))) {
        retries++;
        // Exponential backoff with jitter
        const delay = Math.pow(2, retries) * 100 + Math.random() * 200;
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }

  throw new Error(`Failed to update batch slot after ${maxRetries} retries`);
}

/**
 * Mark a batch slot as errored
 */
export async function errorBatchSlot(
  client: ArkeClient,
  batchContext: BatchContext,
  error: { code: string; message: string }
): Promise<void> {
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const { data: tip } = await client.api.GET('/entities/{id}/tip', {
        params: { path: { id: batchContext.id } },
      });

      const { data: batchEntity } = await client.api.GET('/entities/{id}', {
        params: { path: { id: batchContext.id } },
      });

      const props = batchEntity!.properties as BatchProperties;

      props.slots[batchContext.index] = {
        index: batchContext.index,
        status: 'error',
        error,
        completed_at: new Date().toISOString(),
      };

      // Check if all slots are now terminal (complete or error)
      const terminal = props.slots.filter(
        (s) => s.status === 'complete' || s.status === 'error'
      ).length;

      if (terminal === props.total) {
        props.status = 'error'; // At least one error
        props.completed_at = new Date().toISOString();
      }

      await client.api.PUT('/entities/{id}', {
        params: { path: { id: batchContext.id } },
        body: {
          expect_tip: tip!.cid,
          properties: props as Record<string, unknown>,
        },
      });

      return;

    } catch (e) {
      if (e instanceof Error && (e.message.includes('409') || e.message.includes('Conflict'))) {
        retries++;
        await sleep(Math.pow(2, retries) * 100);
        continue;
      }
      throw e;
    }
  }
}
```

### `src/handoff/route.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type { RouteRule, WhereCondition } from '../types';

/**
 * Match outputs against route rules
 *
 * Returns the first matching rule, or null if none match.
 */
export async function matchRoute(
  client: ArkeClient,
  outputs: string[],
  rules: RouteRule[]
): Promise<RouteRule | null> {
  // For routing, we typically route based on the first output
  // (or all outputs should match the same rule)
  const primaryOutput = outputs[0];

  if (!primaryOutput) {
    return null;
  }

  // Fetch entity to check properties
  const { data: entity } = await client.api.GET('/entities/{id}', {
    params: { path: { id: primaryOutput } },
  });

  if (!entity) {
    throw new Error(`Output entity ${primaryOutput} not found`);
  }

  // Check each rule in order
  for (const rule of rules) {
    if (evaluateWhere(entity.properties, rule.where)) {
      return rule;
    }
  }

  return null;
}

/**
 * Evaluate a where condition against entity properties
 */
export function evaluateWhere(
  properties: Record<string, unknown>,
  where: WhereCondition
): boolean {
  const value = getNestedProperty(properties, where.property);
  return value === where.equals;
}

/**
 * Get a nested property value using dot notation
 *
 * e.g., "content_type" or "metadata.format"
 */
function getNestedProperty(
  obj: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
```

### `src/handoff/invoke.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type {
  RhizaContext,
  TargetRef,
  KladosRequest,
  BatchContext,
  InvocationRecord,
} from '../types';
import { generateId } from '../utils';

export interface InvokeResult {
  job_id: string;
  accepted: boolean;
  error?: string;
}

/**
 * Invoke a target (klados or rhiza)
 *
 * Returns invocation records for logging.
 */
export async function invokeTarget(
  client: ArkeClient,
  context: RhizaContext,
  target: TargetRef,
  outputs: string[],
  fromLogId: string,
  batchContext?: BatchContext
): Promise<InvocationRecord[]> {
  const invocations: InvocationRecord[] = [];

  if (typeof target === 'string') {
    // Local klados - single invocation with all outputs
    const request = buildKladosRequest(context, target, outputs, fromLogId, batchContext);
    const result = await invokeKlados(client, context, target, request);

    invocations.push({
      job_id: result.job_id,
      target_entity: outputs.length === 1 ? outputs[0] : outputs.join(','),
      status: result.accepted ? 'pending' : 'error',
      request,
    });
  } else {
    // Sub-rhiza - invoke the rhiza
    const request = buildKladosRequest(context, target, outputs, fromLogId, batchContext);
    const result = await invokeRhiza(client, target.rhiza, request);

    invocations.push({
      job_id: result.job_id,
      target_entity: outputs.length === 1 ? outputs[0] : outputs.join(','),
      status: result.accepted ? 'pending' : 'error',
      request,
    });
  }

  return invocations;
}

/**
 * Build a KladosRequest for invocation
 */
export function buildKladosRequest(
  context: RhizaContext,
  target: TargetRef,
  outputs: string | string[],
  fromLogId: string,
  batchContext?: BatchContext
): KladosRequest {
  const jobId = `job_${generateId()}`;
  const targetStr = Array.isArray(outputs) ? outputs[0] : outputs;

  // Determine position based on target type
  const position = typeof target === 'string' ? target : context.definition.entry;

  return {
    job_id: jobId,
    target: targetStr,
    job_collection: context.job_collection,
    api_base: context.api_base,
    expires_at: context.expires_at,
    network: context.network,
    rhiza: {
      id: context.id,
      definition: context.definition,
      position,
      log_chain: [fromLogId, ...context.log_chain],
      // If invoking sub-rhiza, set parent context
      parent: typeof target !== 'string' ? {
        job_collection: context.job_collection,
        rhiza_id: context.id,
        invoking_log_id: fromLogId,
        batch_id: batchContext?.id,
        batch_index: batchContext?.index,
        on_complete: batchContext ? 'update_batch' : 'invoke_next',
        next_target: batchContext?.gather_target,
      } : undefined,
    },
    batch: batchContext,
  };
}

/**
 * Invoke a klados (agent) via Arke API
 */
export async function invokeKlados(
  client: ArkeClient,
  context: RhizaContext,
  kladosName: string,
  request: KladosRequest
): Promise<InvokeResult> {
  const spec = context.definition.kladoi[kladosName];
  if (!spec) {
    throw new Error(`Klados '${kladosName}' not found in rhiza`);
  }

  const agentId = spec.action;

  // Invoke via Arke API
  const { data, error } = await client.api.POST('/agents/{id}/invoke', {
    params: { path: { id: agentId } },
    body: {
      target: request.target,
      job_collection: request.job_collection,
      input: {
        // Pass the full rhiza request as input
        __rhiza_request: request,
      },
      confirm: true,
    },
  });

  if (error) {
    return {
      job_id: request.job_id,
      accepted: false,
      error: error.message || 'Unknown error',
    };
  }

  return {
    job_id: data!.job_id || request.job_id,
    accepted: data!.status === 'started',
    error: data!.status === 'rejected' ? data!.error : undefined,
  };
}

/**
 * Invoke a sub-rhiza via Arke API
 */
export async function invokeRhiza(
  client: ArkeClient,
  rhizaId: string,
  request: KladosRequest
): Promise<InvokeResult> {
  // Invoke via Arke API (new endpoint)
  const { data, error } = await client.api.POST('/rhizai/{id}/invoke', {
    params: { path: { id: rhizaId } },
    body: {
      target: request.target,
      job_collection: request.job_collection,
      input: request.input,
      // Pass parent context for callback
      parent_context: request.rhiza.parent,
      confirm: true,
    },
  });

  if (error) {
    return {
      job_id: request.job_id,
      accepted: false,
      error: error.message || 'Unknown error',
    };
  }

  return {
    job_id: data!.job_id || request.job_id,
    accepted: true,
  };
}
```

### `src/handoff/index.ts`

```typescript
export { interpretThen } from './interpret';
export type { InterpretResult } from './interpret';

export { createScatter, findGatherTarget } from './scatter';
export type { ScatterResult } from './scatter';

export { completeBatchSlot, errorBatchSlot } from './gather';
export type { GatherResult } from './gather';

export { matchRoute, evaluateWhere } from './route';

export { invokeTarget, invokeKlados, invokeRhiza, buildKladosRequest } from './invoke';
export type { InvokeResult } from './invoke';
```
