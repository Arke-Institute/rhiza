# Handoff Logic

## Overview

The handoff module is the core of the protocol. It interprets `then` specs and executes the appropriate handoff operation (pass, scatter, gather, route, rhiza).

Since kladoi are now first-class entities, handoff invokes them via `POST /kladoi/:id/invoke`.

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

### Rhiza (Sub-workflow)

Invokes a nested workflow via `POST /rhizai/:id/invoke`.

```
Klados A
    ↓ rhiza: "II01rhiza_sub..."
    └── Sub-workflow executes independently
        └── When complete, calls back to parent
```

---

## Implementation

### `src/handoff/interpret.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type {
  KladosEntity,
  RhizaContext,
  FlowStep,
  ThenSpec,
  KladosLogEntry,
  HandoffRecord,
  InvocationRecord,
} from '../types';
import { createScatter } from './scatter';
import { completeBatchSlot } from './gather';
import { matchRoute } from './route';
import { invokeKlados, invokeRhiza } from './invoke';

/**
 * Result of interpreting a then spec
 */
export interface InterpretResult {
  /** What action was taken */
  action: 'done' | 'pass' | 'scatter' | 'gather_wait' | 'gather_trigger' | 'route' | 'rhiza';

  /** Target klados ID or rhiza ID that was invoked (if any) */
  target?: string;

  /** Whether target is klados or rhiza */
  target_type?: 'klados' | 'rhiza';

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
 * 1. Examines the then spec from the flow
 * 2. Executes the appropriate handoff operation
 * 3. Returns info for logging and status tracking
 */
export async function interpretThen(
  client: ArkeClient,
  context: RhizaContext,
  currentKladosId: string,
  then: ThenSpec,
  outputs: string[],
  logEntryId: string
): Promise<InterpretResult> {
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
    const targetKladosId = then.pass;

    const invocations = await invokeKlados(
      client,
      context,
      targetKladosId,
      outputs,
      logEntryId
    );

    return {
      action: 'pass',
      target: targetKladosId,
      target_type: 'klados',
      invocations,
      handoffRecord: {
        type: 'pass',
        target: targetKladosId,
        target_type: 'klados',
        invocations,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Scatter: 1:N fan-out
  // ═══════════════════════════════════════════════════════════════
  if ('scatter' in then) {
    const targetKladosId = then.scatter;

    const scatterResult = await createScatter(
      client,
      context,
      currentKladosId,
      targetKladosId,
      outputs,
      logEntryId
    );

    return {
      action: 'scatter',
      target: targetKladosId,
      target_type: 'klados',
      invocations: scatterResult.invocations,
      batch: {
        id: scatterResult.batchId,
        isLast: false,
      },
      handoffRecord: {
        type: 'scatter',
        target: targetKladosId,
        target_type: 'klados',
        batch_id: scatterResult.batchId,
        invocations: scatterResult.invocations,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Gather: N:1 fan-in
  // ═══════════════════════════════════════════════════════════════
  if ('gather' in then) {
    const targetKladosId = then.gather;

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
      const invocations = await invokeKlados(
        client,
        context,
        targetKladosId,
        gatherResult.allOutputs!,
        logEntryId
      );

      return {
        action: 'gather_trigger',
        target: targetKladosId,
        target_type: 'klados',
        invocations,
        batch: gatherResult,
        handoffRecord: {
          type: 'gather',
          target: targetKladosId,
          target_type: 'klados',
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
  // Rhiza: sub-workflow
  // ═══════════════════════════════════════════════════════════════
  if ('rhiza' in then) {
    const subRhizaId = then.rhiza;

    const invocations = await invokeRhiza(
      client,
      context,
      subRhizaId,
      outputs,
      logEntryId
    );

    return {
      action: 'rhiza',
      target: subRhizaId,
      target_type: 'rhiza',
      invocations,
      handoffRecord: {
        type: 'rhiza',
        target: subRhizaId,
        target_type: 'rhiza',
        invocations,
      },
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
      currentKladosId,
      matchedRule.then,
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
      // Need to switch to parent's context
      const invocations = await invokeKlados(
        client,
        {
          ...context,
          id: parent.rhiza_id,
          job_collection: parent.job_collection,
        },
        parent.next_target,
        gatherResult.allOutputs!,
        logEntryId
      );

      return {
        action: 'gather_trigger',
        target: parent.next_target,
        target_type: 'klados',
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
    const invocations = await invokeKlados(
      client,
      {
        ...context,
        id: parent.rhiza_id,
        job_collection: parent.job_collection,
      },
      parent.next_target,
      outputs,
      logEntryId
    );

    return {
      action: 'pass',
      target: parent.next_target,
      target_type: 'klados',
      invocations,
    };
  }

  // No further action needed
  return { action: 'done' };
}
```

### `src/handoff/invoke.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type {
  RhizaContext,
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
 * Invoke a klados via POST /kladoi/:id/invoke
 *
 * Returns invocation records for logging.
 */
export async function invokeKlados(
  client: ArkeClient,
  context: RhizaContext,
  kladosId: string,
  outputs: string[],
  fromLogId: string,
  batchContext?: BatchContext
): Promise<InvocationRecord[]> {
  const invocations: InvocationRecord[] = [];

  const request = buildKladosRequest(
    context,
    kladosId,
    outputs,
    fromLogId,
    batchContext
  );

  // Invoke via POST /kladoi/:id/invoke
  const { data, error } = await client.api.POST('/kladoi/{id}/invoke', {
    params: { path: { id: kladosId } },
    body: {
      target: request.target,
      job_collection: request.job_collection,
      input: request.input,
      // Pass rhiza context for the klados to use
      rhiza_context: {
        id: context.id,
        flow: context.flow,
        position: kladosId,
        log_chain: request.rhiza?.log_chain ?? [],
        parent: context.parent,
      },
      batch_context: batchContext,
      confirm: true,
    },
  });

  const result: InvokeResult = error
    ? { job_id: request.job_id, accepted: false, error: error.message || 'Unknown error' }
    : { job_id: data!.job_id || request.job_id, accepted: data!.status === 'started' };

  invocations.push({
    job_id: result.job_id,
    target_entity: outputs.length === 1 ? outputs[0] : outputs.join(','),
    batch_index: batchContext?.index,
    status: result.accepted ? 'pending' : 'error',
    request,
  });

  return invocations;
}

/**
 * Invoke a sub-rhiza via POST /rhizai/:id/invoke
 */
export async function invokeRhiza(
  client: ArkeClient,
  context: RhizaContext,
  rhizaId: string,
  outputs: string[],
  fromLogId: string,
  batchContext?: BatchContext
): Promise<InvocationRecord[]> {
  const invocations: InvocationRecord[] = [];

  const jobId = `job_${generateId()}`;
  const target = outputs.length === 1 ? outputs[0] : outputs[0]; // Primary target

  // Build parent context for callback
  const parentContext = {
    job_collection: context.job_collection,
    rhiza_id: context.id,
    invoking_log_id: fromLogId,
    batch_id: batchContext?.id,
    batch_index: batchContext?.index,
    on_complete: batchContext ? 'update_batch' as const : 'invoke_next' as const,
    next_target: batchContext?.gather_target,
  };

  // Invoke via POST /rhizai/:id/invoke
  const { data, error } = await client.api.POST('/rhizai/{id}/invoke', {
    params: { path: { id: rhizaId } },
    body: {
      target,
      // Sub-rhiza gets its own job collection (nested)
      parent_context: parentContext,
      confirm: true,
    },
  });

  const result: InvokeResult = error
    ? { job_id: jobId, accepted: false, error: error.message || 'Unknown error' }
    : { job_id: data!.job_id || jobId, accepted: true };

  // Build a minimal request for logging
  const request: KladosRequest = {
    job_id: result.job_id,
    target,
    job_collection: context.job_collection, // Parent's collection
    api_base: context.api_base,
    expires_at: context.expires_at,
    network: context.network,
    rhiza: {
      id: rhizaId,
      flow: {}, // Will be loaded by sub-rhiza
      position: '', // Entry will be determined
      log_chain: [fromLogId, ...context.log_chain],
      parent: parentContext,
    },
  };

  invocations.push({
    job_id: result.job_id,
    target_entity: target,
    batch_index: batchContext?.index,
    status: result.accepted ? 'pending' : 'error',
    request,
  });

  return invocations;
}

/**
 * Build a KladosRequest for invocation
 */
export function buildKladosRequest(
  context: RhizaContext,
  kladosId: string,
  outputs: string | string[],
  fromLogId: string,
  batchContext?: BatchContext
): KladosRequest {
  const jobId = `job_${generateId()}`;
  const target = Array.isArray(outputs)
    ? (outputs.length === 1 ? outputs[0] : outputs[0])
    : outputs;

  return {
    job_id: jobId,
    target,
    job_collection: context.job_collection,
    api_base: context.api_base,
    expires_at: context.expires_at,
    network: context.network,
    rhiza: {
      id: context.id,
      flow: context.flow,
      position: kladosId,
      log_chain: [fromLogId, ...context.log_chain],
      parent: context.parent,
    },
    batch: batchContext,
  };
}
```

### `src/handoff/scatter.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type {
  RhizaContext,
  FlowStep,
  InvocationRecord,
  BatchProperties,
} from '../types';
import { invokeKlados } from './invoke';
import { generateId } from '../utils';

export interface ScatterResult {
  batchId: string;
  invocations: InvocationRecord[];
}

/**
 * Create a scatter operation (fan-out)
 *
 * 1. Creates batch entity in job collection
 * 2. Invokes target klados once per output
 * 3. Returns batch ID and invocation records
 */
export async function createScatter(
  client: ArkeClient,
  context: RhizaContext,
  sourceKladosId: string,
  targetKladosId: string,
  outputs: string[],
  fromLogId: string
): Promise<ScatterResult> {
  // Find the gather target by looking at the target klados's flow step
  const gatherTarget = findGatherTarget(context.flow, targetKladosId);

  // 1. Create batch entity
  const batchProperties: BatchProperties = {
    rhiza_id: context.id,
    job_id: context.job_id ?? `job_${generateId()}`,
    source_klados: sourceKladosId,
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

  // 2. Invoke target klados for each output
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

        const invs = await invokeKlados(
          client,
          context,
          targetKladosId,
          [output],
          fromLogId,
          batchContext
        );

        return invs[0];
      })
    );

    invocations.push(...chunkInvocations);
  }

  return { batchId, invocations };
}

/**
 * Find the gather target for a scatter operation
 *
 * Looks at the target klados's flow step to find its gather target.
 */
export function findGatherTarget(
  flow: Record<string, FlowStep>,
  scatterTargetId: string
): string {
  const targetStep = flow[scatterTargetId];
  if (!targetStep) {
    throw new Error(`Scatter target '${scatterTargetId}' not found in flow`);
  }

  const then = targetStep.then;
  if ('gather' in then) {
    return then.gather;
  }

  throw new Error(`Scatter target '${scatterTargetId}' does not have a gather in its then spec`);
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

### `src/handoff/index.ts`

```typescript
export { interpretThen } from './interpret';
export type { InterpretResult } from './interpret';

export { createScatter, findGatherTarget } from './scatter';
export type { ScatterResult } from './scatter';

export { completeBatchSlot, errorBatchSlot } from './gather';
export type { GatherResult } from './gather';

export { matchRoute, evaluateWhere } from './route';

export { invokeKlados, invokeRhiza, buildKladosRequest } from './invoke';
export type { InvokeResult } from './invoke';
```
