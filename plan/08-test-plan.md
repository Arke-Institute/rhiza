# Test Plan

## Overview

Test-driven development approach with three phases:
1. **Unit Tests (Mocks)** - Test logic in isolation
2. **Integration Tests (Test Network)** - Test with real Arke API
3. **End-to-End Tests** - Full workflow execution

---

## Phase 1: Unit Tests with Mocks

### Goal
Test pure logic and mock API interactions.

### What We Test

#### 1.1 Validation (Pure - no mocks needed)

```typescript
// src/__tests__/validation.test.ts

describe('validateRhiza', () => {
  describe('structure validation', () => {
    it('passes for valid linear workflow');
    it('passes for valid scatter-gather workflow');
    it('passes for valid conditional workflow');
    it('fails when entry klados is missing');
    it('fails when target klados does not exist');
    it('fails when no terminal klados exists');
    it('fails when cycle detected');
    it('warns about orphan kladoi (unreachable from entry)');
  });

  describe('cardinality validation', () => {
    it('fails when scatter klados produces one');
    it('fails when scatter target accepts many');
    it('fails when gather target accepts one');
    it('warns about cardinality mismatch in pass');
  });

  describe('type validation', () => {
    it('fails when accepts.types is empty');
    it('fails when produces.types is empty');
    it('warns about type mismatch between kladoi');
  });
});
```

#### 1.2 Route Matching (Pure - no mocks needed)

```typescript
// src/__tests__/route.test.ts

describe('evaluateWhere', () => {
  it('matches string equality');
  it('matches number equality');
  it('matches boolean equality');
  it('returns false on mismatch');
  it('handles nested property paths (e.g., "metadata.format")');
  it('returns false for missing property');
});

describe('matchRoute', () => {
  it('returns first matching rule');
  it('returns null when no rules match');
  it('checks rules in order (first wins)');
});
```

#### 1.3 Scatter Logic (Partial mock)

```typescript
// src/__tests__/scatter.test.ts

describe('findGatherTarget', () => {
  // Pure - no mock needed
  it('finds gather target from scatter klados');
  it('traces through multiple kladoi to find gather');
  it('throws when scatter target has no gather');
  it('returns empty string for sub-rhiza target');
});

describe('createScatter', () => {
  // Needs mock client
  it('creates batch entity with correct properties');
  it('invokes target once per output');
  it('passes batch context to each invocation');
  it('returns all invocation records');
  it('handles empty outputs array');
});
```

#### 1.4 Gather Logic (Mock client)

```typescript
// src/__tests__/gather.test.ts

describe('completeBatchSlot', () => {
  it('updates slot to complete');
  it('increments completed count');
  it('returns isLast: false when more slots pending');
  it('returns isLast: true when all slots complete');
  it('collects all outputs in slot order when last');
  it('retries on CAS conflict (409)');
  it('throws after max retries');
});

describe('errorBatchSlot', () => {
  it('marks slot as error');
  it('marks batch as error when all slots terminal');
});
```

#### 1.5 Log Chain Traversal (Mock data)

```typescript
// src/__tests__/traverse.test.ts

describe('findLeaves', () => {
  it('finds terminal nodes (no children)');
  it('returns empty for empty log chain');
  it('handles single-node chain');
});

describe('findErrorLeaves', () => {
  it('finds logs with status: error');
  it('marks retryable based on error.retryable');
  it('builds path from root to error');
});

describe('findStuckJobs', () => {
  it('finds invocations with no corresponding log');
  it('marks stuck jobs as retryable');
});

describe('buildLogTree', () => {
  it('builds tree from root');
  it('handles scatter (multiple children)');
  it('returns null for empty logs');
});
```

#### 1.6 Resume Logic (Mock client)

```typescript
// src/__tests__/resume.test.ts

describe('resumeWorkflow', () => {
  it('finds error leaves and re-invokes');
  it('uses original request with new job_id');
  it('updates parent invocation record');
  it('skips non-retryable errors');
  it('respects maxJobs limit');
  it('filters by jobIds when provided');
  it('returns summary of resumed jobs');
});

describe('canResume', () => {
  it('returns true when retryable errors exist');
  it('returns false when only non-retryable errors');
  it('returns counts of each type');
});
```

#### 1.7 Status Building (Mock data)

```typescript
// src/__tests__/status.test.ts

describe('buildStatusFromLogs', () => {
  it('returns done when all leaves done');
  it('returns error when any leaf error');
  it('returns running when any leaf running');
  it('calculates progress counters');
  it('identifies current kladoi (running ones)');
  it('collects error summaries');
});
```

### Mock Client Design

```typescript
// src/__tests__/fixtures/mock-client.ts

interface MockClientConfig {
  // Pre-loaded entities (GET returns these)
  entities?: Record<string, { properties: Record<string, unknown>; cid: string }>;

  // Batch state (for gather tests)
  batches?: Record<string, BatchProperties>;

  // Log entries (for traverse/resume tests)
  logs?: KladosLogEntry[];

  // Simulate errors
  errors?: {
    entity?: Record<string, Error>;  // Entity ID → error
    onUpdate?: number;  // Fail first N updates (for CAS retry tests)
  };
}

function createMockClient(config: MockClientConfig): MockArkeClient {
  const state = {
    entities: new Map(Object.entries(config.entities ?? {})),
    created: [] as Array<{ type: string; properties: unknown }>,
    updated: [] as Array<{ id: string; properties: unknown }>,
    invoked: [] as Array<{ agentId: string; request: unknown }>,
    updateAttempts: 0,
  };

  return {
    api: {
      GET: async (path, options) => {
        // Return from state.entities
      },
      POST: async (path, options) => {
        // Track in state.created or state.invoked
      },
      PUT: async (path, options) => {
        // Track in state.updated, handle CAS errors
      },
    },

    // Test helpers
    getCreated: () => state.created,
    getUpdated: () => state.updated,
    getInvoked: () => state.invoked,
  };
}
```

### Fixtures

```typescript
// src/__tests__/fixtures/rhizai/linear.ts
export const linearRhiza: Rhiza = {
  id: 'test-linear',
  name: 'Linear Test',
  version: '1.0',
  entry: 'step-a',
  kladoi: {
    'step-a': {
      action: 'agent-a',
      accepts: { types: ['*'], cardinality: 'one' },
      produces: { types: ['*'], cardinality: 'one' },
      then: { pass: 'step-b' },
    },
    'step-b': {
      action: 'agent-b',
      accepts: { types: ['*'], cardinality: 'one' },
      produces: { types: ['*'], cardinality: 'one' },
      then: { done: true },
    },
  },
};

// src/__tests__/fixtures/rhizai/scatter-gather.ts
export const scatterGatherRhiza: Rhiza = {
  id: 'test-scatter-gather',
  name: 'Scatter Gather Test',
  version: '1.0',
  entry: 'producer',
  kladoi: {
    'producer': {
      action: 'agent-producer',
      accepts: { types: ['*'], cardinality: 'one' },
      produces: { types: ['item/*'], cardinality: 'many' },
      then: { scatter: 'worker' },
    },
    'worker': {
      action: 'agent-worker',
      accepts: { types: ['item/*'], cardinality: 'one' },
      produces: { types: ['result/*'], cardinality: 'one' },
      then: { gather: 'aggregator' },
    },
    'aggregator': {
      action: 'agent-aggregator',
      accepts: { types: ['result/*'], cardinality: 'many' },
      produces: { types: ['final/*'], cardinality: 'one' },
      then: { done: true },
    },
  },
};

// src/__tests__/fixtures/rhizai/invalid.ts
export const missingEntryRhiza: Rhiza = {
  id: 'test-missing-entry',
  name: 'Missing Entry',
  version: '1.0',
  entry: 'does-not-exist',
  kladoi: {
    'step-a': { /* ... */ },
  },
};

// src/__tests__/fixtures/logs/partial-error.ts
export const partialErrorLogs: KladosLogEntry[] = [
  {
    id: 'log-root',
    type: 'klados_log',
    rhiza_id: 'test-rhiza',
    klados: 'producer',
    job_id: 'job-1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target: 'entity-1' },
    produced: { entity_ids: ['item-1', 'item-2', 'item-3'] },
    handoffs: [{
      type: 'scatter',
      target: 'worker',
      target_type: 'klados',
      batch_id: 'batch-1',
      invocations: [
        { job_id: 'job-2', target_entity: 'item-1', batch_index: 0, status: 'done', request: { /* ... */ } },
        { job_id: 'job-3', target_entity: 'item-2', batch_index: 1, status: 'error', request: { /* ... */ } },
        { job_id: 'job-4', target_entity: 'item-3', batch_index: 2, status: 'done', request: { /* ... */ } },
      ],
    }],
  },
  {
    id: 'log-worker-0',
    type: 'klados_log',
    rhiza_id: 'test-rhiza',
    klados: 'worker',
    job_id: 'job-2',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:00Z',
    received: { target: 'item-1', from_log: 'log-root', batch: { id: 'batch-1', index: 0, total: 3 } },
    produced: { entity_ids: ['result-1'] },
  },
  {
    id: 'log-worker-1',
    type: 'klados_log',
    rhiza_id: 'test-rhiza',
    klados: 'worker',
    job_id: 'job-3',
    status: 'error',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:01:30Z',
    received: { target: 'item-2', from_log: 'log-root', batch: { id: 'batch-1', index: 1, total: 3 } },
    error: { code: 'PROCESSING_FAILED', message: 'Timeout', retryable: true },
  },
  {
    id: 'log-worker-2',
    type: 'klados_log',
    rhiza_id: 'test-rhiza',
    klados: 'worker',
    job_id: 'job-4',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:00Z',
    received: { target: 'item-3', from_log: 'log-root', batch: { id: 'batch-1', index: 2, total: 3 } },
    produced: { entity_ids: ['result-3'] },
  },
];
```

---

## Phase 2: Integration Tests (Test Network)

### Goal
Test with real Arke API on test network. Requires:
1. rhiza package core complete
2. arke_v1 changes deployed to test

### Prerequisites

```typescript
// src/__tests__/integration/setup.ts

// Requires ARKE_TEST_API_KEY environment variable
const client = new ArkeClient({
  apiKey: process.env.ARKE_TEST_API_KEY!,
  baseUrl: 'https://arke-v1-test.arke.institute',
  headers: { 'X-Arke-Network': 'test' },
});

// Test collection for fixtures
let testCollection: string;

beforeAll(async () => {
  testCollection = await createTestCollection(client, 'rhiza-integration-tests');
});

afterAll(async () => {
  // Cleanup (test network auto-expires after 30 days anyway)
});
```

### What We Test

#### 2.1 Rhiza CRUD (API)

```typescript
// src/__tests__/integration/rhiza-crud.test.ts

describe('Rhiza CRUD', () => {
  it('creates a rhiza entity');
  it('gets a rhiza by ID');
  it('updates a rhiza');
  it('validates rhiza on create');
  it('validates rhiza on update');
  it('rejects activation of invalid rhiza');
});
```

#### 2.2 Batch Entity (API)

```typescript
// src/__tests__/integration/batch.test.ts

describe('Batch Entity', () => {
  it('creates batch entity in job collection');
  it('updates batch slots atomically');
  it('handles concurrent slot updates (CAS)');
  it('marks batch complete when all slots done');
});
```

#### 2.3 Log Chain (API)

```typescript
// src/__tests__/integration/log-chain.test.ts

describe('Log Chain', () => {
  it('writes log entry to job collection');
  it('creates received_from relationship');
  it('updates log with handoff records');
  it('traverses log chain via relationships');
});
```

#### 2.4 Simple Workflow Invocation (API + Test Agents)

```typescript
// src/__tests__/integration/invoke.test.ts

describe('Workflow Invocation', () => {
  // Requires test agents deployed
  it('invokes rhiza and returns job_id');
  it('grants permissions to all workflow agents');
  it('creates job collection');
  it('entry agent receives RhizaContext');
});
```

### Test Agents

For integration tests, we need simple test agents:

```typescript
// Test agent: echo-agent
// Simply returns its input as output
// Writes a log entry
// Interprets "then" and hands off

// Test agent: error-agent
// Always fails with retryable error
// For testing resume

// Test agent: delay-agent
// Waits N seconds before completing
// For testing concurrent operations
```

These can be deployed to test environment as part of the test setup.

---

## Phase 3: End-to-End Tests

### Goal
Full workflow execution with real agents.

### What We Test

```typescript
// src/__tests__/e2e/workflows.test.ts

describe('Linear Workflow', () => {
  it('executes A → B → C to completion');
  it('status shows done when complete');
  it('log chain is traversable');
});

describe('Scatter-Gather Workflow', () => {
  it('scatters to N workers');
  it('each worker updates batch slot');
  it('last worker triggers gather');
  it('aggregator receives all outputs');
});

describe('Conditional Workflow', () => {
  it('routes PDF to pdf-handler');
  it('routes image to image-handler');
  it('routes text to text-handler');
});

describe('Resume', () => {
  it('resumes after worker failure');
  it('continues from last successful point');
  it('completes workflow after resume');
});
```

### TBD (Later Phases)

- [ ] Nested rhiza (sub-workflow invocation)
- [ ] Batch with mixed success/error
- [ ] CAS retry under high concurrency
- [ ] Permission expiry handling
- [ ] Large batch (100+ items)
- [ ] Deep nesting (5+ levels)

---

## Test File Organization

```
src/
├── __tests__/
│   ├── unit/                    # Phase 1: Mocks
│   │   ├── validation.test.ts
│   │   ├── route.test.ts
│   │   ├── scatter.test.ts
│   │   ├── gather.test.ts
│   │   ├── traverse.test.ts
│   │   ├── resume.test.ts
│   │   └── status.test.ts
│   │
│   ├── integration/             # Phase 2: Test Network
│   │   ├── setup.ts
│   │   ├── rhiza-crud.test.ts
│   │   ├── batch.test.ts
│   │   ├── log-chain.test.ts
│   │   └── invoke.test.ts
│   │
│   ├── e2e/                     # Phase 3: Full Workflows
│   │   ├── setup.ts
│   │   ├── linear.test.ts
│   │   ├── scatter-gather.test.ts
│   │   ├── conditional.test.ts
│   │   └── resume.test.ts
│   │
│   └── fixtures/
│       ├── mock-client.ts
│       ├── rhizai/
│       │   ├── linear.ts
│       │   ├── scatter-gather.ts
│       │   ├── conditional.ts
│       │   └── invalid.ts
│       └── logs/
│           ├── success.ts
│           ├── partial-error.ts
│           └── stuck.ts
```

---

## NPM Scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run src/__tests__/unit",
    "test:integration": "vitest run src/__tests__/integration",
    "test:e2e": "vitest run src/__tests__/e2e",
    "test:watch": "vitest"
  }
}
```

---

## Implementation Order

### Step 1: Set up test infrastructure
- [ ] Create test directory structure
- [ ] Create mock client
- [ ] Create fixture rhizai (linear, scatter-gather, invalid)
- [ ] Create fixture logs (success, partial-error)

### Step 2: Validation tests + implementation
- [ ] Write validation tests
- [ ] Implement `validateRhiza()`
- [ ] All validation tests pass

### Step 3: Route tests + implementation
- [ ] Write route matching tests
- [ ] Implement `evaluateWhere()`, `matchRoute()`
- [ ] All route tests pass

### Step 4: Scatter/Gather tests + implementation
- [ ] Write scatter tests
- [ ] Write gather tests
- [ ] Implement `findGatherTarget()`, `createScatter()`, `completeBatchSlot()`
- [ ] All scatter/gather tests pass

### Step 5: Log chain tests + implementation
- [ ] Write traverse tests
- [ ] Implement log chain functions
- [ ] All traverse tests pass

### Step 6: Resume tests + implementation
- [ ] Write resume tests
- [ ] Implement `findErrorLeaves()`, `resumeWorkflow()`
- [ ] All resume tests pass

### Step 7: Status tests + implementation
- [ ] Write status tests
- [ ] Implement `buildStatusFromLogs()`
- [ ] All status tests pass

### Step 8: API changes (parallel with above)
- [ ] Add rhiza profile to arke_v1
- [ ] Add /rhizai routes
- [ ] Deploy to test environment

### Step 9: Integration tests
- [ ] Write integration tests
- [ ] Run against test network
- [ ] All integration tests pass

### Step 10: E2E tests
- [ ] Deploy test agents
- [ ] Write e2e tests
- [ ] Run full workflow tests
- [ ] All e2e tests pass

---

## Next: Start with Step 1

Create test infrastructure and fixtures.
