# SDK Utilities Implementation Plan

## Overview

The rhiza library should be a comprehensive library for:
1. **Types** - Core entity and request/response types
2. **Pure logic** - Validation, route matching, target resolution
3. **SDK utilities** - Functions that use `@arke-institute/sdk` to interact with the Arke API

The SDK should be a **peer dependency**, allowing workers to use rhiza's utilities while controlling their own SDK version.

---

## Current State

### What Exists (Pure Functions)

| Module | Functions | Description |
|--------|-----------|-------------|
| `handoff/route.ts` | `evaluateWhere`, `matchRoute` | Pure route matching logic |
| `handoff/target.ts` | `resolveTarget` | Pure target resolution from ThenSpec |
| `handoff/scatter.ts` | `findGatherTarget` | Pure helper to find gather target |
| `handoff/gather.ts` | `completeBatchSlot`, `errorBatchSlot` | Pure state transformations (no API) |
| `validation/` | `validateKladosProperties`, `validateRhizaProperties` | Pure validation |

### What Needs to be Added

| Module | Functions | Description |
|--------|-----------|-------------|
| `logging/logger.ts` | `KladosLogger` | In-memory message collector |
| `logging/writer.ts` | `writeKladosLog`, `updateLogWithHandoffs`, `updateLogStatus` | Log API writes (uses `withCasRetry`) |
| `handoff/invoke.ts` | `discoverTargetType`, `invokeKlados`, `invokeRhiza`, `invokeTarget` | Target invocation |
| `handoff/scatter-api.ts` | `createScatterBatch` | Batch creation + invocation |
| `handoff/gather-api.ts` | `completeBatchSlotWithCAS`, `errorBatchSlotWithCAS` | CAS-based batch updates (uses `withCasRetry`) |
| `handoff/interpret.ts` | `interpretThen` | Main orchestration dispatcher |
| `utils/id.ts` | `generateId` | ID generation utility |

---

## Type Alignment Review

### Current Types Match Plan ✓

1. **`InvocationRecord`** - Current implementation is correct for fire-and-forget:
   ```typescript
   interface InvocationRecord {
     request: KladosRequest;  // Full request for replay on resume
     batch_index?: number;    // Optional batch index
   }
   ```
   The plan's version has extra fields (`job_id`, `target_entity`, `status`) that are redundant with `request.job_id`, `request.target`, and the fire-and-forget model.

2. **`HandoffRecord`** - Current is correct:
   ```typescript
   interface HandoffRecord {
     type: 'pass' | 'scatter' | 'gather';
     target: string;
     target_type: 'klados' | 'rhiza';
     batch_id?: string;
     invocations: InvocationRecord[];
   }
   ```

3. **`KladosLogEntry`** - Current has correct structure with `received.from_logs` for chain traversal.

4. **`BatchContext`** - Current is simplified (no `gather_target` - looked up from flow).

---

## Implementation Details

### 1. Logging Module (`src/logging/`)

#### `logger.ts` - In-memory message collector (no SDK)

```typescript
export class KladosLogger {
  private messages: LogMessage[] = [];

  info(message: string, metadata?: Record<string, unknown>): void;
  warning(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  success(message: string, metadata?: Record<string, unknown>): void;

  getMessages(): LogMessage[];
  clear(): void;
}
```

#### `writer.ts` - Log API writes (needs SDK)

```typescript
export interface WriteLogOptions {
  client: ArkeClient;
  jobCollectionId: string;
  entry: KladosLogEntry;
  messages: LogMessage[];
  agentId: string;
  agentVersion: string;
}

export interface WriteLogResult {
  logId: string;
  fileId: string;
}

export async function writeKladosLog(options: WriteLogOptions): Promise<WriteLogResult>;
export async function updateLogWithHandoffs(client: ArkeClient, logFileId: string, handoffs: HandoffRecord[]): Promise<void>;
export async function updateLogStatus(client: ArkeClient, logFileId: string, status: 'running' | 'done' | 'error', error?: LogError): Promise<void>;
```

### 2. Invocation Module (`src/handoff/invoke.ts`)

```typescript
export async function discoverTargetType(client: ArkeClient, targetId: string): Promise<'klados' | 'rhiza'>;

export async function invokeKlados(
  client: ArkeClient,
  kladosId: string,
  target: string | string[],
  options: InvokeOptions
): Promise<InvocationRecord>;

export async function invokeRhiza(
  client: ArkeClient,
  rhizaId: string,
  target: string,
  options: InvokeOptions
): Promise<InvocationRecord>;

export async function invokeTarget(
  client: ArkeClient,
  targetId: string,
  targetType: 'klados' | 'rhiza',
  target: string | string[],
  options: InvokeOptions
): Promise<InvocationRecord>;
```

### 3. Scatter API (`src/handoff/scatter-api.ts`)

```typescript
export interface CreateScatterOptions {
  client: ArkeClient;
  rhizaId: string;
  jobId: string;
  jobCollectionId: string;
  sourceKladosId: string;
  targetId: string;
  targetType: 'klados' | 'rhiza';
  gatherTargetId: string;
  outputs: string[];
  fromLogId: string;
}

export interface ScatterResult {
  batchId: string;
  batch: BatchEntity;
  invocations: InvocationRecord[];
}

export async function createScatterBatch(options: CreateScatterOptions): Promise<ScatterResult>;
```

### 4. Gather API (`src/handoff/gather-api.ts`)

Uses SDK's `withCasRetry` for atomic batch slot updates:

```typescript
import { withCasRetry } from '@arke-institute/sdk';

export interface GatherSlotResult {
  batch: BatchEntity;
  isLast: boolean;
  allOutputs?: string[][];
  attempts: number;
}

export async function completeBatchSlotWithCAS(
  client: ArkeClient,
  batchId: string,
  slotIndex: number,
  outputIds: string[]
): Promise<GatherSlotResult>;

export async function errorBatchSlotWithCAS(
  client: ArkeClient,
  batchId: string,
  slotIndex: number,
  error: SlotError
): Promise<{ attempts: number }>;
```

### 5. Orchestration (`src/handoff/interpret.ts`)

```typescript
export interface InterpretContext {
  client: ArkeClient;
  rhizaId: string;
  kladosId: string;
  jobId: string;
  jobCollectionId: string;
  flow: Record<string, FlowStep>;
  outputs: string[];
  outputProperties?: Record<string, unknown>;
  fromLogId: string;
  batchContext?: BatchContext;
}

export interface InterpretResult {
  action: 'done' | 'pass' | 'scatter' | 'gather_wait' | 'gather_trigger';
  target?: string;
  targetType?: 'klados' | 'rhiza';
  invocations?: InvocationRecord[];
  batch?: BatchEntity;
  allOutputs?: string[][];
  handoffRecord?: HandoffRecord;
}

export async function interpretThen(
  then: ThenSpec,
  context: InterpretContext
): Promise<InterpretResult>;
```

---

## Package Configuration

### `package.json` changes

```json
{
  "peerDependencies": {
    "@arke-institute/sdk": "^1.0.0"
  },
  "peerDependenciesMeta": {
    "@arke-institute/sdk": {
      "optional": true
    }
  },
  "devDependencies": {
    "@arke-institute/sdk": "^1.0.0"
  }
}
```

Note: SDK is optional so consumers can use just types without SDK.

---

## Export Structure

### Main exports (`src/index.ts`)

```typescript
// Types (existing)
export type { KladosLogEntry, HandoffRecord, ... } from './types';

// Validation (existing)
export { validateKladosProperties, validateRhizaProperties } from './validation';

// Handoff - Pure functions (existing)
export { evaluateWhere, matchRoute } from './handoff/route';
export { resolveTarget } from './handoff/target';
export { findGatherTarget } from './handoff/scatter';
export { completeBatchSlot, errorBatchSlot } from './handoff/gather';

// Handoff - SDK utilities (NEW)
export { discoverTargetType, invokeKlados, invokeRhiza, invokeTarget } from './handoff/invoke';
export { createScatterBatch } from './handoff/scatter-api';
export { completeBatchSlotWithCAS, errorBatchSlotWithCAS } from './handoff/gather-api';
export { interpretThen } from './handoff/interpret';

// Logging (NEW)
export { KladosLogger } from './logging/logger';
export { writeKladosLog, updateLogWithHandoffs, updateLogStatus } from './logging/writer';

// Utilities (NEW)
export { generateId } from './utils/id';
```

---

## Design Decisions

### 1. Log Chain Traversal - NOT INCLUDED

Log chain traversal (`getJobLogs`, `buildLogTree`, etc.) is **not included** in rhiza. The API handles traversal at scale with optimized queries.

### 2. Status/Resume - NOT INCLUDED

Status and resume functions are purely API concerns. The API works through logs + invoke endpoints.

### 3. CAS Retry - Use SDK's `withCasRetry`

Use the SDK's built-in `withCasRetry` function instead of custom retry logic:

```typescript
import { withCasRetry } from '@arke-institute/sdk';

const { data, attempts } = await withCasRetry({
  getTip: async () => {
    const { data, error } = await client.api.GET('/entities/{id}/tip', {
      params: { path: { id: entityId } }
    });
    if (error || !data) throw new Error('Failed to get tip');
    return data.cid;
  },
  update: async (tip) => {
    return client.api.PUT('/entities/{id}', {
      params: { path: { id: entityId } },
      body: { expect_tip: tip, ... }
    });
  }
}, { concurrency: 100 });
```

### 4. Utilities

- **`generateId()`** - Included in rhiza
- **`sleep()`** - Not needed (SDK handles retries)

---

## Implementation Order

1. **Phase 1: Utilities & Logging**
   - `src/utils/id.ts` - ID generation
   - `src/logging/logger.ts` - Pure, no SDK
   - `src/logging/writer.ts` - SDK log writes (uses `withCasRetry`)

2. **Phase 2: Invocation**
   - `src/handoff/invoke.ts` - Target discovery and invocation

3. **Phase 3: Scatter/Gather API**
   - `src/handoff/scatter-api.ts` - Batch creation
   - `src/handoff/gather-api.ts` - CAS updates (uses `withCasRetry`)

4. **Phase 4: Orchestration**
   - `src/handoff/interpret.ts` - Main dispatcher

5. **Phase 5: Package & Exports**
   - Update `package.json` with peer dependency
   - Update `src/index.ts` with new exports
   - Update tests
