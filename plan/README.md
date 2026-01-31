# Rhiza: Workflow Protocol for Arke

## Overview

**Rhiza** (Greek: ῥίζα, "root") is a workflow protocol for orchestrating distributed actions in the Arke ecosystem. It replaces centralized orchestrators with a **cascading handoff pattern** where actions invoke each other directly.

### Naming

- **Rhiza** (ῥίζα) = Workflow definition, the root structure that branches out
- **Klados** (κλάδος) = Individual action/branch, an executable unit within a rhiza

This pairing has biblical attestation (Romans 11:16) and maps cleanly to our concepts:
- Rhiza = the underlying structure/definition that everything draws from
- Klados = one executable branch-instance of that structure

### Key Principles

1. **Push-based execution**: Actions invoke next actions directly (no polling orchestrator)
2. **Log chain as state**: The execution log IS the state machine (no separate state store)
3. **Perfect resumability**: Every handoff records the exact request for replay
4. **Runtime-agnostic**: The protocol works with any execution environment

---

## Package Structure

```
/Users/chim/Working/arke_institute/rhiza/
├── plan/                         # This planning documentation
│   ├── README.md                 # Overview (this file)
│   ├── 01-types.md              # Type definitions
│   ├── 02-validation.md         # Validation rules
│   ├── 03-handoff.md            # Handoff logic
│   ├── 04-logging.md            # Logging and chain
│   ├── 05-resume.md             # Resumability
│   ├── 06-api-changes.md        # arke_v1 API changes
│   └── 07-implementation.md     # Implementation phases
│
├── src/
│   ├── types/
│   │   ├── rhiza.ts             # Rhiza, KladosSpec, ThenSpec
│   │   ├── request.ts           # KladosRequest
│   │   ├── response.ts          # KladosResponse
│   │   ├── log.ts               # KladosLogEntry, HandoffRecord
│   │   ├── batch.ts             # BatchEntity, BatchSlot
│   │   ├── status.ts            # StatusResponse
│   │   └── index.ts
│   │
│   ├── validation/
│   │   ├── validate-rhiza.ts    # validateRhiza()
│   │   ├── validate-cardinality.ts
│   │   └── index.ts
│   │
│   ├── handoff/
│   │   ├── interpret.ts         # interpretThen()
│   │   ├── scatter.ts           # createScatter()
│   │   ├── gather.ts            # completeBatchSlot()
│   │   ├── route.ts             # matchRoute()
│   │   ├── invoke.ts            # invokeKlados()
│   │   └── index.ts
│   │
│   ├── logging/
│   │   ├── logger.ts            # KladosLogger
│   │   ├── writer.ts            # writeKladosLog()
│   │   ├── chain.ts             # Log chain helpers
│   │   └── index.ts
│   │
│   ├── resume/
│   │   ├── traverse.ts          # traverseLogChain()
│   │   ├── find-errors.ts       # findErrorLeaves()
│   │   ├── resume.ts            # resumeWorkflow()
│   │   └── index.ts
│   │
│   ├── status/
│   │   ├── build.ts             # buildStatusFromLogs()
│   │   ├── progress.ts          # calculateProgress()
│   │   └── index.ts
│   │
│   ├── client/
│   │   ├── arke.ts              # ArkeClient wrapper
│   │   └── index.ts
│   │
│   └── index.ts                 # Main exports
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## Relationship to Existing Systems

### This Package (rhiza)
- Runtime-agnostic protocol library
- Types, validation, handoff logic
- No Cloudflare-specific code
- Can be used from Workers, Lambda, Node.js, etc.

### agent-core (existing)
- Cloudflare Worker/Durable Object framework
- Will continue to work independently
- May optionally import rhiza types in future

### arke_v1 API (changes needed)
- New `/rhizai` routes for workflow CRUD
- New rhiza entity profile
- Modified job collection for log chain predicates
- Resume endpoint

---

## Core Concepts

### 1. Workflow Definition (Rhiza)

A rhiza defines a graph of kladoi (actions) with handoff rules:

```yaml
rhiza:
  id: pdf-workflow
  name: PDF Processing Pipeline
  version: "1.0"
  entry: pdf-processor

  kladoi:
    pdf-processor:
      action: II01abc123...        # Agent ID
      accepts:
        types: ["file/pdf"]
        cardinality: one
      produces:
        types: ["file/jpeg"]
        cardinality: many
      then:
        scatter: ocr-service

    ocr-service:
      action: II01def456...
      accepts:
        types: ["file/jpeg"]
        cardinality: one
      produces:
        types: ["text/ocr"]
        cardinality: one
      then:
        gather: text-assembler

    text-assembler:
      action: II01ghi789...
      accepts:
        types: ["text/ocr"]
        cardinality: many
      produces:
        types: ["file/text"]
        cardinality: one
      then:
        done: true
```

### 2. Handoff Types

| Type | Description | Use Case |
|------|-------------|----------|
| `pass` | 1:1 direct handoff | Simple chaining |
| `scatter` | 1:N fan-out (creates batch) | Parallel processing |
| `gather` | N:1 fan-in (completes batch) | Aggregation |
| `route` | Conditional by property | Type-based routing |
| `done` | Terminal | End of workflow |

### 3. Batch Entity (for scatter/gather)

When a klados scatters, it creates a batch entity:

```typescript
{
  id: "IIbatch123...",
  type: "batch",
  properties: {
    rhiza_id: "IIrhiza...",
    job_id: "job_abc123",
    source_klados: "pdf-processor",
    gather_klados: "text-assembler",
    total: 10,
    completed: 0,
    status: "pending",
    slots: [
      { index: 0, status: "pending" },
      { index: 1, status: "pending" },
      // ...
    ]
  }
}
```

### 4. Log Chain (for resumability)

Each klados writes a log entry with relationships:

```
Log A (pdf-processor)
├── status: done
├── produced: [page1, page2, page3]
├── handoffs: scatter → ocr-service
│   ├── invocation[0]: job_001, status: done
│   ├── invocation[1]: job_002, status: error  ← RESUME HERE
│   └── invocation[2]: job_003, status: done
└── relationships:
    └── handed_off_to: [Log B, Log C, Log D]

Log B (ocr-service, batch[0])
├── status: done
├── received_from: Log A
└── handed_off_to: [Log E]
```

---

## Execution Flow

### Normal Flow

```
1. User calls POST /rhizai/{id}/invoke
2. API validates rhiza, grants permissions to all agents
3. API creates job collection
4. API invokes entry klados with KladosRequest (includes RhizaContext)
5. Entry klados processes, writes log, interprets `then`
6. Klados invokes next klados(es) based on handoff type
7. Chain continues until terminal klados
8. Terminal klados writes final log, workflow complete
```

### Scatter/Gather Flow

```
1. Klados A produces N outputs
2. A creates batch entity with N slots
3. A invokes klados B N times (parallel), each with batch context
4. Each B processes its input, updates its batch slot (CAS)
5. Last B to complete triggers klados C with all outputs
6. C receives array of all outputs, processes, continues
```

### Resume Flow

```
1. User calls POST /rhizai/{id}/jobs/{job_id}/resume
2. API traverses log chain to find error leaves
3. For each retryable error:
   a. Find parent log's invocation record
   b. Re-invoke with same request (new job_id)
   c. Update parent's invocation record
4. Return summary of resumed jobs
```

---

## API Endpoints

### Rhiza CRUD

| Method | Path | Description |
|--------|------|-------------|
| POST | /rhizai | Create a rhiza |
| GET | /rhizai/:id | Get rhiza by ID |
| PUT | /rhizai/:id | Update rhiza |
| DELETE | /rhizai/:id | Delete rhiza |

### Workflow Execution

| Method | Path | Description |
|--------|------|-------------|
| POST | /rhizai/:id/invoke | Start workflow execution |
| GET | /rhizai/:id/jobs/:job_id/status | Get workflow status |
| POST | /rhizai/:id/jobs/:job_id/resume | Resume failed workflow |

---

## Implementation Phases

### Phase 1: Types & Validation
- All type definitions
- Rhiza validation
- Cardinality consistency checks

### Phase 2: Logging
- KladosLogger (in-memory)
- writeKladosLog (to job collection)
- Log chain relationships

### Phase 3: Handoff Logic
- interpretThen()
- scatter/gather with batch entities
- route matching

### Phase 4: API Integration
- Rhiza entity profile in arke_v1
- /rhizai routes
- Modified job collection

### Phase 5: Resume
- Log chain traversal
- Error leaf detection
- Resume execution

### Phase 6: Status
- buildStatusFromLogs()
- Progress aggregation
- Status endpoint

---

## Dependencies

```json
{
  "dependencies": {
    "@arke-institute/sdk": "^2.6.2"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

No Cloudflare-specific dependencies. Runtime-agnostic.
