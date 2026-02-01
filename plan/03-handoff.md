# Handoff Logic

## Overview

The handoff module is the core of the protocol. It interprets `then` specs and executes the appropriate handoff operation: **pass**, **scatter**, or **gather** (plus **done** for terminal).

Routing is a modifier on any operation, not a separate operation type. Targets can be either klados or rhiza entities, discovered at runtime by fetching the entity.

---

## Handoff Types

### Pass (1:1)

Direct handoff of outputs to the next target.

```
Klados A (produces: one) → pass → Target B (accepts: one)
Klados A (produces: many) → pass → Target B (accepts: many)
```

### Scatter (1:N Fan-Out)

Creates a batch and invokes the next target once per output.

```
Klados A (produces: many [N items])
    ↓ scatter
    ├── Target B instance 0 (accepts: one, batch[0])
    ├── Target B instance 1 (accepts: one, batch[1])
    └── Target B instance N (accepts: one, batch[N])
```

### Gather (N:1 Fan-In)

Waits for all batch slots to complete, then invokes next target with collected outputs.

```
Target B instance 0 → complete slot 0
Target B instance 1 → complete slot 1
Target B instance N → complete slot N (LAST)
    ↓ gather (triggered by last)
Target C (accepts: many [all outputs])
```

### Routing (Modifier, Not Operation)

Any operation can include a `route` modifier to conditionally select the target:

```typescript
{
  scatter: 'default_target_id',
  route: [
    { where: { property: 'content_type', equals: 'file/pdf' }, target: 'pdf_handler_id' },
    { where: { property: 'content_type', equals: 'file/jpeg' }, target: 'image_handler_id' },
  ]
}
```

Routes are evaluated in order; first match wins. If no match, the default target is used.

### Target Discovery

When invoking a target, we GET the entity to discover its type:
- If type is `rhiza`, invoke via `POST /rhizai/:id/invoke`
- If type is `klados`, invoke via `POST /kladoi/:id/invoke`

This unifies the logic - you don't need to specify target type in the flow.

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
  RouteRule,
} from '../types';
import { createScatter } from './scatter';
import { completeBatchSlot } from './gather';
import { matchRoute } from './route';
import { invokeTarget, discoverTargetType } from './invoke';

/**
 * Result of interpreting a then spec
 */
export interface InterpretResult {
  /** What action was taken */
  action: 'done' | 'pass' | 'scatter' | 'gather_wait' | 'gather_trigger';

  /** Target ID that was invoked (if any) */
  target?: string;

  /** Whether target is klados or rhiza (discovered at runtime) */
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
 * 2. Resolves routing if present
 * 3. Executes the appropriate handoff operation
 * 4. Returns info for logging and status tracking
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
    return { action: 'done' };
  }

  // ═══════════════════════════════════════════════════════════════
  // Pass: 1:1 direct handoff
  // ═══════════════════════════════════════════════════════════════
  if ('pass' in then) {
    // Resolve target (may be overridden by route)
    const targetId = await resolveTarget(client, then.pass, then.route, outputs);
    const targetType = await discoverTargetType(client, targetId);

    const invocations = await invokeTarget(
      client,
      context,
      targetId,
      targetType,
      outputs,
      logEntryId
    );

    return {
      action: 'pass',
      target: targetId,
      target_type: targetType,
      invocations,
      handoffRecord: {
        type: 'pass',
        target: targetId,
        target_type: targetType,
        invocations,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Scatter: 1:N fan-out
  // ═══════════════════════════════════════════════════════════════
  if ('scatter' in then) {
    // Resolve target (may be overridden by route)
    const targetId = await resolveTarget(client, then.scatter, then.route, outputs);
    const targetType = await discoverTargetType(client, targetId);

    const scatterResult = await createScatter(
      client,
      context,
      currentKladosId,
      targetId,
      targetType,
      outputs,
      logEntryId
    );

    return {
      action: 'scatter',
      target: targetId,
      target_type: targetType,
      invocations: scatterResult.invocations,
      batch: {
        id: scatterResult.batchId,
        isLast: false,
      },
      handoffRecord: {
        type: 'scatter',
        target: targetId,
        target_type: targetType,
        batch_id: scatterResult.batchId,
        invocations: scatterResult.invocations,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Gather: N:1 fan-in
  // ═══════════════════════════════════════════════════════════════
  if ('gather' in then) {
    // Resolve target (may be overridden by route)
    const targetId = await resolveTarget(client, then.gather, then.route, outputs);

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
      const targetType = await discoverTargetType(client, targetId);

      const invocations = await invokeTarget(
        client,
        context,
        targetId,
        targetType,
        gatherResult.allOutputs!,
        logEntryId
      );

      return {
        action: 'gather_trigger',
        target: targetId,
        target_type: targetType,
        invocations,
        batch: gatherResult,
        handoffRecord: {
          type: 'gather',
          target: targetId,
          target_type: targetType,
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

  throw new Error(`Unknown then spec: ${JSON.stringify(then)}`);
}

/**
 * Resolve the target, applying route rules if present
 */
async function resolveTarget(
  client: ArkeClient,
  defaultTarget: string,
  route: RouteRule[] | undefined,
  outputs: string[]
): Promise<string> {
  if (!route || route.length === 0) {
    return defaultTarget;
  }

  const matchedRule = await matchRoute(client, outputs, route);
  return matchedRule?.target ?? defaultTarget;
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
 * Discover target type by fetching the entity
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

  if (entity.type === 'rhiza') {
    return 'rhiza';
  }
  if (entity.type === 'klados') {
    return 'klados';
  }

  throw new Error(`Target ${targetId} has unknown type: ${entity.type}`);
}

/**
 * Invoke a target (klados or rhiza) based on its type
 *
 * Returns invocation records for logging.
 */
export async function invokeTarget(
  client: ArkeClient,
  context: RhizaContext,
  targetId: string,
  targetType: 'klados' | 'rhiza',
  outputs: string[],
  fromLogId: string,
  batchContext?: BatchContext
): Promise<InvocationRecord[]> {
  if (targetType === 'rhiza') {
    return invokeRhiza(client, context, targetId, outputs, fromLogId, batchContext);
  }
  return invokeKlados(client, context, targetId, outputs, fromLogId, batchContext);
}

/**
 * Invoke a klados via POST /kladoi/:id/invoke
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

  // Build rhiza context for the klados
  // path: sequence of klados IDs from entry to current
  // parent_logs: immediate parent log ID(s)
  const rhizaContext = {
    id: context.id,
    flow: context.flow,
    position: kladosId,
    path: [...context.path, kladosId],
    parent_logs: [fromLogId],
    batch: batchContext,
  };

  // Invoke via POST /kladoi/:id/invoke
  const { data, error } = await client.api.POST('/kladoi/{id}/invoke', {
    params: { path: { id: kladosId } },
    body: {
      target: request.target,
      job_collection: request.job_collection,
      input: request.input,
      rhiza_context: rhizaContext,
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
 *
 * Fire-and-forget: the sub-rhiza creates log entries pointing back to parent.
 * Parent does not track children.
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
  const target = outputs.length === 1 ? outputs[0] : outputs[0];

  // Invoke via POST /rhizai/:id/invoke
  // Sub-rhiza gets its own job collection and context
  const { data, error } = await client.api.POST('/rhizai/{id}/invoke', {
    params: { path: { id: rhizaId } },
    body: {
      target,
      // Pass parent info for log entry linkage (fire-and-forget)
      parent_logs: [fromLogId],
      parent_rhiza_id: context.id,
      batch_context: batchContext,
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
    job_collection: context.job_collection,
    api_base: context.api_base,
    expires_at: context.expires_at,
    network: context.network,
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
import { invokeTarget } from './invoke';
import { generateId } from '../utils';

export interface ScatterResult {
  batchId: string;
  invocations: InvocationRecord[];
}

/**
 * Create a scatter operation (fan-out)
 *
 * 1. Creates batch entity in job collection
 * 2. Invokes target (klados or rhiza) once per output
 * 3. Returns batch ID and invocation records
 */
export async function createScatter(
  client: ArkeClient,
  context: RhizaContext,
  sourceKladosId: string,
  targetId: string,
  targetType: 'klados' | 'rhiza',
  outputs: string[],
  fromLogId: string
): Promise<ScatterResult> {
  // Find the gather target by looking at the target's flow step
  const gatherTarget = findGatherTarget(context.flow, targetId);

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

        const invs = await invokeTarget(
          client,
          context,
          targetId,
          targetType,
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
 * Looks at the target's flow step to find its gather target.
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
 * Routes are evaluated in order; first match wins.
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

export { invokeKlados, invokeRhiza, invokeTarget, discoverTargetType, buildKladosRequest } from './invoke';
export type { InvokeResult } from './invoke';
```
