# SDK Integration & Simplification Plan

## What rhiza Should Be

A **types and pure logic library** for klados workers and the API to import. No API calls - those are done via SDK directly.

---

## What to Keep

### Types (`src/types/`)
All types stay - they define the shapes:
- `KladosEntity`, `KladosProperties`, `ContractSpec`
- `RhizaEntity`, `RhizaProperties`, `FlowStep`, `ThenSpec`, `RouteRule`
- `EntityRef`, `isEntityRef`, `ref`
- `KladosRequest`, `RhizaContext`, `BatchContext`
- `KladosResponse`, `KladosResult`
- `KladosLogEntry`, `HandoffRecord`, `InvocationRecord`
- `BatchEntity`, `BatchProperties`, `BatchSlot`

### Validation (`src/validation/`)
All validation stays:
- `validateKladosProperties()` - Static klados validation
- `validateRhizaProperties()` - Static rhiza flow validation
- `validateRhizaRuntime()` - Runtime checks

### Pure Handoff Logic
Keep only the **pure functions** (no API calls):

**Route matching (`src/handoff/route.ts`):**
- `evaluateWhere()` - Evaluate a where condition against properties
- `matchRoute()` - Find first matching route rule

**Target resolution (`src/handoff/target.ts`):**
- `resolveTarget()` - Resolve target from ThenSpec using routing rules

**Scatter helpers (`src/handoff/scatter.ts`):**
- `findGatherTarget()` - Look up gather target from flow

**Gather helpers (`src/handoff/gather.ts`):**
- `completeBatchSlot()` - Mark slot complete, check if last
- `errorBatchSlot()` - Mark slot errored, check if terminal

---

## What to Remove/Archive

### Archive (move to `_archive/`)
These will inform API implementation:

**`src/handoff/target.ts` - `discoverTargetType()`**
- Makes API calls to check if target is klados or rhiza
- Workers should use SDK directly OR use EntityRef.type hint

**`src/handoff/scatter.ts` - `createScatterBatch()`**
- Creates batch entity and invokes klados for each item
- Workers should use SDK to create batch + invoke

**`src/handoff/interpret.ts` - entire file**
- Orchestrates handoffs, calls all the above
- Workers should compose pure functions + SDK calls themselves

**`src/client/` - entire module**
- Unnecessary abstraction over SDK

**`src/resume/` - entire module**
- Goes in API (needs queue for scale)

**`src/status/` - entire module**
- `buildStatusFromLogs` goes in API
- Traverse utilities (`findLeaves`, `findErrorLeaves`, `buildLogTree`) also go in API

**`src/traverse/` - entire module**
- Used for status/resume - goes in API

---

## Migration Checklist

### Phase 1: Archive
```
_archive/
├── client/           # RhizaClient, MockRhizaClient, types
├── resume/           # resumeWorkflow, canResume
├── status/           # buildStatusFromLogs
├── traverse/         # findLeaves, findErrorLeaves, buildLogTree
└── handoff/
    ├── interpret.ts  # interpretThen
    └── NOTES.md      # discoverTargetType, createScatterBatch logic
```

- [ ] Create `_archive/` structure
- [ ] Move files with README explaining where they go

### Phase 2: Clean Up Handoff
- [ ] Remove `discoverTargetType` from `target.ts` (keep `resolveTarget`)
- [ ] Remove `createScatterBatch` from `scatter.ts` (keep `findGatherTarget`)
- [ ] Delete `interpret.ts`
- [ ] Update exports

### Phase 3: Update Exports
Update `src/index.ts`:

```typescript
// Types (all)
export type { KladosEntity, KladosProperties, ContractSpec } from './types/klados';
export type { RhizaEntity, RhizaProperties, FlowStep, ThenSpec, RouteRule, ... } from './types/rhiza';
export type { EntityRef } from './types/refs';
export { isEntityRef, ref } from './types/refs';
export type { KladosRequest, RhizaContext, BatchContext } from './types/request';
export type { KladosResponse, KladosResult } from './types/response';
export type { KladosLogEntry, HandoffRecord, ... } from './types/log';
export type { BatchEntity, BatchProperties, BatchSlot } from './types/batch';

// Validation
export { validateKladosProperties } from './validation/validate-klados';
export { validateRhizaProperties } from './validation/validate-rhiza';
export { validateRhizaRuntime } from './validation/validate-runtime';

// Pure handoff logic
export { evaluateWhere, matchRoute } from './handoff/route';
export { resolveTarget } from './handoff/target';
export { findGatherTarget } from './handoff/scatter';
export { completeBatchSlot, errorBatchSlot } from './handoff/gather';
```

### Phase 4: Update Tests
- [ ] Remove tests for archived functions
- [ ] Keep tests for pure functions
- [ ] Remove mock client dependency where possible

### Phase 5: Verify
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] No SDK dependency needed in rhiza itself (it's optional for types only)

---

## Usage Pattern After Cleanup

Workers use rhiza for types + pure logic, SDK for API calls:

```typescript
import { ArkeClient } from '@arke-institute/sdk';
import {
  resolveTarget,
  completeBatchSlot,
  type ThenSpec,
  type KladosRequest
} from '@arke-institute/rhiza';

// Worker receives request
async function handleRequest(req: KladosRequest, client: ArkeClient) {
  // ... do work ...

  // Use pure function to resolve routing
  const target = resolveTarget(thenSpec, outputProperties);

  if (target) {
    // Use SDK to invoke next klados
    await client.api.POST('/kladoi/{id}/invoke', {
      params: { path: { id: target.pi } },
      body: { target: outputEntityId, confirm: true }
    });
  }
}
```

---

## Dependencies After Cleanup

```json
{
  "dependencies": {},
  "peerDependencies": {
    "@arke-institute/sdk": "^2.8.0"  // Optional - only for types
  }
}
```

rhiza becomes a pure TypeScript library with no runtime dependencies.
