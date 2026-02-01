# Test Implementation Plan

## Overview

This document provides a detailed implementation plan for the rhiza test suite. Each test is documented with:
- **Purpose**: What aspect of the system the test validates
- **Setup**: Required fixtures and mock configuration
- **Expectation**: The specific behavior being verified
- **Implementation Notes**: Key details for implementing the test

---

## Phase 1: Test Infrastructure

### 1.1 Directory Structure Setup

Create the following directory structure:

```
src/
├── __tests__/
│   ├── unit/
│   │   ├── validation/
│   │   │   ├── klados.test.ts
│   │   │   ├── rhiza.test.ts
│   │   │   └── runtime.test.ts
│   │   ├── handoff/
│   │   │   ├── interpret.test.ts
│   │   │   ├── scatter.test.ts
│   │   │   ├── gather.test.ts
│   │   │   └── route.test.ts
│   │   ├── target.test.ts
│   │   ├── traverse.test.ts
│   │   ├── resume.test.ts
│   │   └── status.test.ts
│   │
│   ├── integration/
│   │   ├── setup.ts
│   │   ├── klados-crud.test.ts
│   │   ├── rhiza-crud.test.ts
│   │   ├── klados-invoke.test.ts
│   │   ├── rhiza-invoke.test.ts
│   │   ├── batch.test.ts
│   │   └── log-chain.test.ts
│   │
│   ├── e2e/
│   │   ├── setup.ts
│   │   ├── linear.test.ts
│   │   ├── scatter-gather.test.ts
│   │   ├── conditional.test.ts
│   │   ├── sub-workflow.test.ts
│   │   └── resume.test.ts
│   │
│   └── fixtures/
│       ├── mock-client.ts
│       ├── kladoi/
│       │   ├── index.ts
│       │   ├── producer.ts
│       │   ├── worker.ts
│       │   └── aggregator.ts
│       ├── rhizai/
│       │   ├── linear.ts
│       │   ├── scatter-gather.ts
│       │   ├── conditional.ts
│       │   └── invalid.ts
│       └── logs/
│           ├── success.ts
│           └── partial-error.ts
```

### 1.2 Mock Client Implementation

**File**: `src/__tests__/fixtures/mock-client.ts`

**Purpose**: Provides a configurable mock of the Arke SDK client for unit tests.

```typescript
interface MockClientConfig {
  // Pre-loaded entities by type
  kladoi?: Record<string, MockKlados>;
  rhizai?: Record<string, MockRhiza>;
  entities?: Record<string, MockEntity>;
  batches?: Record<string, BatchProperties>;
  logs?: KladosLogEntry[];

  // Error simulation
  errors?: {
    notFound?: string[];           // Entity IDs that return 404
    onUpdate?: number;             // Fail first N updates (CAS retry test)
    onInvoke?: Record<string, string>; // Klados ID → error message
  };
}

interface MockArkeClient {
  api: MockAPI;

  // Test inspection helpers
  getCreated(): Array<{ type: string; properties: unknown }>;
  getUpdated(): Array<{ id: string; properties: unknown }>;
  getInvoked(): Array<{ kladosId: string; request: unknown }>;
  reset(): void;
}
```

**Key Implementation Details**:
- Track all mutations (creates, updates) for test assertions
- Track all invocations for verifying handoffs
- Support CAS conflict simulation with configurable retry counts
- Support entity not found errors for error handling tests

---

## Phase 2: Unit Tests - Validation Module

### 2.1 Klados Validation Tests

**File**: `src/__tests__/unit/validation/klados.test.ts`

#### Test: `passes for valid klados properties`

**Purpose**: Verify that a correctly-formed klados passes validation.

**Setup**:
```typescript
const validKlados = {
  label: 'OCR Service',
  endpoint: 'https://ocr.arke.institute',
  actions_required: ['file:view', 'entity:update'],
  accepts: { types: ['file/jpeg'], cardinality: 'one' },
  produces: { types: ['text/ocr'], cardinality: 'one' },
  status: 'active',
};
```

**Expectation**:
- `result.valid === true`
- `result.errors.length === 0`

---

#### Test: `fails when endpoint is missing`

**Purpose**: Validate that endpoint is a required field.

**Setup**: Omit `endpoint` from klados properties.

**Expectation**:
- `result.valid === false`
- `result.errors` contains error with `code: 'MISSING_ENDPOINT'`

---

#### Test: `fails when endpoint is invalid URL`

**Purpose**: Validate URL format checking.

**Setup**:
```typescript
{ endpoint: 'not-a-valid-url' }
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains error with `code: 'INVALID_ENDPOINT'`

---

#### Test: `fails when accepts.types is empty`

**Purpose**: Ensure input contract is explicitly defined.

**Setup**:
```typescript
{ accepts: { types: [], cardinality: 'one' } }
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains error with `code: 'EMPTY_ACCEPTS_TYPES'`

---

#### Test: `fails when produces.types is empty`

**Purpose**: Ensure output contract is explicitly defined.

**Setup**:
```typescript
{ produces: { types: [], cardinality: 'one' } }
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains error with `code: 'EMPTY_PRODUCES_TYPES'`

---

#### Test: `fails when cardinality is invalid`

**Purpose**: Validate cardinality enum values.

**Setup**:
```typescript
{ accepts: { types: ['*'], cardinality: 'invalid' } }
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains error with `code: 'INVALID_CARDINALITY'`

---

#### Test: `fails when actions_required is empty`

**Purpose**: Ensure at least one required action is specified.

**Setup**:
```typescript
{ actions_required: [] }
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains error with `code: 'EMPTY_ACTIONS'`

---

#### Test: `warns but passes for valid with wildcard types`

**Purpose**: Wildcard types are valid but may indicate overly permissive contracts.

**Setup**:
```typescript
{ accepts: { types: ['*'], cardinality: 'one' } }
```

**Expectation**:
- `result.valid === true`
- Optionally: `result.warnings` may contain informational warning

---

### 2.2 Rhiza Validation Tests

**File**: `src/__tests__/unit/validation/rhiza.test.ts`

#### Test: `passes for valid linear flow`

**Purpose**: Validate a simple A → B → done workflow.

**Setup**:
```typescript
const linearRhiza = {
  label: 'Linear Test',
  version: '1.0',
  entry: 'klados_a',
  flow: {
    'klados_a': { then: { pass: 'klados_b' } },
    'klados_b': { then: { done: true } },
  },
  status: 'active',
};
```

**Expectation**:
- `result.valid === true`
- `result.errors.length === 0`

---

#### Test: `passes for valid scatter-gather flow`

**Purpose**: Validate fan-out/fan-in pattern.

**Setup**:
```typescript
const scatterGatherRhiza = {
  entry: 'producer',
  flow: {
    'producer': { then: { scatter: 'worker' } },
    'worker': { then: { gather: 'aggregator' } },
    'aggregator': { then: { done: true } },
  },
};
```

**Expectation**:
- `result.valid === true`

---

#### Test: `passes for valid conditional flow`

**Purpose**: Validate routing rules with multiple targets.

**Setup**:
```typescript
const conditionalRhiza = {
  entry: 'classifier',
  flow: {
    'classifier': {
      then: {
        pass: 'default_handler',
        route: [
          { where: { property: 'type', equals: 'pdf' }, target: 'pdf_handler' },
          { where: { property: 'type', equals: 'image' }, target: 'image_handler' },
        ],
      },
    },
    'pdf_handler': { then: { done: true } },
    'image_handler': { then: { done: true } },
    'default_handler': { then: { done: true } },
  },
};
```

**Expectation**:
- `result.valid === true`

---

#### Test: `fails when entry klados ID is missing`

**Purpose**: Entry point is required.

**Setup**: Omit `entry` field.

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'MISSING_ENTRY'`

---

#### Test: `fails when entry klados ID is not in flow`

**Purpose**: Entry must reference a defined flow step.

**Setup**:
```typescript
{
  entry: 'does_not_exist',
  flow: {
    'klados_a': { then: { done: true } },
  },
}
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'ENTRY_NOT_IN_FLOW'`

---

#### Test: `fails when target klados ID does not exist in flow`

**Purpose**: All pass/scatter/gather targets must be in flow.

**Setup**:
```typescript
{
  entry: 'klados_a',
  flow: {
    'klados_a': { then: { pass: 'nonexistent' } },
  },
}
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'INVALID_TARGET'`

---

#### Test: `fails when no terminal step exists`

**Purpose**: All paths must eventually reach `done: true`.

**Setup**:
```typescript
{
  entry: 'klados_a',
  flow: {
    'klados_a': { then: { pass: 'klados_b' } },
    'klados_b': { then: { pass: 'klados_a' } }, // Infinite loop, no terminal
  },
}
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'UNTERMINATED_PATH'` or `code: 'CYCLE_DETECTED'`

---

#### Test: `fails when cycle detected`

**Purpose**: Detect circular references in flow graph.

**Setup**:
```typescript
{
  entry: 'a',
  flow: {
    'a': { then: { pass: 'b' } },
    'b': { then: { pass: 'c' } },
    'c': { then: { pass: 'a' } }, // Cycle!
  },
}
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'CYCLE_DETECTED'`
- Error message includes cycle path: `'a -> b -> c -> a'`

---

#### Test: `warns about unreachable klados IDs`

**Purpose**: Detect orphaned flow steps that can never execute.

**Setup**:
```typescript
{
  entry: 'klados_a',
  flow: {
    'klados_a': { then: { done: true } },
    'klados_orphan': { then: { done: true } }, // Never reached
  },
}
```

**Expectation**:
- `result.valid === true` (warning only)
- `result.warnings` contains `code: 'UNREACHABLE_KLADOS'` for `klados_orphan`

---

#### Test: `fails when then spec is missing`

**Purpose**: Every flow step must have a `then` specification.

**Setup**:
```typescript
{
  entry: 'klados_a',
  flow: {
    'klados_a': {}, // Missing then
  },
}
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'MISSING_THEN'`

---

#### Test: `fails when then has unknown handoff type`

**Purpose**: Validate handoff type is one of: done, pass, scatter, gather.

**Setup**:
```typescript
{
  flow: {
    'klados_a': { then: { invalid_type: 'something' } },
  },
}
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'INVALID_HANDOFF'`

---

#### Test: `fails when route rule is missing where or target`

**Purpose**: Route rules must have both condition and target.

**Setup**:
```typescript
{
  flow: {
    'klados_a': {
      then: {
        pass: 'default',
        route: [{ target: 'other' }], // Missing 'where'
      },
    },
  },
}
```

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'INVALID_ROUTE_RULE'`

---

### 2.3 Runtime Validation Tests

**File**: `src/__tests__/unit/validation/runtime.test.ts`

These tests require a mock client to simulate API responses.

#### Test: `passes when all kladoi exist and are active`

**Purpose**: Verify successful runtime validation when all dependencies are met.

**Setup**: Mock client returns all referenced kladoi with `status: 'active'`.

**Expectation**:
- `result.valid === true`
- `result.kladoi` map contains all loaded klados entities

---

#### Test: `fails when klados not found`

**Purpose**: Detect missing klados dependencies.

**Setup**: Mock client returns 404 for one referenced klados.

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'TARGET_NOT_FOUND'`

---

#### Test: `fails when klados is not active`

**Purpose**: Only active kladoi can be invoked.

**Setup**: Mock client returns klados with `status: 'disabled'`.

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'KLADOS_NOT_ACTIVE'`

---

#### Test: `fails when scatter klados produces one`

**Purpose**: Scatter requires producer to output many items.

**Setup**: Source klados has `produces.cardinality: 'one'` but uses `scatter`.

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'PRODUCER_CARDINALITY_MISMATCH'`

---

#### Test: `fails when scatter target accepts many`

**Purpose**: Scatter target receives individual items (one at a time).

**Setup**: Scatter target has `accepts.cardinality: 'many'`.

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'TARGET_CARDINALITY_MISMATCH'`

---

#### Test: `fails when gather target accepts one`

**Purpose**: Gather target receives collected outputs (many items).

**Setup**: Gather target has `accepts.cardinality: 'one'`.

**Expectation**:
- `result.valid === false`
- `result.errors` contains `code: 'TARGET_CARDINALITY_MISMATCH'`

---

#### Test: `warns about cardinality mismatch in pass`

**Purpose**: Detect potential issues with mismatched cardinalities.

**Setup**: Pass from `produces: many` to `accepts: one`.

**Expectation**:
- `result.valid === true` (warning only)
- `result.warnings` contains `code: 'CARDINALITY_MISMATCH'`

---

#### Test: `warns about type mismatch`

**Purpose**: Detect potential type incompatibilities.

**Setup**: Source produces `['file/pdf']`, target accepts `['file/jpeg']`.

**Expectation**:
- `result.valid === true` (warning only)
- `result.warnings` contains `code: 'TYPE_MISMATCH'`

---

#### Test: `returns loaded kladoi map on success`

**Purpose**: Runtime validation returns loaded entities for reuse.

**Setup**: Valid rhiza with 3 kladoi.

**Expectation**:
- `result.kladoi.size === 3`
- Each klados entity is fully loaded

---

## Phase 3: Unit Tests - Handoff Module

### 3.1 Route Matching Tests

**File**: `src/__tests__/unit/handoff/route.test.ts`

#### Test: `evaluateWhere matches simple equality`

**Purpose**: Basic property matching.

**Setup**:
```typescript
const properties = { type: 'File', content_type: 'image/jpeg' };
const where = { property: 'content_type', equals: 'image/jpeg' };
```

**Expectation**: `evaluateWhere(properties, where) === true`

---

#### Test: `evaluateWhere matches AND conditions`

**Purpose**: All conditions must match.

**Setup**:
```typescript
const where = {
  and: [
    { property: 'type', equals: 'File' },
    { property: 'content_type', equals: 'image/jpeg' },
  ],
};
```

**Expectation**: Returns `true` only when both conditions match.

---

#### Test: `evaluateWhere matches OR conditions`

**Purpose**: Any condition can match.

**Setup**:
```typescript
const where = {
  or: [
    { property: 'content_type', equals: 'image/jpeg' },
    { property: 'content_type', equals: 'image/png' },
  ],
};
```

**Expectation**: Returns `true` when either condition matches.

---

#### Test: `evaluateWhere handles nested AND/OR`

**Purpose**: Complex nested conditions.

**Setup**:
```typescript
const where = {
  and: [
    { property: 'type', equals: 'File' },
    {
      or: [
        { property: 'content_type', equals: 'image/jpeg' },
        { property: 'content_type', equals: 'image/png' },
      ],
    },
  ],
};
```

**Expectation**: Correctly evaluates nested logic.

---

#### Test: `evaluateWhere handles nested property paths`

**Purpose**: Support dot-notation for nested properties.

**Setup**:
```typescript
const properties = { metadata: { format: 'pdf' } };
const where = { property: 'metadata.format', equals: 'pdf' };
```

**Expectation**: `evaluateWhere(properties, where) === true`

---

#### Test: `evaluateWhere returns false for missing property`

**Purpose**: Missing properties should not match.

**Setup**:
```typescript
const properties = { type: 'File' };
const where = { property: 'nonexistent', equals: 'value' };
```

**Expectation**: `evaluateWhere(properties, where) === false`

---

#### Test: `matchRoute returns first matching rule`

**Purpose**: Rules are evaluated in order.

**Setup**:
```typescript
const rules = [
  { where: { property: 'type', equals: 'A' }, target: 'handler_a' },
  { where: { property: 'type', equals: 'B' }, target: 'handler_b' },
];
const entity = { properties: { type: 'A' } };
```

**Expectation**: Returns rule with `target: 'handler_a'`

---

#### Test: `matchRoute returns null when no rules match`

**Purpose**: Default target should be used when no rules match.

**Setup**: Entity properties don't match any rule conditions.

**Expectation**: `matchRoute(...) === null`

---

### 3.2 Target Discovery Tests

**File**: `src/__tests__/unit/target.test.ts`

#### Test: `resolveTarget returns default target when no route rules`

**Purpose**: Simple case with no routing.

**Setup**: `then: { pass: 'target_a' }` with no `route` array.

**Expectation**: Returns `'target_a'`

---

#### Test: `resolveTarget evaluates route rules in order`

**Purpose**: First matching rule wins.

**Setup**: Multiple rules, entity matches second rule.

**Expectation**: Returns second rule's target.

---

#### Test: `resolveTarget falls back to default when no rules match`

**Purpose**: Default target is used as fallback.

**Setup**: No rules match entity properties.

**Expectation**: Returns the default target from `pass`/`scatter`/`gather`.

---

#### Test: `discoverTargetType returns klados when target is klados entity`

**Purpose**: Correctly identify klados targets.

**Setup**: Mock client returns entity with `type: 'klados'`.

**Expectation**: Returns `'klados'`

---

#### Test: `discoverTargetType returns rhiza when target is rhiza entity`

**Purpose**: Correctly identify sub-workflow targets.

**Setup**: Mock client returns entity with `type: 'rhiza'`.

**Expectation**: Returns `'rhiza'`

---

#### Test: `discoverTargetType throws when target not found`

**Purpose**: Error handling for missing targets.

**Setup**: Mock client returns 404.

**Expectation**: Throws error with descriptive message.

---

### 3.3 Scatter Tests

**File**: `src/__tests__/unit/handoff/scatter.test.ts`

#### Test: `findGatherTarget finds gather target from scatter klados flow step`

**Purpose**: Locate where scatter results will be gathered.

**Setup**:
```typescript
const flow = {
  'worker': { then: { gather: 'aggregator' } },
};
```

**Expectation**: `findGatherTarget(flow, 'worker') === 'aggregator'`

---

#### Test: `findGatherTarget throws when scatter target has no gather`

**Purpose**: Scatter must be paired with gather.

**Setup**: Target's `then` is `done: true` instead of `gather`.

**Expectation**: Throws error indicating missing gather.

---

#### Test: `createScatter creates batch entity with correct properties`

**Purpose**: Batch entity is properly initialized.

**Setup**: 3 output entities.

**Expectation**:
- Batch created with `total: 3`, `completed: 0`, `status: 'pending'`
- `slots` array has 3 entries, all `status: 'pending'`

---

#### Test: `createScatter invokes target klados once per output`

**Purpose**: Fan-out creates correct number of invocations.

**Setup**: 5 output entities.

**Expectation**: Mock client shows 5 invocations.

---

#### Test: `createScatter passes batch context to each invocation`

**Purpose**: Each invocation knows its position in the batch.

**Setup**: 3 outputs.

**Expectation**: Each invocation has `batch_context` with correct `index` and `total`.

---

#### Test: `createScatter returns all invocation records`

**Purpose**: Caller can log all invocations.

**Setup**: 3 outputs.

**Expectation**: `result.invocations.length === 3`

---

#### Test: `createScatter handles empty outputs array`

**Purpose**: Edge case with no outputs.

**Setup**: Empty outputs array.

**Expectation**:
- No batch created (or empty batch)
- No invocations made

---

#### Test: `createScatter respects concurrency limit`

**Purpose**: Don't overwhelm the system with parallel requests.

**Setup**: 100 outputs with concurrency limit of 10.

**Expectation**: Invocations are batched in groups of 10.

---

### 3.4 Gather Tests

**File**: `src/__tests__/unit/handoff/gather.test.ts`

#### Test: `completeBatchSlot updates slot to complete`

**Purpose**: Individual slot completion.

**Setup**: Batch with 3 slots, complete slot 0.

**Expectation**: Slot 0 has `status: 'complete'`, `output_ids` populated.

---

#### Test: `completeBatchSlot increments completed count`

**Purpose**: Track progress.

**Setup**: Complete one slot.

**Expectation**: Batch `completed` count increases by 1.

---

#### Test: `completeBatchSlot returns isLast: false when more slots pending`

**Purpose**: Don't trigger gather prematurely.

**Setup**: 3 slots, complete first one.

**Expectation**: `result.isLast === false`

---

#### Test: `completeBatchSlot returns isLast: true when all slots complete`

**Purpose**: Trigger gather when ready.

**Setup**: 3 slots, complete the last one.

**Expectation**: `result.isLast === true`

---

#### Test: `completeBatchSlot collects all outputs in slot order when last`

**Purpose**: Outputs are ordered correctly for gather target.

**Setup**: Slots complete in order: 2, 0, 1 (last).

**Expectation**: `result.allOutputs` is ordered by slot index: [slot0, slot1, slot2].

---

#### Test: `completeBatchSlot retries on CAS conflict (409)`

**Purpose**: Handle concurrent updates gracefully.

**Setup**: Mock client fails first 2 updates with 409.

**Expectation**: Operation succeeds after retries.

---

#### Test: `completeBatchSlot throws after max retries`

**Purpose**: Don't retry forever.

**Setup**: Mock client always fails with 409.

**Expectation**: Throws error after max retries.

---

#### Test: `errorBatchSlot marks slot as error`

**Purpose**: Handle slot failures.

**Setup**: Report error for slot 1.

**Expectation**: Slot 1 has `status: 'error'`, `error` object populated.

---

#### Test: `errorBatchSlot marks batch as error when all slots terminal`

**Purpose**: Batch status reflects overall outcome.

**Setup**: 3 slots, 2 complete, 1 error.

**Expectation**: Batch `status: 'error'`.

---

### 3.5 Interpret Tests

**File**: `src/__tests__/unit/handoff/interpret.test.ts`

#### Test: `interpretThen returns action: done for terminal`

**Purpose**: Terminal handoffs end the workflow.

**Setup**: `then: { done: true }`

**Expectation**: `result.action === 'done'`

---

#### Test: `interpretThen pass invokes target klados with outputs`

**Purpose**: Pass hands off outputs directly.

**Setup**: `then: { pass: 'next_klados' }`, 2 outputs.

**Expectation**:
- `result.action === 'pass'`
- Target invoked with outputs
- `result.handoffRecord` populated

---

#### Test: `interpretThen pass invokes target with route modifier`

**Purpose**: Routing can override default target.

**Setup**: Route rule matches, different target.

**Expectation**: `result.target` is the routed target, not default.

---

#### Test: `interpretThen pass discovers target type at runtime`

**Purpose**: Target type is detected by fetching entity.

**Setup**: Target is a rhiza (sub-workflow).

**Expectation**: `result.target_type === 'rhiza'`

---

#### Test: `interpretThen scatter creates batch and invokes target for each output`

**Purpose**: Fan-out operation.

**Setup**: `then: { scatter: 'worker' }`, 3 outputs.

**Expectation**:
- `result.action === 'scatter'`
- `result.batch.id` is defined
- `result.invocations.length === 3`

---

#### Test: `interpretThen gather updates batch slot`

**Purpose**: Gather operation updates batch state.

**Setup**: `then: { gather: 'aggregator' }`, batch context present.

**Expectation**: Slot is updated in batch entity.

---

#### Test: `interpretThen gather triggers gather target when last`

**Purpose**: Last slot completion triggers aggregation.

**Setup**: Complete final slot.

**Expectation**:
- `result.action === 'gather_trigger'`
- Aggregator is invoked with all outputs

---

#### Test: `interpretThen gather returns gather_wait when not last`

**Purpose**: Non-final slots just wait.

**Setup**: Complete non-final slot.

**Expectation**: `result.action === 'gather_wait'`

---

## Phase 4: Unit Tests - Resume Module

### 4.1 Log Chain Traversal Tests

**File**: `src/__tests__/unit/traverse.test.ts`

#### Test: `findLeaves finds terminal nodes (no children)`

**Purpose**: Identify where execution stopped.

**Setup**: Log chain with 3 leaves (2 done, 1 error).

**Expectation**: Returns all 3 leaf entries.

---

#### Test: `findLeaves returns empty for empty log chain`

**Purpose**: Edge case handling.

**Setup**: Empty logs array.

**Expectation**: Returns empty array.

---

#### Test: `findLeaves handles single-node chain`

**Purpose**: Single klados workflow.

**Setup**: One log entry (root is also leaf).

**Expectation**: Returns that single entry.

---

#### Test: `findErrorLeaves finds logs with status: error`

**Purpose**: Identify failed executions.

**Setup**: Chain with 1 error leaf among 3 total leaves.

**Expectation**: Returns only the error leaf.

---

#### Test: `findErrorLeaves marks retryable based on error.retryable`

**Purpose**: Distinguish retryable from permanent failures.

**Setup**: Error with `retryable: true`.

**Expectation**: `errorLeaf.retryable === true`

---

#### Test: `findErrorLeaves builds path from root to error`

**Purpose**: Provide context for debugging.

**Setup**: Error 3 levels deep.

**Expectation**: `errorLeaf.path` contains all klados IDs from root to error.

---

#### Test: `buildLogTree builds tree from root`

**Purpose**: Reconstruct execution structure.

**Setup**: Linear chain of 3 logs.

**Expectation**: Tree with depth 3, each node has one child.

---

#### Test: `buildLogTree handles scatter (multiple children)`

**Purpose**: Fan-out creates multiple children.

**Setup**: Root with 3 scattered children.

**Expectation**: Root node has 3 children.

---

#### Test: `buildLogTree returns null for empty logs`

**Purpose**: Edge case handling.

**Setup**: Empty logs array.

**Expectation**: Returns `null`.

---

### 4.2 Resume Tests

**File**: `src/__tests__/unit/resume.test.ts`

#### Test: `resumeWorkflow finds error leaves and re-invokes`

**Purpose**: Resume failed jobs.

**Setup**: 2 error leaves in chain.

**Expectation**:
- Both errors are re-invoked
- `result.resumed === 2`

---

#### Test: `resumeWorkflow uses original request with new job_id`

**Purpose**: Replay exact same request.

**Setup**: Error leaf with stored invocation request.

**Expectation**: New invocation uses same target, inputs; different job_id.

---

#### Test: `resumeWorkflow skips non-retryable errors`

**Purpose**: Don't retry permanent failures.

**Setup**: Error with `retryable: false`.

**Expectation**:
- Error is skipped
- `result.skipped === 1`

---

#### Test: `resumeWorkflow respects maxJobs limit`

**Purpose**: Control blast radius of resume.

**Setup**: 10 error leaves, `maxJobs: 3`.

**Expectation**: `result.resumed === 3`

---

#### Test: `resumeWorkflow filters by jobIds when provided`

**Purpose**: Selective resume.

**Setup**: 3 error leaves, specify 1 job ID.

**Expectation**: Only specified job is resumed.

---

#### Test: `resumeWorkflow returns summary of resumed jobs`

**Purpose**: Provide actionable information.

**Setup**: Resume 2 jobs.

**Expectation**: `result.jobs` contains details for each resumed job.

---

#### Test: `canResume returns true when retryable errors exist`

**Purpose**: Check if resume is possible.

**Setup**: 1 retryable error.

**Expectation**: `result.canResume === true`

---

#### Test: `canResume returns false when only non-retryable errors`

**Purpose**: Don't attempt futile resume.

**Setup**: Only non-retryable errors.

**Expectation**: `result.canResume === false`

---

#### Test: `canResume returns counts of each type`

**Purpose**: Provide visibility into error breakdown.

**Setup**: 2 retryable, 1 non-retryable.

**Expectation**:
- `result.retryableCount === 2`
- `result.nonRetryableCount === 1`

---

## Phase 5: Unit Tests - Status Module

**File**: `src/__tests__/unit/status.test.ts`

#### Test: `buildStatusFromLogs returns done when all leaves done`

**Purpose**: Detect successful completion.

**Setup**: All leaf logs have `status: 'done'`.

**Expectation**: `status.status === 'done'`

---

#### Test: `buildStatusFromLogs returns error when any leaf error`

**Purpose**: Error state propagates up.

**Setup**: 2 done leaves, 1 error leaf.

**Expectation**: `status.status === 'error'`

---

#### Test: `buildStatusFromLogs returns running when any leaf running`

**Purpose**: Active execution detection.

**Setup**: 1 running leaf.

**Expectation**: `status.status === 'running'`

---

#### Test: `buildStatusFromLogs calculates progress counters`

**Purpose**: Track overall progress.

**Setup**: 5 logs: 1 pending, 2 running, 1 done, 1 error.

**Expectation**:
- `progress.total === 5`
- `progress.pending === 1`
- `progress.running === 2`
- `progress.done === 1`
- `progress.error === 1`

---

#### Test: `buildStatusFromLogs identifies current kladoi`

**Purpose**: Show what's actively executing.

**Setup**: 2 running logs.

**Expectation**: `status.current_kladoi` contains both klados IDs.

---

#### Test: `buildStatusFromLogs collects error summaries`

**Purpose**: Aggregate error information.

**Setup**: 2 error leaves.

**Expectation**: `status.errors` contains summaries for both.

---

## Phase 6: Test Fixtures

### 6.1 Mock Kladoi

**File**: `src/__tests__/fixtures/kladoi/index.ts`

```typescript
export const mockKladoi = {
  producer: {
    id: 'II01klados_producer',
    properties: {
      label: 'Producer',
      endpoint: 'https://producer.test',
      actions_required: ['file:view'],
      accepts: { types: ['*'], cardinality: 'one' },
      produces: { types: ['item/*'], cardinality: 'many' },
      status: 'active',
    },
  },
  worker: {
    id: 'II01klados_worker',
    properties: {
      label: 'Worker',
      endpoint: 'https://worker.test',
      actions_required: ['file:view', 'entity:update'],
      accepts: { types: ['item/*'], cardinality: 'one' },
      produces: { types: ['result/*'], cardinality: 'one' },
      status: 'active',
    },
  },
  aggregator: {
    id: 'II01klados_aggregator',
    properties: {
      label: 'Aggregator',
      endpoint: 'https://aggregator.test',
      actions_required: ['file:create'],
      accepts: { types: ['result/*'], cardinality: 'many' },
      produces: { types: ['final/*'], cardinality: 'one' },
      status: 'active',
    },
  },
  inactive: {
    id: 'II01klados_inactive',
    properties: {
      label: 'Inactive Klados',
      endpoint: 'https://inactive.test',
      actions_required: ['file:view'],
      accepts: { types: ['*'], cardinality: 'one' },
      produces: { types: ['*'], cardinality: 'one' },
      status: 'disabled',
    },
  },
};
```

### 6.2 Mock Rhizai

**File**: `src/__tests__/fixtures/rhizai/linear.ts`

```typescript
export const linearRhiza = {
  id: 'II01rhiza_linear',
  properties: {
    label: 'Linear Test',
    version: '1.0',
    entry: 'II01klados_a',
    flow: {
      'II01klados_a': { then: { pass: 'II01klados_b' } },
      'II01klados_b': { then: { done: true } },
    },
    status: 'active',
  },
};
```

**File**: `src/__tests__/fixtures/rhizai/scatter-gather.ts`

```typescript
export const scatterGatherRhiza = {
  id: 'II01rhiza_scatter',
  properties: {
    label: 'Scatter Gather Test',
    version: '1.0',
    entry: 'II01klados_producer',
    flow: {
      'II01klados_producer': { then: { scatter: 'II01klados_worker' } },
      'II01klados_worker': { then: { gather: 'II01klados_aggregator' } },
      'II01klados_aggregator': { then: { done: true } },
    },
    status: 'active',
  },
};
```

### 6.3 Mock Logs

**File**: `src/__tests__/fixtures/logs/partial-error.ts`

```typescript
export const partialErrorLogs: KladosLogEntry[] = [
  {
    id: 'log-root',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_test',
    klados_id: 'II01klados_producer',
    job_id: 'job-1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target: 'entity-1' },
    produced: { entity_ids: ['item-1', 'item-2', 'item-3'] },
    handoffs: [{
      type: 'scatter',
      target: 'II01klados_worker',
      target_type: 'klados',
      batch_id: 'batch-1',
      invocations: [
        { request: { job_id: 'job-2', target: 'item-1', /* ... */ }, batch_index: 0 },
        { request: { job_id: 'job-3', target: 'item-2', /* ... */ }, batch_index: 1 },
        { request: { job_id: 'job-4', target: 'item-3', /* ... */ }, batch_index: 2 },
      ],
    }],
  },
  {
    id: 'log-worker-0',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_test',
    klados_id: 'II01klados_worker',
    job_id: 'job-2',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:00Z',
    received: { target: 'item-1', from_logs: ['log-root'], batch: { id: 'batch-1', index: 0, total: 3 } },
    produced: { entity_ids: ['result-1'] },
  },
  {
    id: 'log-worker-1',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_test',
    klados_id: 'II01klados_worker',
    job_id: 'job-3',
    status: 'error',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:01:30Z',
    received: {
      target: 'item-2',
      from_logs: ['log-root'],
      batch: { id: 'batch-1', index: 1, total: 3 },
      invocation: {
        request: { job_id: 'job-3', target: 'item-2', /* full request for replay */ },
        batch_index: 1,
      },
    },
    error: { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true },
  },
  {
    id: 'log-worker-2',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_test',
    klados_id: 'II01klados_worker',
    job_id: 'job-4',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:00Z',
    received: { target: 'item-3', from_logs: ['log-root'], batch: { id: 'batch-1', index: 2, total: 3 } },
    produced: { entity_ids: ['result-3'] },
  },
];
```

---

## Implementation Order

### Week 1: Foundation

1. **Day 1-2**: Set up test infrastructure
   - Create directory structure
   - Implement mock client
   - Set up vitest configuration

2. **Day 3-4**: Klados validation
   - Write all klados validation tests
   - Implement `validateKladosProperties()`
   - Achieve 100% test pass rate

3. **Day 5**: Rhiza validation (structure)
   - Write structure validation tests
   - Implement `validateRhizaProperties()`

### Week 2: Validation & Routing

4. **Day 1-2**: Rhiza validation (complete)
   - Write route rule validation tests
   - Implement cycle detection, reachability analysis
   - All rhiza validation tests pass

5. **Day 3-4**: Runtime validation
   - Write runtime validation tests
   - Implement `validateRhizaRuntime()`
   - All runtime tests pass

6. **Day 5**: Route matching
   - Write route tests (AND/OR/nested)
   - Implement `evaluateWhere()`, `matchRoute()`

### Week 3: Handoff Logic

7. **Day 1-2**: Target discovery
   - Write target tests
   - Implement `resolveTarget()`, `discoverTargetType()`

8. **Day 3-4**: Scatter/Gather
   - Write scatter tests
   - Write gather tests
   - Implement scatter/gather functions

9. **Day 5**: Handoff interpretation
   - Write interpret tests
   - Implement `interpretThen()`

### Week 4: Resume & Status

10. **Day 1-2**: Log chain traversal
    - Write traverse tests
    - Implement traversal functions

11. **Day 3-4**: Resume
    - Write resume tests
    - Implement `findErrorLeaves()`, `resumeWorkflow()`

12. **Day 5**: Status
    - Write status tests
    - Implement `buildStatusFromLogs()`

---

## Success Criteria

### Unit Tests (Phase 1)
- All 70+ unit tests passing
- 100% code coverage on validation module
- >90% code coverage on handoff module
- >90% code coverage on resume module

### Quality Standards
- Each test has clear purpose documentation
- Each test verifies a single behavior
- Tests are independent and can run in any order
- Mock client supports all required operations
- Fixtures cover normal and edge cases
