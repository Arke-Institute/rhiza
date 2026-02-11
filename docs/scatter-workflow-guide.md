# Scatter Workflow Guide

This guide covers building and testing scatter workflows in rhiza, including lessons learned from production debugging.

## Overview

Scatter workflows fan out work across multiple parallel invocations. A scatter klados creates N copies (or processes N items) and the framework invokes the next step for each one.

```
                    ┌─────────────┐
                    │   Scatter   │ Creates 3 copies
                    │   Worker    │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   Stamp 1   │ │   Stamp 2   │ │   Stamp 3   │
    └─────────────┘ └─────────────┘ └─────────────┘
```

## Workflow Definition

### Basic Scatter

```json
{
  "entry": "scatter",
  "flow": {
    "scatter": {
      "klados": { "pi": "$SCATTER_KLADOS" },
      "then": { "scatter": "process" }
    },
    "process": {
      "klados": { "pi": "$PROCESS_KLADOS" },
      "then": { "done": true }
    }
  }
}
```

The `"then": { "scatter": "process" }` tells rhiza to invoke the `process` step for **each** output from the scatter klados.

### Nested Scatter

You can chain scatters for multi-level fan-out:

```json
{
  "entry": "scatter1",
  "flow": {
    "scatter1": {
      "klados": { "pi": "$SCATTER_KLADOS" },
      "then": { "scatter": "scatter2" }
    },
    "scatter2": {
      "klados": { "pi": "$SCATTER_KLADOS" },
      "then": { "scatter": "stamp" }
    },
    "stamp": {
      "klados": { "pi": "$STAMP_KLADOS" },
      "then": { "done": true }
    }
  }
}
```

With `copy_count: 3`, this creates:
- 1 root scatter → 3 level-2 scatters → 9 stamps = 13 total logs

## Building a Scatter Worker

### Core Pattern

A scatter worker creates multiple output entities and returns their IDs:

```typescript
import { KladosJob, type Output } from '@arke-institute/rhiza';

export async function processJob(job: KladosJob): Promise<Output[]> {
  // 1. Fetch the source entity
  const target = await job.fetchTarget();

  // 2. Determine how many copies to create
  const numCopies = (target.properties.copy_count as number) || 3;

  // 3. Create copies in batches (respect Cloudflare limits)
  const BATCH_SIZE = 20;
  const copies: string[] = [];

  for (let batchStart = 0; batchStart < numCopies; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, numCopies);
    const batchPromises: Promise<string>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const promise = job.client.api.POST('/entities', {
        body: {
          type: target.type,
          collection: job.request.target_collection,  // NOT job_collection!
          properties: {
            ...target.properties,
            label: `${target.properties.label} - Copy ${i + 1}`,
            copy_index: i,
            source_entity: target.id,
          },
          relationships: [
            { predicate: 'copy_of', peer: target.id }
          ],
        },
      }).then(({ data }) => data!.id);

      batchPromises.push(promise);
    }

    const batchResults = await Promise.all(batchPromises);
    copies.push(...batchResults);

    job.log.info(`Created batch`, {
      batch: Math.floor(batchStart / BATCH_SIZE) + 1,
      totalCreated: copies.length
    });
  }

  // 4. Log success with numCopies metadata (CRITICAL for tree traversal!)
  job.log.success('Scatter complete', { numCopies: copies.length });

  // 5. Return array of output entity IDs
  return copies;
}
```

### Optional: Log numCopies for Legacy Support

The framework automatically records output counts in the handoff record, so workers don't need to explicitly log `numCopies`. However, for backward compatibility or additional clarity, you can still include it:

```typescript
// Optional - framework now records outputs automatically
job.log.success('Scatter complete', { numCopies: copies.length });
```

The tree traversal algorithm uses this priority to determine expected children:
1. `outputs.length - done_slots` from handoff record (framework-provided, automatic)
2. `numCopies` from log messages (worker-provided, optional)
3. `invocations.length` from handoff record (local scatters only)

### Collection Usage

**Target collection vs Job collection:**

```typescript
// WRONG - creates copies in the job collection (logs only!)
collection: job.request.job_collection

// CORRECT - creates copies in the target collection (where work happens)
collection: job.request.target_collection
```

### Batching for Cloudflare Limits

Cloudflare Workers have limits:
- Sub-requests: 1000 per invocation
- CPU time: 30 seconds

Batch entity creation to stay within limits:

```typescript
const BATCH_SIZE = 20;  // Safe batch size

for (let i = 0; i < numCopies; i += BATCH_SIZE) {
  const batch = await Promise.all(
    items.slice(i, i + BATCH_SIZE).map(item => createEntity(item))
  );
  results.push(...batch);
}
```

## Testing Scatter Workflows

### Using klados-testing

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import {
  configureTestClient,
  createCollection,
  createEntity,
  invokeRhiza,
  waitForWorkflowTree,
} from '@arke-institute/klados-testing';

describe('scatter workflow', () => {
  let targetCollection: { id: string };
  let testEntity: { id: string };

  beforeAll(async () => {
    configureTestClient({
      apiBase: process.env.ARKE_API_BASE || 'https://arke-v1.arke.institute',
      userKey: process.env.ARKE_USER_KEY!,
      network: 'test',
    });

    // Create test collection
    targetCollection = await createCollection({ label: 'Scatter Test' });

    // Create test entity with copy_count
    testEntity = await createEntity({
      type: 'test_entity',
      properties: {
        label: 'Scatter Source',
        copy_count: 3,  // Each scatter creates 3 copies
      },
      collectionId: targetCollection.id,
    });
  });

  it('should scatter to expected number of children', async () => {
    // Invoke workflow
    const result = await invokeRhiza({
      rhizaId: process.env.SCATTER_RHIZA!,
      targetEntity: testEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');

    // Wait for workflow tree to complete
    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 120000,
      pollInterval: 3000,
      onPoll: (t, elapsed) => {
        console.log(`[${Math.round(elapsed/1000)}s] logs=${t.logs.size}, complete=${t.isComplete}`);
      },
    });

    // Verify completion
    expect(tree.isComplete).toBe(true);
    expect(tree.allChildrenDiscovered).toBe(true);
    expect(tree.hasErrors).toBe(false);

    // Verify tree structure
    expect(tree.root).toBeDefined();
    expect(tree.root!.expectedChildren).toBe(3);
    expect(tree.root!.children.length).toBe(3);
  }, 180000);
});
```

### Understanding waitForWorkflowTree

The `waitForWorkflowTree` function traverses the log tree and waits for completion:

```typescript
const tree = await waitForWorkflowTree(jobCollectionId, {
  timeout: 120000,    // Max wait time
  pollInterval: 3000, // Check every 3 seconds
});
```

**Tree properties:**

| Property | Description |
|----------|-------------|
| `isComplete` | All leaves are terminal AND all expected children discovered |
| `allChildrenDiscovered` | Every node has all its expected children |
| `logs.size` | Total number of log entries found |
| `leaves` | Array of leaf nodes (terminal with no children) |
| `hasErrors` | Whether any logs have error status |
| `root` | The root node of the tree |

**Node properties:**

| Property | Description |
|----------|-------------|
| `expectedChildren` | Number of children expected (from numCopies) |
| `children` | Array of child nodes |
| `isLeaf` | True if terminal with no expected children |
| `isTerminal` | True if status is 'done' or 'error' |

### Verifying Tree Structure

```typescript
// Check root scatter
expect(tree.root!.expectedChildren).toBe(3);
expect(tree.root!.children.length).toBe(3);

// Check each child
for (const child of tree.root!.children) {
  expect(child.log.properties.klados_id).toBe(STAMP_KLADOS);
  expect(child.isLeaf).toBe(true);
  expect(child.isTerminal).toBe(true);
}

// Check total logs
expect(tree.logs.size).toBe(4);  // 1 scatter + 3 stamps
```

## Log Relationships

Scatter creates a tree of logs linked by relationships:

```
Parent Log (scatter)
├── sent_to → Child Log 1 (stamp)
├── sent_to → Child Log 2 (stamp)
└── sent_to → Child Log 3 (stamp)

Child Logs
└── received_from → Parent Log
```

**Forward links** (`sent_to`) are created when the scatter completes.
**Backward links** (`received_from`) are created when each child starts.

## Debugging Scatter Workflows

### Check Log Status

```typescript
// Get all logs in job collection
const logs = await apiRequest('GET', `/collections/${jobCollectionId}/entities?type=klados_log`);

for (const log of logs) {
  console.log(`${log.id}: ${log.properties.status}`);
}
```

### Check Expected vs Actual Children

```typescript
const tree = await buildWorkflowTree(jobCollectionId);

// Walk the tree
function printNode(node, indent = '') {
  console.log(`${indent}${node.log.id}: expected=${node.expectedChildren}, actual=${node.children.length}`);
  for (const child of node.children) {
    printNode(child, indent + '  ');
  }
}

if (tree.root) {
  printNode(tree.root);
}
```

### Common Issues

**1. `isComplete: true` before all logs found**

Cause: Using an older version of rhiza that doesn't record `outputs` in handoff records.

Fix: Update to latest rhiza version. If using older version, add `numCopies` to success message:
```typescript
job.log.success('Scatter complete', { numCopies: copies.length });
```

**2. Children not linked to parent**

Cause: `sent_to` relationships not created.

Check: The parent log should have `sent_to` relationships after completing.

**3. Workflow stuck on scatter**

Cause: Worker timing out before all copies created.

Fix: Use batching to stay within Cloudflare limits:
```typescript
const BATCH_SIZE = 20;
for (let i = 0; i < numCopies; i += BATCH_SIZE) { ... }
```

**4. Permission errors on child invocations**

Cause: Klados keys not created or permissions not granted.

Fix: Ensure workflow grants permissions upfront and workers use klados keys (`ak_...`).

## Large Scatter (> 50 items)

For scatters larger than 50 items, rhiza automatically delegates to a scatter-utility service:

```typescript
// This happens automatically in interpretThen
if (outputs.length > 50 && !config?.scatterUtility?.forceLocal) {
  // Delegate to scatter-utility for parallel dispatch
  await delegateToScatterUtility({ ... });
}
```

The scatter-utility uses Durable Objects to batch invocations efficiently.

For very large scatters (500+), consider:
1. Creating entities in advance with `use_existing_copies: true`
2. Using Tier 2 DO workers for batch processing
3. Breaking into multiple workflow stages

## Lessons Learned

### 1. Framework Records Output Counts Automatically

The framework now records `outputs` in the handoff record automatically, so workers don't need to explicitly log `numCopies`. The tree traversal uses `outputs.length - done_slots` to determine expected children.

```typescript
// This is now optional - framework handles it automatically
job.log.success('Scatter complete', { numCopies: copies.length });
```

The old requirement to log `numCopies` was a fragile design - easy to forget and caused `isComplete: true` to be reported prematurely for delegated scatters.

### 2. Stability Check Prevents Race Conditions

The tree traversal requires 2 consecutive polls with the same log count before declaring complete. This handles async relationship updates:

```typescript
// In waitForWorkflowTree
if (tree.isComplete && tree.logs.size === lastLogCount) {
  stableCount++;
  if (stableCount >= 2) return tree;  // Only return after stability
}
```

### 3. Test Nested Scatters

Nested scatters (scatter → scatter) exercise the algorithm more thoroughly:
- Verifies recursive child discovery
- Catches issues with expectedChildren at multiple levels
- Confirms tree structure is correct

### 4. Use onPoll for Debugging

The `onPoll` callback shows real-time progress:

```typescript
waitForWorkflowTree(jobCollectionId, {
  onPoll: (tree, elapsed) => {
    console.log(`[${elapsed/1000}s] logs=${tree.logs.size}, complete=${tree.isComplete}`);
  },
});
```

### 5. Job Collection vs Target Collection

This is the most common mistake:
- **Job Collection** = Only for `klados_log` entities (observability)
- **Target Collection** = Where your work happens (entities created/modified)

Always create output entities in `target_collection`, not `job_collection`.
