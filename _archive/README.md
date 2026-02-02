# Archived Code

This code was archived as part of the SDK integration simplification. These modules contain API-calling logic that belongs in the API implementation, not in the rhiza types/pure-logic library.

## What's Here

### `client/`
RhizaClient interface and mock implementation. This was an unnecessary abstraction over the SDK - workers should use `@arke-institute/sdk` directly.

### `resume/`
Workflow resumption logic (`resumeWorkflow`, `canResume`). This needs database/queue access for scale and belongs in the API.

### `status/`
Build workflow status from logs (`buildStatusFromLogs`). Requires recursive log traversal that exceeds subrequest limits at scale. Belongs in the API.

### `traverse/`
Log chain traversal utilities (`findLeaves`, `findErrorLeaves`, `buildLogTree`). Used by status/resume - belongs in the API.

### `handoff/interpret.ts`
Orchestration logic that calls APIs to execute handoffs. Workers should compose pure functions + SDK calls themselves.

## Where This Goes

- **Status/Resume**: API endpoints with queue-based processing for scale
- **Traverse**: API utilities for log chain traversal
- **Client interface**: Not needed - use SDK directly

## Usage Pattern Instead

Workers use rhiza for types + pure logic, SDK for API calls:

```typescript
import { ArkeClient } from '@arke-institute/sdk';
import { resolveTarget, type ThenSpec } from '@arke-institute/rhiza';

async function handleRequest(req: KladosRequest, client: ArkeClient) {
  const target = resolveTarget(thenSpec, outputProperties);

  if (target) {
    await client.api.POST('/kladoi/{id}/invoke', {
      params: { path: { id: target.pi } },
      body: { target: outputEntityId, confirm: true }
    });
  }
}
```
