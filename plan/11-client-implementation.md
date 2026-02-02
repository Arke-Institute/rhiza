# Client Implementation Plan

This document outlines the plan for integrating the Arke SDK into the rhiza library.

## Approach: Consumer-Driven Contract

We implement the client first to define exactly what we need from the API. This becomes the specification for what `arke_v1` must implement.

1. **Define the interface** - What operations rhiza needs
2. **Implement with mocks** - Simulate expected API behavior
3. **Document contracts** - Exact request/response formats
4. **Hand off to API team** - They implement to our spec

---

## Current API State

### Already Implemented (from ops-reference)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/entities` | POST | Create generic entity |
| `/entities/batch` | POST | Bulk entity creation |
| `/entities/{id}` | GET | Retrieve entity manifest |
| `/entities/{id}` | PUT | Modify entity properties |
| `/entities/{id}/tip` | GET | Fetch current CID only |
| `/agents/{id}/invoke` | POST | Execute agent task |
| `/agents/{id}/verify` | POST | Verify endpoint ownership |

### Needed for Klados/Rhiza

| Endpoint | Method | Description | Notes |
|----------|--------|-------------|-------|
| `/kladoi` | POST | Create klados | With validation |
| `/kladoi/{id}` | PUT | Update klados | With validation, re-verify on endpoint change |
| `/kladoi/{id}/invoke` | POST | Invoke klados | Same pattern as agents/invoke |
| `/kladoi/{id}/verify` | POST | Verify endpoint | Same as agents/verify |
| `/rhizai` | POST | Create rhiza | With static validation |
| `/rhizai/{id}` | PUT | Update rhiza | With validation |
| `/rhizai/{id}/invoke` | POST | Invoke workflow | Runtime validation + grant permissions |
| `/rhizai/{id}/jobs/{job_id}/status` | GET | Workflow status | Uses rhiza.buildStatusFromLogs |
| `/rhizai/{id}/jobs/{job_id}/resume` | POST | Resume workflow | Uses rhiza.resumeWorkflow |

### Can Reuse Generic Endpoints

| Use Case | Endpoint | Notes |
|----------|----------|-------|
| Get klados/rhiza | `GET /entities/{id}` | Works for any entity type |
| Get tip for CAS | `GET /entities/{id}/tip` | Standard CAS pattern |
| Create logs | `POST /entities` | type: 'klados_log' |
| Update logs | `PUT /entities/{id}` | Add handoffs, change status |
| Create batches | `POST /entities` | type: 'batch' |
| Update batches | `PUT /entities/{id}` | Complete/error slots |

---

## Rhiza Client Architecture

### Design Goals

1. **Use the SDK**: Wrap `@arke-institute/sdk` for type-safe API calls
2. **Higher-level methods**: Provide rhiza-specific operations
3. **Testable**: Same interface works with mock client for unit tests
4. **Portable**: Works in any JS runtime (Node, CF Workers, etc.)

### Client Interface

```typescript
// src/client/interface.ts

import type { KladosEntity, RhizaEntity, KladosLogEntry, BatchEntity } from '../types';

/**
 * Abstract interface for Arke API operations needed by rhiza.
 * Both the real SDK client and mock client implement this.
 */
export interface RhizaApiClient {
  // =========================================================================
  // Entity Operations (use generic /entities endpoints)
  // =========================================================================

  /** Get any entity by ID */
  getEntity<T = unknown>(id: string): Promise<{ data?: T; error?: ApiError }>;

  /** Get entity tip (CID) for CAS updates */
  getEntityTip(id: string): Promise<{ data?: { cid: string }; error?: ApiError }>;

  /** Create an entity */
  createEntity(params: CreateEntityParams): Promise<{ data?: EntityResponse; error?: ApiError }>;

  /** Update an entity */
  updateEntity(id: string, params: UpdateEntityParams): Promise<{ data?: EntityResponse; error?: ApiError }>;

  // =========================================================================
  // Klados Operations (use /kladoi endpoints)
  // =========================================================================

  /** Get klados entity with type checking */
  getKlados(id: string): Promise<{ data?: KladosEntity; error?: ApiError }>;

  /** Create klados (with validation) */
  createKlados(params: CreateKladosParams): Promise<{ data?: KladosEntity; error?: ApiError }>;

  /** Update klados (with validation) */
  updateKlados(id: string, params: UpdateKladosParams): Promise<{ data?: KladosEntity; error?: ApiError }>;

  /** Invoke klados (standalone or workflow context) */
  invokeKlados(id: string, params: InvokeKladosParams): Promise<{ data?: InvokeResponse; error?: ApiError }>;

  // =========================================================================
  // Rhiza Operations (use /rhizai endpoints)
  // =========================================================================

  /** Get rhiza entity with type checking */
  getRhiza(id: string): Promise<{ data?: RhizaEntity; error?: ApiError }>;

  /** Create rhiza (with static validation) */
  createRhiza(params: CreateRhizaParams): Promise<{ data?: RhizaEntity; error?: ApiError }>;

  /** Update rhiza (with validation) */
  updateRhiza(id: string, params: UpdateRhizaParams): Promise<{ data?: RhizaEntity; error?: ApiError }>;

  /** Invoke rhiza workflow */
  invokeRhiza(id: string, params: InvokeRhizaParams): Promise<{ data?: InvokeResponse; error?: ApiError }>;

  /** Get workflow status */
  getWorkflowStatus(rhizaId: string, jobId: string): Promise<{ data?: WorkflowStatus; error?: ApiError }>;

  /** Resume failed workflow */
  resumeWorkflow(rhizaId: string, jobId: string, params?: ResumeParams): Promise<{ data?: ResumeResult; error?: ApiError }>;

  // =========================================================================
  // Log Operations (use generic /entities for creation/update)
  // =========================================================================

  /** Create a klados log entry */
  createLog(params: CreateLogParams): Promise<{ data?: KladosLogEntry; error?: ApiError }>;

  /** Update a log entry (add handoffs, change status) */
  updateLog(id: string, params: UpdateLogParams): Promise<{ data?: KladosLogEntry; error?: ApiError }>;

  /** Get logs for a job (by job_collection) */
  getJobLogs(jobCollectionId: string): Promise<{ data?: KladosLogEntry[]; error?: ApiError }>;

  // =========================================================================
  // Batch Operations (for scatter/gather)
  // =========================================================================

  /** Create a scatter batch entity */
  createBatch(params: CreateBatchParams): Promise<{ data?: BatchEntity; error?: ApiError }>;

  /** Update batch (complete/error slots) */
  updateBatch(id: string, params: UpdateBatchParams): Promise<{ data?: BatchEntity; error?: ApiError }>;
}
```

### SDK Client Implementation

```typescript
// src/client/sdk-client.ts

import { ArkeClient, type ArkeClientConfig } from '@arke-institute/sdk';
import type { RhizaApiClient } from './interface';

/**
 * Real Arke SDK client implementation.
 * Wraps the SDK to provide rhiza-specific operations.
 */
export class RhizaSdkClient implements RhizaApiClient {
  private client: ArkeClient;

  constructor(config: ArkeClientConfig) {
    this.client = new ArkeClient(config);
  }

  // =========================================================================
  // Entity Operations
  // =========================================================================

  async getEntity<T>(id: string) {
    const { data, error } = await this.client.api.GET('/entities/{id}', {
      params: { path: { id } },
    });
    return { data: data as T | undefined, error: this.mapError(error) };
  }

  async getEntityTip(id: string) {
    const { data, error } = await this.client.api.GET('/entities/{id}/tip', {
      params: { path: { id } },
    });
    return { data, error: this.mapError(error) };
  }

  async createEntity(params: CreateEntityParams) {
    const { data, error } = await this.client.api.POST('/entities', {
      body: {
        collection_id: params.collectionId,
        type: params.type,
        properties: params.properties,
        relationships_add: params.relationships,
      },
    });
    return { data, error: this.mapError(error) };
  }

  async updateEntity(id: string, params: UpdateEntityParams) {
    const { data, error } = await this.client.api.PUT('/entities/{id}', {
      params: { path: { id } },
      body: {
        expect_tip: params.expectTip,
        properties: params.properties,
        relationships_add: params.relationshipsAdd,
      },
    });
    return { data, error: this.mapError(error) };
  }

  // =========================================================================
  // Klados Operations
  // =========================================================================

  async getKlados(id: string) {
    // Uses /entities/{id} since /kladoi/{id} may not exist yet
    // Once API is updated, switch to /kladoi/{id}
    const { data, error } = await this.getEntity<KladosEntity>(id);
    if (data && data.type !== 'klados') {
      return { error: { message: `Entity ${id} is not a klados`, code: 'TYPE_MISMATCH' } };
    }
    return { data, error };
  }

  async createKlados(params: CreateKladosParams) {
    // Once /kladoi POST is implemented, use that for server-side validation
    // For now, validate locally and use /entities
    const validation = validateKladosProperties(params.properties);
    if (!validation.valid) {
      return { error: { message: validation.errors[0].message, code: 'VALIDATION_ERROR' } };
    }

    return this.createEntity({
      collectionId: params.collectionId,
      type: 'klados',
      properties: params.properties,
    });
  }

  async invokeKlados(id: string, params: InvokeKladosParams) {
    // This endpoint needs to be added to arke_v1
    // Pattern matches /agents/{id}/invoke
    const { data, error } = await this.client.api.POST('/kladoi/{id}/invoke' as any, {
      params: { path: { id } },
      body: {
        target: params.target,
        input: params.input,
        job_collection: params.jobCollection,
        rhiza_context: params.rhizaContext,
        confirm: params.confirm,
        expires_in: params.expiresIn,
      },
    });
    return { data, error: this.mapError(error) };
  }

  // =========================================================================
  // Rhiza Operations
  // =========================================================================

  async getRhiza(id: string) {
    const { data, error } = await this.getEntity<RhizaEntity>(id);
    if (data && data.type !== 'rhiza') {
      return { error: { message: `Entity ${id} is not a rhiza`, code: 'TYPE_MISMATCH' } };
    }
    return { data, error };
  }

  async invokeRhiza(id: string, params: InvokeRhizaParams) {
    // This endpoint needs to be added to arke_v1
    const { data, error } = await this.client.api.POST('/rhizai/{id}/invoke' as any, {
      params: { path: { id } },
      body: {
        target: params.target,
        input: params.input,
        confirm: params.confirm,
        expires_in: params.expiresIn,
      },
    });
    return { data, error: this.mapError(error) };
  }

  async getWorkflowStatus(rhizaId: string, jobId: string) {
    const { data, error } = await this.client.api.GET('/rhizai/{id}/jobs/{job_id}/status' as any, {
      params: { path: { id: rhizaId, job_id: jobId } },
    });
    return { data, error: this.mapError(error) };
  }

  async resumeWorkflow(rhizaId: string, jobId: string, params?: ResumeParams) {
    const { data, error } = await this.client.api.POST('/rhizai/{id}/jobs/{job_id}/resume' as any, {
      params: { path: { id: rhizaId, job_id: jobId } },
      body: params,
    });
    return { data, error: this.mapError(error) };
  }

  // =========================================================================
  // Log Operations
  // =========================================================================

  async createLog(params: CreateLogParams) {
    return this.createEntity({
      collectionId: params.jobCollectionId,
      type: 'klados_log',
      properties: {
        klados_id: params.kladosId,
        rhiza_id: params.rhizaId,
        job_id: params.jobId,
        status: 'running',
        started_at: new Date().toISOString(),
        received: params.received,
      },
      relationships: params.parentLogIds?.map(parentId => ({
        predicate: 'received_from',
        peer: parentId,
      })),
    });
  }

  async updateLog(id: string, params: UpdateLogParams) {
    const { data: tipData } = await this.getEntityTip(id);
    if (!tipData) {
      return { error: { message: 'Log not found', code: 'NOT_FOUND' } };
    }

    return this.updateEntity(id, {
      expectTip: tipData.cid,
      properties: {
        ...(params.status && { status: params.status }),
        ...(params.completedAt && { completed_at: params.completedAt }),
        ...(params.produced && { produced: params.produced }),
        ...(params.error && { error: params.error }),
        ...(params.handoffs && { handoffs: params.handoffs }),
      },
    });
  }

  async getJobLogs(jobCollectionId: string) {
    // Query entities in collection with type: klados_log
    const { data, error } = await this.client.api.GET('/collections/{id}/entities' as any, {
      params: {
        path: { id: jobCollectionId },
        query: { type: 'klados_log' },
      },
    });
    return { data: data?.items as KladosLogEntry[] | undefined, error: this.mapError(error) };
  }

  // =========================================================================
  // Batch Operations
  // =========================================================================

  async createBatch(params: CreateBatchParams) {
    return this.createEntity({
      collectionId: params.jobCollectionId,
      type: 'batch',
      properties: {
        scatter_from: params.scatterFrom,
        gather_target: params.gatherTarget,
        total_slots: params.totalSlots,
        completed_slots: 0,
        status: 'pending',
        slots: params.slots,
      },
    });
  }

  async updateBatch(id: string, params: UpdateBatchParams) {
    const { data: tipData } = await this.getEntityTip(id);
    if (!tipData) {
      return { error: { message: 'Batch not found', code: 'NOT_FOUND' } };
    }

    return this.updateEntity(id, {
      expectTip: tipData.cid,
      properties: params.properties,
    });
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private mapError(error: unknown): ApiError | undefined {
    if (!error) return undefined;
    // Map SDK errors to our ApiError format
    return { message: String(error), code: 'API_ERROR' };
  }
}
```

---

## API Changes Required in arke_v1

### New Routes to Add

#### 1. `/kladoi` routes (similar to `/agents`)

```typescript
// arke_v1/src/routes/kladoi.ts

POST   /kladoi                    - Create klados (with validation)
GET    /kladoi/{id}               - Get klados (optional, can use /entities)
PUT    /kladoi/{id}               - Update klados (with validation)
POST   /kladoi/{id}/invoke        - Invoke klados
POST   /kladoi/{id}/verify        - Verify endpoint ownership
```

#### 2. `/rhizai` routes

```typescript
// arke_v1/src/routes/rhizai.ts

POST   /rhizai                    - Create rhiza (with static validation)
GET    /rhizai/{id}               - Get rhiza (optional, can use /entities)
PUT    /rhizai/{id}               - Update rhiza (with validation)
POST   /rhizai/{id}/invoke        - Invoke workflow (runtime validation + permissions)
GET    /rhizai/{id}/jobs/{job_id}/status - Get workflow status
POST   /rhizai/{id}/jobs/{job_id}/resume - Resume failed workflow
```

### Implementation Priority

1. **Phase 1: Core Invocation**
   - `POST /kladoi/{id}/invoke` - Essential for workflow execution
   - `POST /rhizai/{id}/invoke` - Essential for workflow execution

2. **Phase 2: CRUD with Validation**
   - `POST /kladoi` - Server-side klados validation
   - `PUT /kladoi/{id}` - Server-side validation, re-verify on endpoint change
   - `POST /rhizai` - Server-side rhiza validation
   - `PUT /rhizai/{id}` - Server-side validation

3. **Phase 3: Status & Resume**
   - `GET /rhizai/{id}/jobs/{job_id}/status` - Uses rhiza.buildStatusFromLogs
   - `POST /rhizai/{id}/jobs/{job_id}/resume` - Uses rhiza.resumeWorkflow

4. **Phase 4: Verification**
   - `POST /kladoi/{id}/verify` - Same pattern as agents/verify

---

## Implementation Plan for rhiza Library

### Phase 1: Client Interface & Types

```
src/client/
├── types.ts          # All types (params, responses, errors)
├── interface.ts      # RhizaClient interface
└── index.ts          # Exports
```

**Tasks:**
- [ ] Define all request/response types with exact shapes
- [ ] Define `RhizaClient` interface
- [ ] Define error types

### Phase 2: Mock Client (API Specification)

```
src/client/
├── mock.ts           # MockRhizaClient - simulates expected API behavior
└── index.ts          # Updated exports
```

**This is the key phase.** The mock client defines exactly what the API should do:
- What endpoints exist
- What parameters they accept
- What responses they return
- What errors they produce

**Tasks:**
- [ ] Implement `MockRhizaClient` with all operations
- [ ] Document expected behavior in code comments
- [ ] Include validation logic that mirrors expected server behavior
- [ ] Handle all edge cases (not found, conflicts, validation errors)

### Phase 3: SDK Client (Real Implementation)

```
src/client/
├── sdk.ts            # SdkRhizaClient - wraps @arke-institute/sdk
└── index.ts          # Updated exports
```

**Tasks:**
- [ ] Implement `SdkRhizaClient` wrapping the SDK
- [ ] Map to new endpoints when available (`/kladoi/*`, `/rhizai/*`)
- [ ] Fall back to generic endpoints (`/entities/*`) where applicable
- [ ] Same interface as mock client

### Phase 4: Factory & Integration

```
src/client/
├── factory.ts        # createRhizaClient() factory
└── index.ts          # Final exports
```

**Tasks:**
- [ ] Create factory: `createRhizaClient({ mock: true })` vs real
- [ ] Update existing code to use new client
- [ ] Migrate tests to use new mock client

### Phase 5: Signature Utilities

```
src/signature/
├── parse.ts          # parseSignatureHeader()
├── validate.ts       # validateTimestamp()
├── constants.ts      # TTLs and limits
└── index.ts          # Exports
```

**Tasks:**
- [ ] Implement signature header parsing
- [ ] Implement timestamp validation
- [ ] Export from main index.ts

---

## Package Dependencies

### Current
```json
{
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

### Add
```json
{
  "dependencies": {
    "@arke-institute/sdk": "^2.7.0"
  },
  "peerDependencies": {
    "@arke-institute/sdk": "^2.7.0"
  }
}
```

**Note:** SDK as peer dependency allows consumers to provide their own version.

---

## Testing Strategy

### Unit Tests (mock client)
- All existing tests continue to work
- Mock client implements same interface as SDK client
- No network calls in unit tests

### Integration Tests (real SDK)
- Optional tests that run against test network
- Use `ARKE_API_KEY` and `ARKE_NETWORK=test`
- Create real entities, invoke, verify logs

### Test Configuration
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'], // Run separately
  },
});

// vitest.integration.config.ts
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
  },
});
```

---

## Migration Path

### For Existing Code Using MockArkeClient

Before:
```typescript
import { createMockClient } from '@arke-institute/rhiza';

const client = createMockClient({ kladoi: {...} });
await client.api.GET('/kladoi/{id}', { params: { path: { id } } });
```

After:
```typescript
import { createRhizaClient } from '@arke-institute/rhiza';

// For testing
const client = createRhizaClient({ mock: true, kladoi: {...} });
await client.getKlados(id);

// For production
const client = createRhizaClient({
  authToken: process.env.ARKE_API_KEY,
  network: 'test',
});
await client.getKlados(id);
```

---

## API Contract Specification

This section defines the exact API contracts. This is the specification for `arke_v1`.

### POST /kladoi/{id}/invoke

Invoke a klados (standalone or as part of workflow).

**Request:**
```typescript
{
  // Required
  target: string;              // Entity ID to process

  // Optional - standalone mode
  input?: Record<string, unknown>;  // Custom input data
  confirm?: boolean;           // Skip confirmation (default: false)
  expires_in?: number;         // Seconds until expiry (default: 3600)

  // Optional - workflow mode (provided by parent klados)
  job_collection?: string;     // Existing job collection ID
  rhiza_context?: {
    id: string;                // Rhiza entity ID
    path: string[];            // Klados IDs from entry to current
    parent_logs: string[];     // Parent log IDs for chain
    batch?: {
      id: string;
      index: number;
      total: number;
    };
  };
}
```

**Response (confirmation needed):**
```typescript
{
  status: 'pending_confirmation';
  message: string;
  grants: Array<{
    klados: { id: string; label: string };
    actions: string[];
  }>;
  expires_at: string;
}
```

**Response (started):**
```typescript
{
  status: 'started';
  job_id: string;
  job_collection: string;
  klados_id: string;
  expires_at: string;
}
```

**Response (rejected):**
```typescript
{
  status: 'rejected';
  error: string;
  job_id: string;
}
```

---

### POST /rhizai/{id}/invoke

Invoke a rhiza workflow.

**Request:**
```typescript
{
  target: string;              // Entity ID to process
  input?: Record<string, unknown>;
  confirm?: boolean;
  expires_in?: number;
}
```

**Response (confirmation needed):**
```typescript
{
  status: 'pending_confirmation';
  message: string;
  grants: Array<{
    type: 'klados' | 'rhiza';
    id: string;
    label: string;
    actions?: string[];  // Only for klados
  }>;
  expires_at: string;
}
```

**Response (started):**
```typescript
{
  status: 'started';
  job_id: string;
  job_collection: string;
  rhiza_id: string;
  expires_at: string;
}
```

---

### GET /rhizai/{id}/jobs/{job_id}/status

Get workflow execution status.

**Response:**
```typescript
{
  job_id: string;
  rhiza_id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  progress: {
    total: number;
    pending: number;
    running: number;
    done: number;
    error: number;
  };
  current_kladoi?: string[];   // Currently running klados IDs
  errors?: Array<{
    klados_id: string;
    job_id: string;
    code: string;
    message: string;
    retryable: boolean;
  }>;
  started_at: string;
  completed_at?: string;
}
```

---

### POST /rhizai/{id}/jobs/{job_id}/resume

Resume a failed workflow.

**Request:**
```typescript
{
  max_jobs?: number;           // Limit how many to resume
  job_ids?: string[];          // Only resume specific jobs
}
```

**Response:**
```typescript
{
  resumed: number;
  skipped: number;
  jobs: Array<{
    original_job_id: string;
    new_job_id: string;
    klados_id: string;
    error_log_id: string;
    target_entity_id: string;
  }>;
}
```

---

### POST /kladoi

Create a klados entity with validation.

**Request:**
```typescript
{
  collection_id: string;
  label: string;
  description?: string;
  endpoint: string;
  actions_required: string[];
  accepts: { types: string[]; cardinality: 'one' | 'many' };
  produces: { types: string[]; cardinality: 'one' | 'many' };
  input_schema?: Record<string, unknown>;
}
```

**Response:**
```typescript
{
  id: string;
  cid: string;
  type: 'klados';
  properties: KladosProperties;
  // ... standard entity fields
}
```

**Errors:**
- 400: Validation failed (invalid endpoint, empty contracts, etc.)

---

### PUT /kladoi/{id}

Update a klados entity.

**Request:**
```typescript
{
  expect_tip: string;          // CAS check
  label?: string;
  description?: string;
  endpoint?: string;           // Changes clear endpoint_verified_at
  actions_required?: string[];
  accepts?: { types: string[]; cardinality: 'one' | 'many' };
  produces?: { types: string[]; cardinality: 'one' | 'many' };
  input_schema?: Record<string, unknown>;
  status?: 'development' | 'active' | 'disabled';
}
```

**Response:** Updated entity

**Errors:**
- 400: Validation failed
- 409: CAS conflict (expect_tip doesn't match)

**Special behavior:**
- Changing `endpoint` clears `endpoint_verified_at` and resets `status` to `development`
- Setting `status: 'active'` requires `endpoint_verified_at` to be set

---

### POST /rhizai

Create a rhiza entity with validation.

**Request:**
```typescript
{
  collection_id: string;
  label: string;
  description?: string;
  version: string;
  entry: string;               // Entry klados ID
  flow: Record<string, FlowStep>;
}
```

**Response:** Created entity

**Errors:**
- 400: Static validation failed (missing entry, cycles, invalid targets, etc.)

---

### PUT /rhizai/{id}

Update a rhiza entity.

**Request:**
```typescript
{
  expect_tip: string;
  label?: string;
  description?: string;
  version?: string;
  entry?: string;
  flow?: Record<string, FlowStep>;
  status?: 'development' | 'active' | 'disabled';
}
```

**Response:** Updated entity

**Errors:**
- 400: Validation failed
- 409: CAS conflict

---

### POST /kladoi/{id}/verify

Endpoint ownership verification (same pattern as agents).

**Request (phase 1 - get token):**
```typescript
{}
```

**Response (phase 1):**
```typescript
{
  verification_token: string;  // vt_...
  klados_id: string;
  endpoint: string;
  instructions: string;
  expires_at: string;
}
```

**Request (phase 2 - confirm):**
```typescript
{
  confirm: true;
}
```

**Response (phase 2 - success):**
```typescript
{
  verified: true;
  verified_at: string;
}
```

**Response (phase 2 - failure):**
```typescript
{
  verified: false;
  error: 'no_token' | 'token_expired' | 'fetch_failed' | 'invalid_response' | 'token_mismatch' | 'agent_id_mismatch';
  message: string;
}
```

---

## Next Steps

1. **Implement Phase 1** - Define types matching contracts above
2. **Implement Phase 2** - Mock client that behaves exactly as spec
3. **Implement Phase 3** - SDK client (can stub unimplemented endpoints)
4. **Hand off to arke_v1** - They implement to this spec
5. **Integration testing** - Once real endpoints exist
