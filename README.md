# @arke-institute/rhiza

Workflow protocol for Arke - a cascading handoff pattern for distributed actions.

## Naming

- **Rhiza** (Greek: ῥίζα, "root") - A workflow definition, the root structure that branches out
- **Klados** (Greek: κλάδος, "branch") - An individual action/branch within a workflow

From Romans 11:16: *"εἰ … ἡ ῥίζα ἁγία, καὶ οἱ κλάδοι …"* ("if the root is holy, so are the branches")

## Overview

Rhiza replaces centralized orchestrators with a **cascading handoff pattern** where actions invoke each other directly. Key features:

- **Push-based execution** - Actions invoke next actions (no polling orchestrator)
- **Log chain as state** - The execution log IS the state machine
- **Perfect resumability** - Every handoff records the exact request for replay
- **Runtime-agnostic** - Works with Cloudflare Workers, AWS Lambda, Node.js, etc.

## Installation

```bash
npm install @arke-institute/rhiza
```

## Quick Example

### Define a Workflow

```typescript
import type { Rhiza } from '@arke-institute/rhiza';

const pdfWorkflow: Rhiza = {
  id: 'pdf-workflow',
  name: 'PDF Processing Pipeline',
  version: '1.0',
  entry: 'pdf-processor',

  kladoi: {
    'pdf-processor': {
      action: 'II01abc...',  // Agent ID
      accepts: { types: ['file/pdf'], cardinality: 'one' },
      produces: { types: ['file/jpeg'], cardinality: 'many' },
      then: { scatter: 'ocr-service' },
    },
    'ocr-service': {
      action: 'II01def...',
      accepts: { types: ['file/jpeg'], cardinality: 'one' },
      produces: { types: ['text/ocr'], cardinality: 'one' },
      then: { gather: 'text-assembler' },
    },
    'text-assembler': {
      action: 'II01ghi...',
      accepts: { types: ['text/ocr'], cardinality: 'many' },
      produces: { types: ['file/text'], cardinality: 'one' },
      then: { done: true },
    },
  },
};
```

### Validate

```typescript
import { validateRhiza } from '@arke-institute/rhiza';

const result = validateRhiza(pdfWorkflow);
if (!result.valid) {
  console.error('Errors:', result.errors);
}
```

### Handle Handoffs (in a Klados implementation)

```typescript
import { interpretThen, writeKladosLog } from '@arke-institute/rhiza';

// After processing...
const handoffResult = await interpretThen(
  client,
  context.rhiza,
  kladosSpec,
  outputEntityIds,
  logEntryId
);

// Write log with handoff records
await writeKladosLog({
  client,
  jobCollectionId: context.job_collection,
  entry: {
    // ... log entry data
    handoffs: handoffResult.handoffRecord ? [handoffResult.handoffRecord] : undefined,
  },
  messages: logger.getMessages(),
  agentId,
  agentVersion,
});
```

### Resume Failed Workflow

```typescript
import { resumeWorkflow, getErrorSummary } from '@arke-institute/rhiza';

// Check status
const summary = await getErrorSummary(client, jobCollectionId);
console.log(`${summary.retryableErrors} errors can be retried`);

// Resume
const result = await resumeWorkflow(client, jobCollectionId);
console.log(`Resumed ${result.resumed} jobs`);
```

## Handoff Types

| Type | Description | Example |
|------|-------------|---------|
| `pass` | 1:1 direct handoff | `{ pass: 'next-klados' }` |
| `scatter` | 1:N fan-out (parallel) | `{ scatter: 'worker-klados' }` |
| `gather` | N:1 fan-in (collect) | `{ gather: 'aggregator-klados' }` |
| `route` | Conditional routing | `{ route: [{ where: {...}, then: {...} }] }` |
| `done` | Terminal | `{ done: true }` |

## Documentation

See the `plan/` directory for detailed documentation:

- [01-types.md](plan/01-types.md) - Type definitions
- [02-validation.md](plan/02-validation.md) - Validation rules
- [03-handoff.md](plan/03-handoff.md) - Handoff logic
- [04-logging.md](plan/04-logging.md) - Logging and chain
- [05-resume.md](plan/05-resume.md) - Resumability
- [06-api-changes.md](plan/06-api-changes.md) - API integration
- [07-implementation.md](plan/07-implementation.md) - Implementation phases

## License

MIT
