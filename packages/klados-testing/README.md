# @arke-institute/klados-testing

Test utilities for klados workers on the Arke network.

## Installation

```bash
npm install --save-dev @arke-institute/klados-testing
```

## Usage

### Configure the Test Client

Call `configureTestClient` once in your test setup:

```typescript
import { configureTestClient } from '@arke-institute/klados-testing';

configureTestClient({
  apiBase: 'https://arke-v1.arke.institute',
  userKey: process.env.ARKE_USER_KEY!,
  network: 'test',
});
```

### Create Test Fixtures

```typescript
import {
  createCollection,
  createEntity,
  deleteEntity,
} from '@arke-institute/klados-testing';

// Create a collection
const collection = await createCollection({
  label: 'Test Collection',
  allowedTypes: ['document'],
});

// Create an entity in the collection
const entity = await createEntity({
  type: 'document',
  properties: { title: 'Test' },
  collectionId: collection.id,
});

// Cleanup
await deleteEntity(entity.id);
await deleteEntity(collection.id);
```

### Invoke and Verify Klados

```typescript
import {
  invokeKlados,
  waitForKladosLog,
  assertLogCompleted,
  assertLogHasMessages,
} from '@arke-institute/klados-testing';

// Invoke a klados
const result = await invokeKlados({
  kladosId: 'klados_xxx',
  targetEntity: entity.id,
  targetCollection: collection.id,
  jobCollection: jobCollection.id,
  confirm: true,
});

// Wait for completion
const log = await waitForKladosLog(result.job_collection!, {
  timeout: 30000,
  pollInterval: 1000,
});

// Verify with assertions
assertLogCompleted(log);
assertLogHasMessages(log, [
  { level: 'info', textContains: 'Processing' },
  { level: 'success', textContains: 'completed' },
]);
```

## API Reference

### Configuration

- `configureTestClient(config)` - Configure the test client
- `getConfig()` - Get current config (throws if not configured)
- `resetTestClient()` - Reset configuration

### Entity Operations

- `createEntity(options)` - Create an entity
- `getEntity(id)` - Get an entity by ID
- `deleteEntity(id)` - Delete an entity
- `createCollection(options)` - Create a collection
- `getCollectionEntities(id)` - Get entities in a collection

### Log Utilities

- `getKladosLog(id)` - Get a klados log by ID
- `getFirstLogFromCollection(id)` - Get first_log relationship from collection
- `waitForKladosLog(jobCollectionId, options?)` - Wait for log completion
- `getLogMessages(log)` - Extract messages from log
- `getLogEntry(log)` - Extract entry details from log

### Klados Invocation

- `invokeKlados(options)` - Invoke a klados worker

### Assertions

- `assertLogCompleted(log)` - Assert log completed successfully
- `assertLogFailed(log, expectedCode?)` - Assert log failed with error
- `assertLogHasMessages(log, criteria)` - Assert log contains specific messages
- `assertLogMessageCount(log, minCount)` - Assert minimum message count
- `assertLogHasHandoff(log, handoffType)` - Assert log has specific handoff

### Helpers

- `sleep(ms)` - Sleep for duration
- `log(message, data?)` - Log with timestamp
- `apiRequest(method, path, body?)` - Make raw API request

## Environment Variables

Your tests should set these environment variables:

- `ARKE_USER_KEY` - User API key (uk_...) for authentication
- `ARKE_API_BASE` - API base URL (default: https://arke-v1.arke.institute)
- `ARKE_NETWORK` - Network to use: 'test' or 'main' (default: test)

## License

MIT
