# Rhiza: Workflow Protocol for Arke

## Overview

**Rhiza** (Greek: ῥίζα, "root") is a workflow protocol for orchestrating distributed actions in the Arke ecosystem. It replaces centralized orchestrators with a **cascading handoff pattern** where actions invoke each other directly.

### Naming

- **Klados** (κλάδος, "branch") = Individual action, a standalone executable unit
- **Rhiza** (ῥίζα, "root") = Workflow, a composition of kladoi with flow logic

This pairing has biblical attestation (Romans 11:16) and maps cleanly to our concepts:
- Klados = a reusable, composable action that can be invoked standalone or as part of workflows
- Rhiza = the workflow structure that orchestrates kladoi

### Key Principles

1. **Composable actions** - Kladoi are first-class entities, reusable across workflows
2. **Push-based execution** - Actions invoke next actions directly (no polling orchestrator)
3. **Log chain as state** - The execution log IS the state machine (no separate state store)
4. **Perfect resumability** - Every handoff records the exact request for replay
5. **Runtime-agnostic** - The protocol works with any execution environment

---

## Entity Model

### Klados (Action)

A klados is a **standalone, reusable action**. It knows HOW to do something, but not WHAT comes next.

```typescript
{
  id: 'II01klados_ocr...',
  type: 'klados',
  properties: {
    label: 'OCR Service',
    description: 'Extracts text from images',
    endpoint: 'https://ocr.arke.institute',
    actions_required: ['file:view', 'entity:update'],
    accepts: { types: ['file/jpeg'], cardinality: 'one' },
    produces: { types: ['text/ocr'], cardinality: 'one' },
    status: 'active',
  }
}
```

### Rhiza (Workflow)

A rhiza **composes kladoi** into a flow. It defines WHAT happens, in WHAT order.

```typescript
{
  id: 'II01rhiza_pdf...',
  type: 'rhiza',
  properties: {
    label: 'PDF Processing Pipeline',
    version: '1.0',
    entry: 'II01klados_pdf...',
    flow: {
      'II01klados_pdf...': { then: { scatter: 'II01klados_ocr...' } },
      'II01klados_ocr...': { then: { gather: 'II01klados_assembler...' } },
      'II01klados_assembler...': { then: { done: true } },
    },
    status: 'active',
  }
}
```

---

## API Endpoints

### Klados Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /kladoi | Create a klados |
| GET | /kladoi/:id | Get klados by ID |
| PUT | /kladoi/:id | Update klados |
| DELETE | /kladoi/:id | Delete klados |
| POST | /kladoi/:id/invoke | Invoke klados (standalone) |
| GET | /kladoi/:id/jobs/:job_id/status | Get job status |

### Rhiza Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /rhizai | Create a rhiza |
| GET | /rhizai/:id | Get rhiza by ID |
| PUT | /rhizai/:id | Update rhiza |
| DELETE | /rhizai/:id | Delete rhiza |
| POST | /rhizai/:id/invoke | Invoke rhiza (workflow) |
| GET | /rhizai/:id/jobs/:job_id/status | Get workflow status |
| POST | /rhizai/:id/jobs/:job_id/resume | Resume failed workflow |

---

## Invocation Flow

### Standalone Klados Invocation

A klados can be invoked directly, without a workflow:

```
User → POST /kladoi/:id/invoke (no job_collection, no rhiza_context)
         │
         ├── API validates klados is active
         ├── API shows confirmation (grants preview)
         │
User → POST /kladoi/:id/invoke (confirm: true)
         │
         ├── API grants permissions to klados on target
         ├── API creates job collection
         └── API invokes klados endpoint
                  │
                  ▼
         Klados executes
         No rhiza context → done after processing
```

### Starting a Workflow

```
User → POST /rhizai/:id/invoke
         │
         ├── API loads rhiza definition
         ├── API loads all kladoi in flow (runtime validation)
         ├── API grants permissions to all kladoi
         ├── API creates job collection
         └── API calls POST /kladoi/{entry}/invoke
              │     (with job_collection + rhiza_context)
              │
              ▼
         Entry klados executes...
```

### Klados-to-Klados Handoff

```
Klados A executes
         │
         ├── Process input → produce outputs
         ├── Write log entry
         ├── Look up flow[my_id].then
         └── Call POST /kladoi/{next}/invoke
              │     (with job_collection + rhiza_context)
              │
              ▼
         Klados B executes...
```

### Sub-Workflow Invocation

```
Klados sees: then: { rhiza: 'II01rhiza_sub...' }
         │
         └── Call POST /rhizai/{sub}/invoke
                  │
                  ├── Creates NEW job collection (nested)
                  ├── Grants permissions to sub-workflow kladoi
                  └── Invokes sub-workflow entry klados
```

### Invocation Mode Summary

| Endpoint | Mode | job_collection | rhiza_context | Who Creates Job Collection |
|----------|------|----------------|---------------|---------------------------|
| `/kladoi/:id/invoke` | Standalone | Not provided | Not provided | API |
| `/kladoi/:id/invoke` | Workflow | Provided | Provided | Rhiza invoke |
| `/rhizai/:id/invoke` | Workflow | N/A (creates new) | N/A (creates new) | API |

---

## Handoff Types

| Type | Description | Use Case |
|------|-------------|----------|
| `pass` | 1:1 direct handoff | Simple chaining |
| `scatter` | 1:N fan-out (creates batch) | Parallel processing |
| `gather` | N:1 fan-in (completes batch) | Aggregation |
| `route` | Conditional by property | Type-based routing |
| `rhiza` | Invoke sub-workflow | Nested workflows |
| `done` | Terminal | End of workflow |

---

## Package Structure

```
/Users/chim/Working/arke_institute/rhiza/
├── plan/                         # Planning documentation
│   ├── README.md                 # Overview (this file)
│   ├── 01-types.md              # Type definitions
│   ├── 02-validation.md         # Validation rules
│   ├── 03-handoff.md            # Handoff logic
│   ├── 04-logging.md            # Logging and chain
│   ├── 05-resume.md             # Resumability
│   ├── 06-api-changes.md        # arke_v1 API changes
│   ├── 07-implementation.md     # Implementation phases
│   └── 08-test-plan.md          # Test plan
│
├── src/
│   ├── types/                   # Type definitions
│   ├── validation/              # Rhiza validation
│   ├── handoff/                 # Handoff logic
│   ├── logging/                 # Log writing and chain
│   ├── resume/                  # Resumability
│   ├── status/                  # Status building
│   └── index.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## Dependencies

```json
{
  "dependencies": {
    "@arke-institute/sdk": "^2.6.2"
  }
}
```

No Cloudflare-specific dependencies. Runtime-agnostic.
