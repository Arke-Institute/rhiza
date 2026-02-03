# Simplification Plan

## Problem Statement

After implementing the SDK utilities, the integration experience for klados workers still requires significant boilerplate. Analysis of mock implementations reveals:

1. **~50 lines of identical code** in every klados worker
2. **Error handling split across 2 functions** (log + batch slot)
3. **20+ fields** to construct for `InterpretContext`
4. **Manual rhiza fetch** required to get workflow flow
5. **Confusing dual IDs** (`logId` vs `fileId`)

## Proposed Solutions

### 1. `KladosJob` Class (High Priority)

A high-level abstraction that manages the full job lifecycle.

```typescript
import { KladosJob } from '@arke-institute/rhiza';

export default {
  async fetch(request: Request, env: Env) {
    const req = await request.json<KladosRequest>();

    // Accept immediately
    const job = KladosJob.accept(req, {
      agentId: env.AGENT_ID,
      agentVersion: env.AGENT_VERSION,
      agentKey: env.ARKE_AGENT_KEY,
    });

    // Process in background
    ctx.waitUntil(job.run(async () => {
      job.log.info('Starting processing');

      // Do the actual work
      const entity = await job.fetchTarget();
      const result = await processEntity(entity);

      // Create output
      const output = await job.client.api.POST('/entities', { ... });

      // Return outputs - job handles handoff and log finalization
      return [output.id];
    }));

    return Response.json(job.acceptResponse);
  }
};
```

**What `KladosJob` handles automatically:**
- Creates ArkeClient with correct config
- Generates log ID
- Writes initial log entry (status: running)
- Fetches rhiza flow (if in workflow)
- On success: calls `interpretThen`, updates log with handoffs, marks done
- On error: marks log as error, marks batch slot as error (if applicable)

**Class Interface:**
```typescript
class KladosJob {
  // Factory
  static accept(request: KladosRequest, config: KladosConfig): KladosJob;

  // Properties
  readonly client: ArkeClient;
  readonly log: KladosLogger;
  readonly request: KladosRequest;
  readonly acceptResponse: KladosResponse;

  // Helpers
  async fetchTarget(): Promise<Entity>;
  async fetchTargets(): Promise<Entity[]>;  // For batch/gather inputs

  // Lifecycle
  async run(fn: () => Promise<string[]>): Promise<void>;

  // Manual control (for advanced cases)
  async start(): Promise<void>;
  async complete(outputs: string[], outputProperties?: Record<string, unknown>): Promise<InterpretResult>;
  async fail(error: Error | KladosError): Promise<void>;
}
```

### 2. `failKlados()` Helper (Medium Priority)

For cases where developers need more control but still want simplified error handling.

```typescript
import { failKlados, KladosErrorCode } from '@arke-institute/rhiza';

try {
  // ... work ...
} catch (error) {
  await failKlados(client, {
    logFileId,
    batchContext: request.rhiza?.batch,
    error: {
      code: KladosErrorCode.PROCESSING_ERROR,
      message: error.message,
      retryable: true,
    },
  });
}
```

**Implementation:**
```typescript
async function failKlados(
  client: ArkeClient,
  options: {
    logFileId: string;
    batchContext?: BatchContext;
    error: KladosError;
  }
): Promise<void> {
  // Always update log status
  await updateLogStatus(client, options.logFileId, 'error', options.error);

  // Also update batch slot if applicable
  if (options.batchContext) {
    await errorBatchSlotWithCAS(
      client,
      options.batchContext.id,
      options.batchContext.index,
      options.error
    );
  }
}
```

### 3. Standard Error Codes (Medium Priority)

Provide constants for common error scenarios with recommended retryability.

```typescript
// Error codes with default retryability
export const KladosErrorCode = {
  // Retryable errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Non-retryable errors
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_INPUT: 'INVALID_INPUT',

  // Unknown
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// Helper to create error with standard code
export function createKladosError(
  code: keyof typeof KladosErrorCode,
  message: string,
  retryableOverride?: boolean
): KladosError {
  const defaultRetryable = [
    'NETWORK_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'SERVICE_UNAVAILABLE'
  ].includes(code);

  return {
    code: KladosErrorCode[code],
    message,
    retryable: retryableOverride ?? defaultRetryable,
  };
}
```

### 4. `lookupFlowStep()` Helper (Low Priority)

Simplify the rhiza fetch + step lookup pattern.

```typescript
import { lookupFlowStep } from '@arke-institute/rhiza';

// Instead of:
const { data: rhiza } = await client.api.GET('/entities/{id}', { ... });
const flow = rhiza.properties.flow as Record<string, FlowStep>;
const myStep = flow[KLADOS_ID];

// Use:
const { flow, step } = await lookupFlowStep(client, request.rhiza?.id, KLADOS_ID);
```

### 5. `buildInterpretContext()` Helper (Low Priority)

Reduce the context construction boilerplate.

```typescript
import { buildInterpretContext } from '@arke-institute/rhiza';

// Instead of 20+ lines:
const context = buildInterpretContext(request, {
  client,
  kladosId: KLADOS_ID,
  outputs,
  logId,
  flow,
});

const result = await interpretThen(step.then, context);
```

---

## Implementation Priority

| Item | Priority | Effort | Impact |
|------|----------|--------|--------|
| `KladosJob` class | High | Large | Eliminates 90% of boilerplate |
| `failKlados()` helper | Medium | Small | Simplifies error handling |
| `KladosErrorCode` constants | Medium | Small | Standardizes error reporting |
| `lookupFlowStep()` | Low | Small | Minor convenience |
| `buildInterpretContext()` | Low | Small | Minor convenience (subsumed by KladosJob) |

**Recommendation:** Focus on `KladosJob` first. It provides the most value and subsumes most other helpers. The error codes and `failKlados()` are useful for advanced cases where developers need more control.

---

## File Structure

```
src/
├── worker/
│   ├── index.ts        # Exports
│   ├── job.ts          # KladosJob class
│   └── errors.ts       # KladosErrorCode, failKlados, createKladosError
├── handoff/
│   └── helpers.ts      # lookupFlowStep, buildInterpretContext
```

---

## Example: Before and After

### Before (~80 lines)

```typescript
import { ArkeClient } from '@arke-institute/sdk';
import {
  KladosRequest, KladosResponse, KladosLogEntry, FlowStep,
  KladosLogger, writeKladosLog, updateLogStatus, updateLogWithHandoffs,
  interpretThen, generateId, errorBatchSlotWithCAS,
} from '@arke-institute/rhiza';

export default {
  async fetch(request: Request, env: Env) {
    const req = await request.json<KladosRequest>();
    const logger = new KladosLogger();

    const response: KladosResponse = { accepted: true, job_id: req.job_id };
    ctx.waitUntil(processJob(req, logger, env));
    return Response.json(response);
  }
};

async function processJob(req: KladosRequest, logger: KladosLogger, env: Env) {
  const client = new ArkeClient({ ... });
  const logId = generateId();

  const logEntry: KladosLogEntry = {
    id: logId,
    type: 'klados_log',
    klados_id: env.AGENT_ID,
    rhiza_id: req.rhiza?.id,
    job_id: req.job_id,
    started_at: new Date().toISOString(),
    status: 'running',
    received: {
      target: req.target,
      from_logs: req.rhiza?.parent_logs,
      batch: req.rhiza?.batch,
    },
  };

  const { fileId } = await writeKladosLog({
    client, jobCollectionId: req.job_collection,
    entry: logEntry, messages: [],
    agentId: env.AGENT_ID, agentVersion: env.AGENT_VERSION,
  });

  try {
    logger.info('Processing');
    const outputs = await doWork(req.target);

    if (req.rhiza) {
      const { data: rhiza } = await client.api.GET('/entities/{id}', {
        params: { path: { id: req.rhiza.id } }
      });
      const flow = rhiza.properties.flow as Record<string, FlowStep>;
      const step = flow[env.AGENT_ID];

      const result = await interpretThen(step.then, {
        client, rhizaId: req.rhiza.id, kladosId: env.AGENT_ID,
        jobId: req.job_id, jobCollectionId: req.job_collection,
        flow, outputs, fromLogId: logId, path: req.rhiza.path,
        apiBase: req.api_base, network: req.network,
        batchContext: req.rhiza.batch,
      });

      if (result.handoffRecord) {
        await updateLogWithHandoffs(client, fileId, [result.handoffRecord]);
      }
    }

    await updateLogStatus(client, fileId, 'done');
  } catch (error) {
    await updateLogStatus(client, fileId, 'error', {
      code: 'ERROR', message: error.message, retryable: true
    });
    if (req.rhiza?.batch) {
      await errorBatchSlotWithCAS(client, req.rhiza.batch.id, req.rhiza.batch.index, {
        code: 'ERROR', message: error.message, retryable: true
      });
    }
  }
}
```

### After (~15 lines)

```typescript
import { KladosJob } from '@arke-institute/rhiza';

export default {
  async fetch(request: Request, env: Env) {
    const req = await request.json<KladosRequest>();

    const job = KladosJob.accept(req, {
      agentId: env.AGENT_ID,
      agentVersion: env.AGENT_VERSION,
      agentKey: env.ARKE_AGENT_KEY,
    });

    ctx.waitUntil(job.run(async () => {
      job.log.info('Processing');
      const outputs = await doWork(req.target);
      return outputs;
    }));

    return Response.json(job.acceptResponse);
  }
};
```

**~80% reduction in code.**
