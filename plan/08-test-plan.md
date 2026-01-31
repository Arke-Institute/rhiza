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

#### 1.1 Klados Validation (Pure - no mocks needed)

```typescript
// src/__tests__/unit/validation/klados.test.ts

describe('validateKladosProperties', () => {
  it('passes for valid klados properties');
  it('fails when endpoint is missing');
  it('fails when endpoint is invalid URL');
  it('fails when accepts.types is empty');
  it('fails when produces.types is empty');
  it('fails when cardinality is invalid');
  it('fails when actions_required is empty');
  it('warns but passes for valid with wildcard types ["*"]');
});
```

#### 1.2 Rhiza Validation (Pure - no mocks needed)

```typescript
// src/__tests__/unit/validation/rhiza.test.ts

describe('validateRhizaProperties', () => {
  describe('structure validation', () => {
    it('passes for valid linear flow');
    it('passes for valid scatter-gather flow');
    it('passes for valid conditional flow');
    it('fails when entry klados ID is missing');
    it('fails when entry klados ID is not in flow');
    it('fails when target klados ID does not exist in flow');
    it('fails when no terminal step exists');
    it('fails when cycle detected');
    it('warns about unreachable klados IDs');
  });

  describe('handoff validation', () => {
    it('fails when then spec is missing');
    it('fails when then has unknown handoff type');
    it('fails when route has no rules');
    it('fails when route rule is missing where or then');
  });
});
```

#### 1.3 Runtime Validation (Mock client)

```typescript
// src/__tests__/unit/validation/runtime.test.ts

describe('validateRhizaRuntime', () => {
  it('passes when all kladoi exist and are active');
  it('fails when klados not found');
  it('fails when klados is not active');
  it('fails when scatter klados produces one');
  it('fails when scatter target accepts many');
  it('fails when gather target accepts one');
  it('warns about cardinality mismatch in pass');
  it('warns about type mismatch');
  it('returns loaded kladoi map on success');
});
```

#### 1.4 Route Matching (Pure - no mocks needed)

```typescript
// src/__tests__/unit/route.test.ts

describe('evaluateWhere', () => {
  it('matches string equality');
  it('matches number equality');
  it('matches boolean equality');
  it('returns false on mismatch');
  it('handles nested property paths (e.g., "metadata.format")');
  it('returns false for missing property');
});

describe('matchRoute', () => {
  // Needs mock client for entity fetch
  it('returns first matching rule');
  it('returns null when no rules match');
  it('checks rules in order (first wins)');
});
```

#### 1.5 Scatter Logic (Partial mock)

```typescript
// src/__tests__/unit/scatter.test.ts

describe('findGatherTarget', () => {
  // Pure - no mock needed
  it('finds gather target from scatter klados flow step');
  it('throws when scatter target has no gather');
});

describe('createScatter', () => {
  // Needs mock client
  it('creates batch entity with correct properties');
  it('invokes target klados once per output');
  it('passes batch context to each invocation');
  it('returns all invocation records');
  it('handles empty outputs array');
  it('respects concurrency limit');
});
```

#### 1.6 Gather Logic (Mock client)

```typescript
// src/__tests__/unit/gather.test.ts

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

#### 1.7 Handoff Interpretation (Mock client)

```typescript
// src/__tests__/unit/interpret.test.ts

describe('interpretThen', () => {
  describe('done', () => {
    it('returns action: done for terminal');
    it('handles sub-rhiza completion callback');
  });

  describe('pass', () => {
    it('invokes target klados with outputs');
    it('returns handoff record');
  });

  describe('scatter', () => {
    it('creates batch and invokes target for each output');
    it('returns batch ID and invocations');
  });

  describe('gather', () => {
    it('updates batch slot');
    it('triggers gather target when last');
    it('returns gather_wait when not last');
  });

  describe('rhiza', () => {
    it('invokes sub-rhiza');
    it('passes parent context for callback');
  });

  describe('route', () => {
    it('matches and follows route rule');
    it('throws when no route matches');
  });
});
```

#### 1.8 Log Chain Traversal (Mock data)

```typescript
// src/__tests__/unit/traverse.test.ts

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

#### 1.9 Resume Logic (Mock client)

```typescript
// src/__tests__/unit/resume.test.ts

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

#### 1.10 Status Building (Mock data)

```typescript
// src/__tests__/unit/status.test.ts

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
  // Pre-loaded klados entities (GET /kladoi/:id returns these)
  kladoi?: Record<string, { properties: KladosProperties; cid: string }>;

  // Pre-loaded entities (GET /entities/:id returns these)
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
    kladoi: new Map(Object.entries(config.kladoi ?? {})),
    entities: new Map(Object.entries(config.entities ?? {})),
    created: [] as Array<{ type: string; properties: unknown }>,
    updated: [] as Array<{ id: string; properties: unknown }>,
    invoked: [] as Array<{ kladosId: string; request: unknown }>,
    updateAttempts: 0,
  };

  return {
    api: {
      GET: async (path, options) => {
        if (path.includes('/kladoi/')) {
          const id = options.params.path.id;
          const klados = state.kladoi.get(id);
          if (!klados) return { error: { message: 'Not found' } };
          return { data: { id, type: 'klados', ...klados } };
        }
        if (path.includes('/entities/')) {
          const id = options.params.path.id;
          const entity = state.entities.get(id);
          if (!entity) return { error: { message: 'Not found' } };
          return { data: { id, ...entity } };
        }
        // Handle tip requests
      },
      POST: async (path, options) => {
        if (path.includes('/kladoi/') && path.includes('/invoke')) {
          const kladosId = options.params.path.id;
          state.invoked.push({ kladosId, request: options.body });
          return { data: { accepted: true, job_id: options.body.job_id } };
        }
        if (path === '/entities') {
          state.created.push(options.body);
          return { data: { id: `mock_${Date.now()}`, ...options.body } };
        }
      },
      PUT: async (path, options) => {
        if (config.errors?.onUpdate && state.updateAttempts < config.errors.onUpdate) {
          state.updateAttempts++;
          throw new Error('409 Conflict');
        }
        const id = options.params.path.id;
        state.updated.push({ id, properties: options.body.properties });
        return { data: { id } };
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
// src/__tests__/fixtures/kladoi/index.ts

export const mockKladoi: Record<string, { properties: KladosProperties; cid: string }> = {
  'II01klados_producer': {
    properties: {
      label: 'Producer',
      endpoint: 'https://producer.test',
      actions_required: ['file:view'],
      accepts: { types: ['*'], cardinality: 'one' },
      produces: { types: ['item/*'], cardinality: 'many' },
      status: 'active',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
    cid: 'cid_producer',
  },
  'II01klados_worker': {
    properties: {
      label: 'Worker',
      endpoint: 'https://worker.test',
      actions_required: ['file:view', 'entity:update'],
      accepts: { types: ['item/*'], cardinality: 'one' },
      produces: { types: ['result/*'], cardinality: 'one' },
      status: 'active',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
    cid: 'cid_worker',
  },
  'II01klados_aggregator': {
    properties: {
      label: 'Aggregator',
      endpoint: 'https://aggregator.test',
      actions_required: ['file:create'],
      accepts: { types: ['result/*'], cardinality: 'many' },
      produces: { types: ['final/*'], cardinality: 'one' },
      status: 'active',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
    cid: 'cid_aggregator',
  },
};
```

```typescript
// src/__tests__/fixtures/rhizai/linear.ts

import { mockKladoi } from '../kladoi';

export const linearFlow = {
  'II01klados_a': { then: { pass: 'II01klados_b' } },
  'II01klados_b': { then: { done: true } },
};

export const linearRhizaProperties = {
  label: 'Linear Test',
  version: '1.0',
  entry: 'II01klados_a',
  flow: linearFlow,
  status: 'active' as const,
};
```

```typescript
// src/__tests__/fixtures/rhizai/scatter-gather.ts

export const scatterGatherFlow = {
  'II01klados_producer': { then: { scatter: 'II01klados_worker' } },
  'II01klados_worker': { then: { gather: 'II01klados_aggregator' } },
  'II01klados_aggregator': { then: { done: true } },
};

export const scatterGatherRhizaProperties = {
  label: 'Scatter Gather Test',
  version: '1.0',
  entry: 'II01klados_producer',
  flow: scatterGatherFlow,
  status: 'active' as const,
};
```

```typescript
// src/__tests__/fixtures/rhizai/invalid.ts

export const missingEntryRhiza = {
  label: 'Missing Entry',
  version: '1.0',
  entry: 'does_not_exist',
  flow: {
    'II01klados_a': { then: { done: true } },
  },
};

export const cycleRhiza = {
  label: 'Cycle',
  version: '1.0',
  entry: 'II01klados_a',
  flow: {
    'II01klados_a': { then: { pass: 'II01klados_b' } },
    'II01klados_b': { then: { pass: 'II01klados_a' } }, // Cycle!
  },
};

export const noTerminalRhiza = {
  label: 'No Terminal',
  version: '1.0',
  entry: 'II01klados_a',
  flow: {
    'II01klados_a': { then: { pass: 'II01klados_b' } },
    'II01klados_b': { then: { pass: 'II01klados_a' } },
  },
};
```

```typescript
// src/__tests__/fixtures/logs/partial-error.ts

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
        { job_id: 'job-2', target_entity: 'item-1', batch_index: 0, status: 'done', request: { /* ... */ } },
        { job_id: 'job-3', target_entity: 'item-2', batch_index: 1, status: 'error', request: { /* ... */ } },
        { job_id: 'job-4', target_entity: 'item-3', batch_index: 2, status: 'done', request: { /* ... */ } },
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
    received: { target: 'item-1', from_log: 'log-root', batch: { id: 'batch-1', index: 0, total: 3 } },
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
    received: { target: 'item-2', from_log: 'log-root', batch: { id: 'batch-1', index: 1, total: 3 } },
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

#### 2.1 Klados CRUD (API)

```typescript
// src/__tests__/integration/klados-crud.test.ts

describe('Klados CRUD', () => {
  it('creates a klados entity');
  it('gets a klados by ID');
  it('updates a klados');
  it('validates klados on create');
  it('validates klados on update');
  it('rejects activation of invalid klados');
  it('soft deletes a klados');
});
```

#### 2.2 Rhiza CRUD (API)

```typescript
// src/__tests__/integration/rhiza-crud.test.ts

describe('Rhiza CRUD', () => {
  it('creates a rhiza entity');
  it('gets a rhiza by ID');
  it('updates a rhiza');
  it('validates rhiza on create');
  it('validates rhiza on update');
  it('rejects activation of rhiza with invalid flow');
  it('soft deletes a rhiza');
});
```

#### 2.3 Klados Invocation (API)

```typescript
// src/__tests__/integration/klados-invoke.test.ts

describe('Klados Invocation', () => {
  it('invokes klados and returns job_id');
  it('grants permissions to klados');
  it('creates job collection for standalone invocation');
  it('uses provided job_collection when given');
  it('passes rhiza_context when provided');
  it('passes batch_context when provided');
  it('rejects invocation of inactive klados');
});
```

#### 2.4 Rhiza Invocation (API)

```typescript
// src/__tests__/integration/rhiza-invoke.test.ts

describe('Rhiza Invocation', () => {
  it('invokes rhiza and returns job_id');
  it('performs runtime validation of all kladoi');
  it('grants permissions to all workflow kladoi');
  it('creates job collection');
  it('invokes entry klados with rhiza context');
  it('rejects invocation of inactive rhiza');
  it('rejects when klados not found');
  it('rejects when klados not active');
});
```

#### 2.5 Batch Entity (API)

```typescript
// src/__tests__/integration/batch.test.ts

describe('Batch Entity', () => {
  it('creates batch entity in job collection');
  it('updates batch slots atomically');
  it('handles concurrent slot updates (CAS)');
  it('marks batch complete when all slots done');
  it('marks batch error when slot errors');
});
```

#### 2.6 Log Chain (API)

```typescript
// src/__tests__/integration/log-chain.test.ts

describe('Log Chain', () => {
  it('writes log entry to job collection');
  it('creates received_from relationship');
  it('updates log with handoff records');
  it('traverses log chain via relationships');
});
```

### Test Kladoi

For integration tests, we need simple test kladoi deployed:

```typescript
// Test klados: echo-klados
// Simply returns its input as output
// Writes a log entry
// Interprets "then" and hands off

// Test klados: error-klados
// Always fails with retryable error
// For testing resume

// Test klados: delay-klados
// Waits N seconds before completing
// For testing concurrent operations
```

---

## Phase 3: End-to-End Tests

### Goal
Full workflow execution with real kladoi.

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

describe('Sub-Workflow', () => {
  it('invokes sub-rhiza');
  it('sub-rhiza creates its own job collection');
  it('sub-rhiza calls back to parent on completion');
});

describe('Resume', () => {
  it('resumes after worker failure');
  it('continues from last successful point');
  it('completes workflow after resume');
});
```

### TBD (Later Phases)

- [ ] Batch with mixed success/error
- [ ] CAS retry under high concurrency
- [ ] Permission expiry handling
- [ ] Large batch (100+ items)
- [ ] Deep nesting (5+ levels)
- [ ] Multiple sub-rhizai in parallel

---

## Test File Organization

```
src/
├── __tests__/
│   ├── unit/                    # Phase 1: Mocks
│   │   ├── validation/
│   │   │   ├── klados.test.ts
│   │   │   ├── rhiza.test.ts
│   │   │   └── runtime.test.ts
│   │   ├── handoff/
│   │   │   ├── interpret.test.ts
│   │   │   ├── scatter.test.ts
│   │   │   ├── gather.test.ts
│   │   │   └── route.test.ts
│   │   ├── traverse.test.ts
│   │   ├── resume.test.ts
│   │   └── status.test.ts
│   │
│   ├── integration/             # Phase 2: Test Network
│   │   ├── setup.ts
│   │   ├── klados-crud.test.ts
│   │   ├── rhiza-crud.test.ts
│   │   ├── klados-invoke.test.ts
│   │   ├── rhiza-invoke.test.ts
│   │   ├── batch.test.ts
│   │   └── log-chain.test.ts
│   │
│   ├── e2e/                     # Phase 3: Full Workflows
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
│       │   └── index.ts
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
- [ ] Create fixture kladoi
- [ ] Create fixture rhizai (linear, scatter-gather, invalid)
- [ ] Create fixture logs (success, partial-error)

### Step 2: Klados validation tests + implementation
- [ ] Write klados validation tests
- [ ] Implement `validateKladosProperties()`
- [ ] All klados validation tests pass

### Step 3: Rhiza validation tests + implementation
- [ ] Write rhiza validation tests
- [ ] Implement `validateRhizaProperties()`
- [ ] All rhiza validation tests pass

### Step 4: Runtime validation tests + implementation
- [ ] Write runtime validation tests
- [ ] Implement `validateRhizaRuntime()`
- [ ] All runtime validation tests pass

### Step 5: Route tests + implementation
- [ ] Write route matching tests
- [ ] Implement `evaluateWhere()`, `matchRoute()`
- [ ] All route tests pass

### Step 6: Scatter/Gather tests + implementation
- [ ] Write scatter tests
- [ ] Write gather tests
- [ ] Implement `findGatherTarget()`, `createScatter()`, `completeBatchSlot()`
- [ ] All scatter/gather tests pass

### Step 7: Handoff interpretation tests + implementation
- [ ] Write interpret tests
- [ ] Implement `interpretThen()`
- [ ] All interpret tests pass

### Step 8: Log chain tests + implementation
- [ ] Write traverse tests
- [ ] Implement log chain functions
- [ ] All traverse tests pass

### Step 9: Resume tests + implementation
- [ ] Write resume tests
- [ ] Implement `findErrorLeaves()`, `resumeWorkflow()`
- [ ] All resume tests pass

### Step 10: Status tests + implementation
- [ ] Write status tests
- [ ] Implement `buildStatusFromLogs()`
- [ ] All status tests pass

### Step 11: API changes (parallel with above)
- [ ] Add klados profile to arke_v1
- [ ] Add rhiza profile to arke_v1
- [ ] Add /kladoi routes
- [ ] Add /rhizai routes
- [ ] Deploy to test environment

### Step 12: Integration tests
- [ ] Write integration tests
- [ ] Deploy test kladoi
- [ ] Run against test network
- [ ] All integration tests pass

### Step 13: E2E tests
- [ ] Write e2e tests
- [ ] Run full workflow tests
- [ ] All e2e tests pass

---

## Next: Start with Step 1

Create test infrastructure and fixtures.
