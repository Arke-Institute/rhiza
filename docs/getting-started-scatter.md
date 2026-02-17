# Getting Started: Building a Scatter Worker

This guide walks through creating a scatter worker and workflow from scratch.

## Prerequisites

- Node.js 18+
- Cloudflare account (for Workers)
- Arke user key (`uk_...`)
- Wrangler CLI (`npm install -g wrangler`)

## Overview

A scatter workflow fans out work across multiple parallel invocations:

```
Input Entity → Scatter Worker → [Copy 1, Copy 2, Copy 3] → Next Step (per copy)
```

You'll create:
1. **Scatter Worker** - Creates N output entities from one input
2. **Rhiza Workflow** - Defines the scatter → process chain

## Part 1: Create the Scatter Worker

### Step 1: Clone the Template

```bash
# Clone the worker template
git clone https://github.com/Arke-Institute/klados-worker-template my-scatter-worker
cd my-scatter-worker
npm install
```

### Step 2: Configure agent.json

Edit `agent.json` with your worker's configuration:

```json
{
  "label": "My Scatter Worker",
  "description": "Creates multiple copies of an entity for parallel processing",
  "endpoint": "https://my-scatter-worker.YOUR_USERNAME.workers.dev",
  "actions_required": ["entity:view", "entity:create", "entity:update"],
  "accepts": {
    "types": ["*"],
    "cardinality": "one"
  },
  "produces": {
    "types": ["*"],
    "cardinality": "many"
  }
}
```

**Key settings:**
- `actions_required`: Include `entity:create` since you're creating new entities
- `produces.cardinality`: Set to `"many"` for scatter workers

### Step 3: Update wrangler.jsonc

```jsonc
{
  "name": "my-scatter-worker",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "vars": {
    "AGENT_VERSION": "1.0.0"
  }
}
```

### Step 4: Implement the Scatter Logic

Replace `src/job.ts` with your scatter implementation:

```typescript
/**
 * Scatter Worker - Creates N copies of an entity
 */

import type { KladosJob, Output } from '@arke-institute/rhiza';

/** Batch size for concurrent entity creation */
const BATCH_SIZE = 20;

/**
 * Process a job by creating N copies of the target entity
 */
export async function processJob(job: KladosJob): Promise<Output[]> {
  // 1. Fetch the target entity
  const target = await job.fetchTarget();

  job.log.info('Scatter worker starting', {
    targetId: target.id,
    targetType: target.type,
  });

  // 2. Determine how many copies to create
  // You can read this from target properties or use a fixed number
  const numCopies = (target.properties.copy_count as number) || 3;

  // 3. Create copies in batches (respect Cloudflare limits)
  const copies: string[] = [];

  for (let batchStart = 0; batchStart < numCopies; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, numCopies);
    const batchPromises: Promise<string>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const promise = job.client.api.POST('/entities', {
        body: {
          type: target.type,
          // IMPORTANT: Use target_collection, NOT job_collection
          collection: job.request.target_collection,
          properties: {
            // Copy properties from original
            ...target.properties,
            // Add copy-specific metadata
            label: `${target.properties.label || 'Entity'} - Copy ${i + 1}`,
            copy_index: i,
            copy_total: numCopies,
            source_entity: target.id,
          },
          // Link back to original
          relationships: [
            {
              predicate: 'copy_of',
              peer: target.id,
              peer_type: target.type,
            },
          ],
        },
      }).then(({ data, error }) => {
        if (error || !data) {
          throw new Error(`Failed to create copy ${i + 1}: ${JSON.stringify(error)}`);
        }
        return data.id;
      });

      batchPromises.push(promise);
    }

    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);
    copies.push(...batchResults);

    job.log.info(`Created batch`, {
      batch: Math.floor(batchStart / BATCH_SIZE) + 1,
      totalCreated: copies.length,
    });
  }

  // 4. (Optional) Update original to reference copies
  try {
    const { data: tipData } = await job.client.api.GET('/entities/{id}/tip', {
      params: { path: { id: target.id } },
    });

    if (tipData) {
      await job.client.api.PUT('/entities/{id}', {
        params: { path: { id: target.id } },
        body: {
          expect_tip: tipData.cid,
          relationships_add: copies.map((copyId, i) => ({
            predicate: 'has_copy',
            peer: copyId,
            peer_type: target.type,
            peer_label: `Copy ${i + 1}`,
          })),
        },
      });
    }
  } catch (e) {
    // Don't fail if relationship update fails
    job.log.info('Could not update original with has_copy relationships');
  }

  // 5. Log success and return outputs
  job.log.success('Scatter complete', { copyCount: copies.length });

  // Return the array of copy IDs
  // The framework will invoke the next step for each one
  return copies;
}
```

### Step 5: Update Types (Optional)

Edit `src/types.ts` to match your entity structure:

```typescript
export interface Env {
  AGENT_ID: string;
  AGENT_VERSION: string;
  ARKE_AGENT_KEY: string;
  VERIFICATION_TOKEN?: string;
  ARKE_VERIFY_AGENT_ID?: string;
}

export interface TargetProperties {
  label?: string;
  copy_count?: number;
  // Add your custom properties here
  [key: string]: unknown;
}

export interface OutputProperties {
  label: string;
  copy_index: number;
  copy_total: number;
  source_entity: string;
  [key: string]: unknown;
}
```

### Step 6: Register the Worker

```bash
# Deploy and register to test network
ARKE_USER_KEY=uk_your_key_here npm run register
```

This will:
1. Deploy the worker to Cloudflare
2. Create a klados entity on Arke
3. Verify endpoint ownership
4. Create and configure the API key
5. Save state to `.klados-state.json`

Note the `KLADOS_ID` from the output - you'll need it for the workflow.

---

## Part 2: Create the Workflow

### Step 1: Clone the Workflow Template

```bash
git clone https://github.com/Arke-Institute/rhiza-workflow-template my-scatter-workflow
cd my-scatter-workflow
npm install
```

### Step 2: Set Environment Variables

Create `.env`:

```bash
ARKE_USER_KEY=uk_your_key_here
ARKE_NETWORK=test

# Your scatter worker ID (from registration)
SCATTER_KLADOS=IIKXXXXXXXXXXXXXXXXXXXXXX

# Worker for processing each copy (can be same or different)
PROCESS_KLADOS=IIKXXXXXXXXXXXXXXXXXXXXXX
```

### Step 3: Create Workflow Definition

Create `workflows/my-scatter-workflow.json`:

```json
{
  "label": "My Scatter Workflow",
  "description": "Scatter an entity into copies, then process each copy",
  "version": "1.0",
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

**Flow explained:**
- `entry: "scatter"` - Start with the scatter step
- `then: { "scatter": "process" }` - For each output, invoke the process step
- `then: { "done": true }` - Each branch completes independently

### Step 4: Register the Workflow

```bash
npm run register -- my-scatter-workflow
```

Note the `RHIZA_ID` from the output.

---

## Part 3: Test the Workflow

### Step 1: Create a Test File

Create `test/my-scatter-workflow.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  configureTestClient,
  createCollection,
  createEntity,
  invokeRhiza,
  waitForWorkflowTree,
  log,
} from '@arke-institute/klados-testing';

const ARKE_USER_KEY = process.env.ARKE_USER_KEY;
const RHIZA_ID = process.env.RHIZA_ID;

describe('my scatter workflow', () => {
  let collection: { id: string };
  let entity: { id: string };

  beforeAll(() => {
    if (!ARKE_USER_KEY || !RHIZA_ID) {
      console.error('Missing ARKE_USER_KEY or RHIZA_ID');
      return;
    }

    configureTestClient({
      apiBase: process.env.ARKE_API_BASE || 'https://arke-v1.arke.institute',
      userKey: ARKE_USER_KEY,
      network: 'test',
    });
  });

  beforeAll(async () => {
    if (!ARKE_USER_KEY || !RHIZA_ID) return;

    // Create test fixtures
    collection = await createCollection({ label: 'Scatter Test' });
    log(`Created collection: ${collection.id}`);

    entity = await createEntity({
      type: 'test_entity',
      properties: {
        label: 'Test Source',
        copy_count: 3,  // Create 3 copies
      },
      collection: collection.id,
    });
    log(`Created entity: ${entity.id}`);
  });

  it('should scatter and process all copies', async () => {
    if (!ARKE_USER_KEY || !RHIZA_ID) {
      console.error('Test skipped: missing env vars');
      return;
    }

    // Invoke the workflow
    const result = await invokeRhiza({
      rhizaId: RHIZA_ID,
      targetEntity: entity.id,
      targetCollection: collection.id,
      confirm: true,
    });

    expect(result.status).toBe('started');
    log(`Workflow started: ${result.job_id}`);

    // Wait for completion
    // Expected: 1 scatter + 3 process = 4 logs
    const tree = await waitForWorkflowTree(result.job_collection!, {
      timeout: 120000,
      pollInterval: 3000,
      onPoll: (t, elapsed) => {
        log(`[${Math.round(elapsed/1000)}s] logs=${t.logs.size}, complete=${t.isComplete}`);
      },
    });

    // Verify
    expect(tree.isComplete).toBe(true);
    expect(tree.allChildrenDiscovered).toBe(true);
    expect(tree.logs.size).toBe(4);  // 1 scatter + 3 process
    expect(tree.hasErrors).toBe(false);

    // Check tree structure
    expect(tree.root).toBeDefined();
    expect(tree.root!.expectedChildren).toBe(3);
    expect(tree.root!.children.length).toBe(3);

    log('All assertions passed!');
  }, 180000);
});
```

### Step 2: Run the Test

```bash
ARKE_USER_KEY=uk_... RHIZA_ID=IIK... npm test
```

---

## Common Patterns

### Nested Scatter (scatter → scatter → process)

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
      "then": { "scatter": "process" }
    },
    "process": {
      "klados": { "pi": "$PROCESS_KLADOS" },
      "then": { "done": true }
    }
  }
}
```

With `copy_count: 3`, this creates: 1 + 3 + 9 = 13 total logs.

### Scatter with Gather (fan-out then fan-in)

```json
{
  "entry": "scatter",
  "flow": {
    "scatter": {
      "klados": { "pi": "$SCATTER_KLADOS" },
      "then": { "scatter": "process", "gather": "aggregate" }
    },
    "process": {
      "klados": { "pi": "$PROCESS_KLADOS" },
      "then": { "gather": "aggregate" }
    },
    "aggregate": {
      "klados": { "pi": "$AGGREGATE_KLADOS" },
      "then": { "done": true }
    }
  }
}
```

The aggregate step receives all outputs from all process steps.

---

## Key Points

1. **Use `target_collection`** for creating output entities, never `job_collection`

2. **Batch entity creation** to stay within Cloudflare limits (1000 sub-requests, 30s CPU)

3. **Return `Output[]`** from your worker - the framework handles invoking the next step for each

4. **No need to log `numCopies`** - the framework automatically tracks outputs in the handoff record

5. **Test with `waitForWorkflowTree`** - it properly handles scatter hierarchies

---

## Reference Files

| Resource | Location |
|----------|----------|
| Worker template | `klados-templates/klados-worker-template/` |
| Workflow template | `klados-templates/rhiza-workflow-template/` |
| Scatter worker example | `klados-examples/kladoi/scatter-worker/` |
| Scatter workflow examples | `klados-examples/rhizai/scatter-test/` |
| Klados worker guide | `rhiza/docs/klados-worker-guide.md` |
| Scatter workflow guide | `rhiza/docs/scatter-workflow-guide.md` |
| Workflow flow docs | `rhiza/docs/WORKFLOW_FLOW.md` |
