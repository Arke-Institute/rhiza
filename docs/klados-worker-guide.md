# Klados Worker Guide

This guide shows how to build a klados worker using the `@arke-institute/rhiza` library.

## Quick Start

The simplest way to build a klados worker is with the `KladosJob` class:

```typescript
import { KladosJob, type KladosRequest } from '@arke-institute/rhiza';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const req = await request.json<KladosRequest>();

    // Accept immediately - creates client, logger, response
    const job = KladosJob.accept(req, {
      agentId: env.AGENT_ID,
      agentVersion: env.AGENT_VERSION,
      authToken: env.ARKE_AGENT_KEY,
    });

    // Process in background - handles logging, handoffs, errors
    ctx.waitUntil(job.run(async () => {
      job.log.info('Processing started');

      // Your processing logic here
      const target = await job.fetchTarget();
      const outputs = await processEntity(target, job.client);

      job.log.success('Processing complete', { outputCount: outputs.length });
      return outputs;  // Return output entity IDs
    }));

    // Return acceptance immediately
    return Response.json(job.acceptResponse);
  }
};
```

## What KladosJob Handles

The `KladosJob` class manages the full job lifecycle:

1. **Acceptance** - Creates the response to return immediately
2. **Client Setup** - Configures `ArkeClient` with correct base URL and auth
3. **Logging** - Writes initial log entry, collects messages, finalizes status
4. **Workflow Handoffs** - Fetches rhiza flow, executes `interpretThen`, records handoffs
5. **Error Handling** - Updates both log status AND batch slot (for scatter/gather)

## Job Properties

```typescript
const job = KladosJob.accept(req, config);

// Pre-configured Arke client
job.client.api.GET('/entities/{id}', { ... });

// Built-in logger
job.log.info('Message', { metadata: 'here' });
job.log.warning('Warning message');
job.log.error('Error message');
job.log.success('Success message');

// Original request
job.request.target_entity;    // Single entity ID (cardinality: 'one')
job.request.target_entities;  // Multiple entity IDs (cardinality: 'many')
job.request.target_collection; // Permission-scoped collection
job.request.job_collection;   // Collection for logs/outputs
job.request.job_id;           // Job identifier

// Helper accessors
job.targetCollection;         // Quick access to permission-scoped collection

// Workflow context
job.isWorkflow;               // true if part of a rhiza workflow
job.batchContext;             // { id, index, total } if in scatter/gather

// Response to return
job.acceptResponse;           // { accepted: true, job_id: '...' }
```

## Target Handling

Klados workers receive targets based on their declared cardinality:

### Cardinality: 'one' (Single Entity)

Use `fetchTarget()` when your klados accepts a single entity:

```typescript
const job = KladosJob.accept(req, config);

ctx.waitUntil(job.run(async () => {
  // Fetch the single target entity
  const target = await job.fetchTarget<{ url: string }>();

  // Process it
  const result = await processEntity(target);
  return [result.id];
}));
```

### Cardinality: 'many' (Multiple Entities)

Use `fetchTargets()` when your klados accepts multiple entities:

```typescript
const job = KladosJob.accept(req, config);

ctx.waitUntil(job.run(async () => {
  // Fetch all target entities
  const targets = await job.fetchTargets<{ content: string }>();

  // Process them
  const results = await Promise.all(
    targets.map(t => processEntity(t))
  );
  return results.map(r => r.id);
}));
```

### Permission-Scoped Collection

Operations on entities are scoped to `target_collection`. Access it via:

```typescript
const collectionId = job.targetCollection;
// or
const collectionId = job.request.target_collection;
```

This is different from `job_collection` (where logs and outputs are written).

## Advanced: Manual Lifecycle Control

For cases requiring more control, use the manual methods:

```typescript
const job = KladosJob.accept(req, config);

ctx.waitUntil((async () => {
  // Start job (writes initial log)
  await job.start();

  try {
    // Your processing
    const outputs = await doWork();

    // Complete with optional output properties (for routing)
    const result = await job.complete(outputs, {
      type: 'processed',
      quality: 'high',
    });

    console.log('Handoff action:', result.handoff?.action);
  } catch (error) {
    // Fail handles both log and batch slot
    await job.fail(error);
  }
})());

return Response.json(job.acceptResponse);
```

## Error Handling

### Automatic Classification

Errors thrown in `job.run()` are automatically classified:

```typescript
job.run(async () => {
  // These errors are auto-classified:
  throw new Error('Network request failed');  // → NETWORK_ERROR (retryable)
  throw new Error('Request timed out');       // → TIMEOUT (retryable)
  throw new Error('Rate limit exceeded');     // → RATE_LIMITED (retryable)
  throw new Error('Entity not found');        // → NOT_FOUND (non-retryable)
  throw new Error('Permission denied');       // → PERMISSION_DENIED (non-retryable)
});
```

### Explicit Errors

For explicit error codes, use `createKladosError`:

```typescript
import { createKladosError, KladosErrorCode } from '@arke-institute/rhiza';

job.run(async () => {
  if (!isValidInput(input)) {
    throw createKladosError(
      KladosErrorCode.VALIDATION_ERROR,
      'Input must contain a valid URL',
    );
  }
  // ...
});
```

### Available Error Codes

| Code | Default Retryable | Use Case |
|------|------------------|----------|
| `NETWORK_ERROR` | Yes | Connection failures, DNS errors |
| `RATE_LIMITED` | Yes | 429 responses, quota exceeded |
| `TIMEOUT` | Yes | Request timeouts |
| `SERVICE_UNAVAILABLE` | Yes | 503 responses, maintenance |
| `TEMPORARY_FAILURE` | Yes | Transient issues |
| `NOT_FOUND` | No | 404 responses, missing entities |
| `VALIDATION_ERROR` | No | Invalid input data |
| `PERMISSION_DENIED` | No | 401/403 responses |
| `INVALID_INPUT` | No | Malformed requests |
| `UNSUPPORTED_TYPE` | No | Wrong entity type |
| `INTERNAL_ERROR` | No | Unexpected failures |
| `PROCESSING_ERROR` | Yes | Generic processing failure |

## Standalone Error Helper

For workers not using `KladosJob`, use `failKlados` directly:

```typescript
import { failKlados, KladosErrorCode } from '@arke-institute/rhiza';

try {
  // ... processing ...
} catch (error) {
  // Updates BOTH log status AND batch slot (if applicable)
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

## Complete Example: Image Processor

```typescript
import { KladosJob, KladosErrorCode, createKladosError } from '@arke-institute/rhiza';
import type { KladosRequest } from '@arke-institute/rhiza';

interface Env {
  AGENT_ID: string;
  AGENT_VERSION: string;
  ARKE_AGENT_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const req = await request.json<KladosRequest>();

    const job = KladosJob.accept(req, {
      agentId: env.AGENT_ID,
      agentVersion: env.AGENT_VERSION,
      authToken: env.ARKE_AGENT_KEY,
    });

    ctx.waitUntil(job.run(async () => {
      // Fetch the target entity
      const target = await job.fetchTarget<{ url: string; format: string }>();
      job.log.info('Processing image', { url: target.properties.url });

      // Validate input
      if (!target.properties.url) {
        throw createKladosError(
          KladosErrorCode.INVALID_INPUT,
          'Target entity must have a url property',
        );
      }

      // Process the image
      const processedUrl = await processImage(target.properties.url);

      // Create output entity
      const { data: output } = await job.client.api.POST('/entities', {
        body: {
          type: 'processed_image',
          collection: req.job_collection,
          properties: {
            original_url: target.properties.url,
            processed_url: processedUrl,
            processed_at: new Date().toISOString(),
          },
        },
      });

      job.log.success('Image processed', { outputId: output!.id });
      return [output!.id];
    }));

    return Response.json(job.acceptResponse);
  }
};

async function processImage(url: string): Promise<string> {
  // Image processing logic...
  return `https://processed.example.com/${url}`;
}
```

## Configuration

### KladosJobConfig

```typescript
interface KladosJobConfig {
  /** Klados agent ID (your registered agent) */
  agentId: string;

  /** Agent version for logging */
  agentVersion: string;

  /**
   * Authentication token for Arke API.
   * Accepts:
   * - Agent API key: 'ak_...'
   * - User API key: 'uk_...'
   * - JWT token from Supabase auth
   */
  authToken?: string;
}
```

### Environment Variables (Cloudflare Workers)

```jsonc
// wrangler.jsonc
{
  "name": "my-klados-worker",
  "vars": {
    "AGENT_ID": "klados_abc123",
    "AGENT_VERSION": "1.0.0"
  }
}
```

Set the API key as a secret:
```bash
wrangler secret put ARKE_AGENT_KEY
```
