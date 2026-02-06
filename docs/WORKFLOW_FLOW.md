# Rhiza Workflow Flow

This document explains how rhiza workflows execute, what metadata flows between agents, how logs chain together, and what the end state looks like.

## Overview

Rhiza uses a **cascading handoff pattern** where kladoi (agents) invoke each other directly rather than being orchestrated centrally. State is reconstructed from the log chain when needed.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         WORKFLOW EXECUTION                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   User invokes rhiza                                                │
│         │                                                           │
│         ▼                                                           │
│   ┌─────────────┐                                                   │
│   │ Rhiza Invoke│ ─── Creates job_collection                        │
│   │  (API)      │ ─── Grants ALL kladoi permissions                 │
│   └──────┬──────┘ ─── Invokes first klados                          │
│          │                                                          │
│          ▼                                                          │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐          │
│   │  Klados A   │────▶│  Klados B   │────▶│  Klados C   │          │
│   │ (scatter)   │     │  (stamp)    │     │  (gather)   │          │
│   └─────────────┘     └─────────────┘     └─────────────┘          │
│         │                   │                   │                   │
│         ▼                   ▼                   ▼                   │
│      Log A              Log B1, B2, B3       Log C                  │
│   (sent_to: B1,B2,B3)  (received_from: A)  (received_from: B*)     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Phase 1: Rhiza Invocation

When a user calls `POST /rhizai/{id}/invoke`:

### 1.1 Permission Collection

The API calls `collectFlowKladoi()` to gather ALL unique klados IDs from the flow definition:

```typescript
// Example flow
{
  "steps": {
    "scatter": { "klados": "KLADOS_A", "then": { "scatter": "stamp" } },
    "stamp": { "klados": "KLADOS_B", "then": { "pass": "done" } }
  }
}
// Collected: ["KLADOS_A", "KLADOS_B"]
```

### 1.2 Job Collection Creation

A dedicated collection is created for this workflow execution:

```typescript
{
  id: "IIKGQXFQ0B...",
  type: "collection",
  label: "Pipeline Job: job_01KGQXFQ0BV1T32W3W9DKPVK4X",
  // Contains: klados_logs, batch entities (if scatter/gather)
}
```

### 1.3 Bulk Permission Grants

ALL kladoi receive permissions in **two batch operations**:

**Target Collection** (where work happens):
- Actions from each klados's `actions_required`
- Typically: `entity:view`, `entity:create`, `entity:update`

**Job Collection** (logs and coordination):
- `entity:create`, `entity:view`, `entity:update`
- `collection:view`, `collection:update`

This is critical for scale - granting once avoids N concurrent permission writes.

### 1.4 First Klados Invocation

The API invokes the first klados in the flow with:

```typescript
POST /kladoi/{firstKladosId}/invoke
{
  target_entity: "USER_PROVIDED_ENTITY",
  target_collection: "USER_PROVIDED_COLLECTION",
  job_collection: "IIKGQXFQ0B...",  // Created above
  rhiza: {
    id: "RHIZA_ID",
    path: ["scatter"],  // Current step name
    parent_logs: []     // Empty for first step
  }
}
```

## Phase 2: Klados Execution

Each klados follows this lifecycle:

### 2.1 Accept (Immediate)

```typescript
const job = KladosJob.accept(request, config);
return Response.json(job.acceptResponse);  // { accepted: true, job_id: "..." }
```

### 2.2 Start (Background)

Creates the initial log entry in job_collection:

```typescript
// Log entity created
{
  id: "IIKGQX7EP2...",
  type: "klados_log",
  properties: {
    job_id: "job_01KGQ...",
    klados_id: "KLADOS_A",
    rhiza_id: "RHIZA_ID",
    status: "started",
    log_data: { messages: [...] },
    received: {
      target_entity: "...",
      target_collection: "...",
      from_logs: []  // or parent log IDs
    }
  },
  relationships: [
    { predicate: "collection", peer: "JOB_COLLECTION_ID" },
    { predicate: "received_from", peer: "PARENT_LOG_ID" }  // if not first
  ]
}
```

### 2.3 Process

The klados does its work:

```typescript
await job.run(async () => {
  // Fetch target, process, create outputs
  const target = await job.fetchTarget();
  const outputs = await createCopies(target);
  return outputs;  // Array of entity IDs
});
```

### 2.4 Complete & Handoff

After processing, `KladosJob.complete()`:

1. Fetches the rhiza flow definition
2. Finds current step by path
3. Evaluates `then` clause
4. Invokes next target(s)
5. Updates log with `sent_to` relationships
6. Sets log status to `done`

## Phase 3: Handoff Types

### Pass (1:1)

Single output → single invocation:

```typescript
{ "then": { "pass": "next_step" } }

// Invokes next klados with:
{
  target_entity: outputs[0],
  rhiza: {
    path: [...currentPath, "next_step"],
    parent_logs: [thisLogId]
  }
}
```

### Scatter (1:N)

Multiple outputs → parallel invocations:

```typescript
{ "then": { "scatter": "stamp" } }

// For each output, invokes target klados:
outputs.forEach(output => {
  invoke(targetKlados, {
    target_entity: output,
    rhiza: {
      path: [...currentPath, "stamp"],
      parent_logs: [thisLogId]
    }
  });
});
```

### Scatter with Gather (1:N:1)

Fan-out then fan-in:

```typescript
{ "then": { "scatter": "process", "gather": "aggregate" } }

// Creates batch entity for coordination
{
  type: "batch",
  properties: {
    total_slots: 3,
    completed_slots: 0,
    slots: [
      { index: 0, status: "pending" },
      { index: 1, status: "pending" },
      { index: 2, status: "pending" }
    ]
  }
}

// Each scatter invocation includes batch context:
{
  rhiza: {
    batch: {
      batch_id: "BATCH_ENTITY_ID",
      slot_index: 0,  // 0, 1, or 2
      gather_target: "aggregate"
    }
  }
}

// Last slot to complete triggers gather target
```

### Conditional (Route)

Choose path based on output properties:

```typescript
{
  "then": {
    "route": [
      { "where": { "type": "error" }, "pass": "handle_error" },
      { "where": { "status": "approved" }, "pass": "process" },
      { "pass": "review" }  // default
    ]
  }
}
```

## The Request Object

What each klados receives (`KladosRequest`):

```typescript
interface KladosRequest {
  // Core identifiers
  job_id: string;              // "job_01KGQXFQ0BV1..."

  // Target data
  target_entity?: string;      // Single entity ID
  target_entities?: string[];  // Multiple entity IDs (cardinality: many)
  target_collection: string;   // Where entities live

  // Workflow coordination
  job_collection: string;      // Where logs go

  // Rhiza context (only present in workflows)
  rhiza?: {
    id: string;                // Rhiza entity ID
    path: string[];            // Current position in flow ["scatter", "stamp"]
    parent_logs?: string[];    // Log IDs that led here
    batch?: {                  // Present in scatter/gather
      batch_id: string;
      slot_index: number;
      gather_target: string;
    }
  };

  // Infrastructure
  api_base: string;
  network: 'test' | 'main';
  expires_at: string;
}
```

## Log Relationships

Logs form a tree via relationships:

```
                    ┌─────────────┐
                    │  Scatter    │
                    │    Log      │
                    └──────┬──────┘
                           │ sent_to (3x)
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │  Stamp Log  │ │  Stamp Log  │ │  Stamp Log  │
    │     #1      │ │     #2      │ │     #3      │
    └─────────────┘ └─────────────┘ └─────────────┘
    received_from   received_from   received_from
```

**Forward link** (parent → children):
```typescript
// On scatter log, after invoking stamps
relationships_add: [
  { predicate: "sent_to", peer: "STAMP_LOG_1" },
  { predicate: "sent_to", peer: "STAMP_LOG_2" },
  { predicate: "sent_to", peer: "STAMP_LOG_3" }
]
```

**Backward link** (child → parent):
```typescript
// On each stamp log, at creation
relationships: [
  { predicate: "received_from", peer: "SCATTER_LOG" }
]
```

## End State: Completed Workflow

After successful execution:

### Job Collection Contents

```
Collection: "Pipeline Job: job_01KGQ..."
├── klados_log (scatter) - status: "done"
│   └── sent_to: [stamp_log_1, stamp_log_2, stamp_log_3]
├── klados_log (stamp #1) - status: "done"
│   └── received_from: scatter_log
├── klados_log (stamp #2) - status: "done"
│   └── received_from: scatter_log
├── klados_log (stamp #3) - status: "done"
│   └── received_from: scatter_log
└── (batch entity if scatter/gather)
```

### Log Properties (Final State)

```typescript
{
  status: "done",  // or "error"
  log_data: {
    entry: {
      started_at: "2026-02-05T22:02:12Z",
      completed_at: "2026-02-05T22:02:17Z",
      received: {
        target_entity: "INPUT_ENTITY",
        from_logs: ["PARENT_LOG_ID"]
      },
      handoffs: [
        {
          type: "scatter",
          target: "IIKGNRDYWJVC...",
          target_type: "klados",
          outputs: ["COPY_1", "COPY_2", "COPY_3"],
          invocations: [
            { target_entity: "COPY_1", job_id: "job_..." },
            { target_entity: "COPY_2", job_id: "job_..." },
            { target_entity: "COPY_3", job_id: "job_..." }
          ]
        }
      ]
    },
    messages: [
      { level: "info", message: "Processing...", timestamp: "..." },
      { level: "success", message: "Complete", timestamp: "..." }
    ]
  }
}
```

### Entity Relationships (Example: Scatter + Stamp)

```
Original Entity
├── has_copy → Copy 1
│   └── copy_of → Original
│   └── stamps: [{ stamped_by: "STAMP_KLADOS" }]
├── has_copy → Copy 2
│   └── copy_of → Original
│   └── stamps: [{ stamped_by: "STAMP_KLADOS" }]
└── has_copy → Copy 3
    └── copy_of → Original
    └── stamps: [{ stamped_by: "STAMP_KLADOS" }]
```

## Verifying Workflow Success

### 1. Check Log Count

```typescript
const logs = await apiRequest('GET', `/collections/${jobCollectionId}/entities?type=klados_log`);
expect(logs.length).toBe(expectedSteps);  // scatter(1) + stamps(3) = 4
```

### 2. Check All Logs Complete

```typescript
for (const log of logs) {
  const entity = await getEntity(log.pi);
  expect(entity.properties.status).toBe('done');
}
```

### 3. Verify via Relationships (Preferred)

```typescript
// Check original has copy relationships
const original = await getEntity(originalId);
const copies = original.relationships.filter(r => r.predicate === 'has_copy');
expect(copies.length).toBe(NUM_COPIES);

// Verify each copy
for (const rel of copies) {
  const copy = await getEntity(rel.peer);
  expect(copy.properties.stamps).toHaveLength(1);
}
```

## Key Invariants

1. **Permissions granted once** - Rhiza grants all kladoi permissions upfront
2. **Logs chain via relationships** - `sent_to` (forward) and `received_from` (backward)
3. **Path tracks position** - `rhiza.path` shows where we are in the flow
4. **Parent logs enable traversal** - `rhiza.parent_logs` links to upstream logs
5. **Batch coordinates scatter/gather** - Batch entity tracks slot completion
6. **Status is terminal** - `done` or `error`, no intermediate states after completion
