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

## Quick Start

Build a klados worker in ~15 lines with `KladosJob`:

```typescript
import { KladosJob, type KladosRequest } from '@arke-institute/rhiza';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const req = await request.json<KladosRequest>();

    const job = KladosJob.accept(req, {
      agentId: env.AGENT_ID,
      agentVersion: env.AGENT_VERSION,
      authToken: env.ARKE_AGENT_KEY,
    });

    ctx.waitUntil(job.run(async () => {
      job.log.info('Processing');
      const target = await job.fetchTarget();
      const outputs = await processEntity(target, job.client);
      return outputs;  // Job handles handoff + log finalization
    }));

    return Response.json(job.acceptResponse);
  }
};
```

`KladosJob` handles:
- Client setup with correct auth
- Initial log entry creation
- Workflow handoffs (`interpretThen`)
- Error handling (log + batch slot updates)
- Log finalization

See the full [Klados Worker Guide](docs/klados-worker-guide.md) for details.

## Validation

```typescript
import { validateRhizaProperties, validateKladosProperties } from '@arke-institute/rhiza';

const result = validateRhizaProperties(rhizaEntity.properties);
if (!result.valid) {
  console.error('Errors:', result.errors);
  console.warn('Warnings:', result.warnings);
}
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

### Guides

- **[Klados Worker Guide](docs/klados-worker-guide.md)** - Building workers with KladosJob
- **[Klados Match Criteria](docs/KLADOS_MATCH_CRITERIA.md)** - Defining when your klados applies to an entity

### Design Documents

See the `plan/` directory for detailed design documentation:

- [01-types.md](plan/01-types.md) - Type definitions
- [02-validation.md](plan/02-validation.md) - Validation rules
- [03-handoff.md](plan/03-handoff.md) - Handoff logic
- [04-logging.md](plan/04-logging.md) - Logging and chain
- [05-resume.md](plan/05-resume.md) - Resumability
- [14-simplification.md](plan/14-simplification.md) - KladosJob design

## License

MIT
