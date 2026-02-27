# CLAUDE.md - Project Instructions for Claude

> **See also:** `../CLAUDE.md` for workspace overview, `../tasks/lessons.md` for all lessons, `../docs/` for shared documentation.

This is `@arke-institute/rhiza`, a TypeScript library for the Arke workflow protocol.

## Project Overview

Rhiza implements a **cascading handoff pattern** for distributed workflows where actions (kladoi) invoke each other directly rather than being orchestrated centrally. The library provides:

- **Types** - Entity types, request/response types, log types
- **Validation** - Pure validation functions for klados/rhiza properties
- **Handoff Logic** - Route matching, target resolution, scatter/gather transforms
- **SDK Utilities** - Invocation, logging, and orchestration (requires `@arke-institute/sdk`)
- **Worker Utilities** - `KladosJob` class for simplified worker implementation

## Key Concepts

- **Rhiza** (ῥίζα, "root") - A workflow definition entity
- **Klados** (κλάδος, "branch") - An individual action/agent in a workflow
- **Handoff** - How one klados passes work to the next (pass, scatter, gather, done)
- **Log Chain** - Execution state stored as linked log entries (no central state)

## Project Structure

```
src/
├── types/           # Type definitions (pure, no dependencies)
│   ├── klados.ts    # Klados entity types
│   ├── rhiza.ts     # Rhiza entity and flow types
│   ├── request.ts   # KladosRequest, RhizaContext, BatchContext
│   ├── response.ts  # KladosResponse types
│   ├── log.ts       # Log entry and handoff record types
│   ├── batch.ts     # Batch entity for scatter/gather
│   └── refs.ts      # EntityRef type and helpers
├── validation/      # Pure validation functions
│   ├── validate-klados.ts
│   └── validate-rhiza.ts
├── handoff/         # Handoff logic and SDK utilities
│   ├── route.ts     # evaluateWhere, matchRoute (pure)
│   ├── target.ts    # resolveTarget (pure)
│   ├── scatter.ts   # findGatherTarget (pure)
│   ├── gather.ts    # completeBatchSlot, errorBatchSlot (pure transforms)
│   ├── invoke.ts    # invokeKlados, invokeRhiza (SDK)
│   ├── scatter-api.ts  # createScatterBatch (SDK)
│   ├── gather-api.ts   # completeBatchSlotWithCAS (SDK)
│   └── interpret.ts    # interpretThen orchestrator (SDK)
├── logging/         # Logging utilities
│   ├── logger.ts    # KladosLogger (in-memory collector)
│   └── writer.ts    # writeKladosLog, updateLogStatus (SDK)
├── worker/          # High-level worker utilities
│   ├── job.ts       # KladosJob class
│   └── errors.ts    # KladosErrorCode, failKlados
├── utils/
│   └── id.ts        # generateId()
└── index.ts         # Public exports
```

## Commands

```bash
npm run build      # TypeScript compilation
npm test           # Run vitest in watch mode
npm run test:run   # Run tests once
npm run type-check # Type check without emitting
npm run clean      # Remove dist/
```

## Architecture Notes

### Pure vs SDK-dependent Code

- Files in `types/`, `validation/`, and pure `handoff/` functions have NO dependencies
- Files using SDK (`invoke.ts`, `*-api.ts`, `interpret.ts`, `writer.ts`, `job.ts`) require `@arke-institute/sdk` as peer dependency
- SDK is optional - types and pure validation work without it

### Fire-and-Forget Pattern

The library uses a fire-and-forget invocation model:
- Klados invokes next target and immediately returns
- No waiting for downstream completion
- State is reconstructed from log chain when needed
- Children point to parents via `received.from_logs` (parents don't update)

### CAS Retry for Batch Operations

Scatter/gather uses Compare-And-Swap with retry for concurrent slot updates:
- `withCasRetry` from SDK handles optimistic concurrency
- Batch slots are updated atomically
- Last slot to complete triggers gather target

## Testing

Tests are in `src/__tests__/unit/`. Run with `npm test`.

- Tests use vitest
- No mocking of SDK in unit tests - SDK-dependent code tested via integration tests
- Pure functions have comprehensive unit tests

## Key Files to Understand

1. `src/worker/job.ts` - The main abstraction for building workers
2. `src/handoff/interpret.ts` - Core handoff orchestration logic
3. `src/types/request.ts` - What a klados receives when invoked
4. `src/types/rhiza.ts` - Workflow definition structure
5. `docs/klados-worker-guide.md` - Usage documentation

## Conventions

- Use `EntityRef` (`{ id: string, type?: 'klados' | 'rhiza' }`) for targets, not raw strings
- Error codes use `KladosErrorCode` constants with default retryability
- Log IDs are prefixed with `log_`, batch IDs with `batch_`
- All timestamps are ISO 8601 strings
- Network is always `'test'` or `'main'`

## Common Tasks

### Adding a new handoff type

1. Add type to `ThenSpec` in `src/types/rhiza.ts`
2. Add handler in `src/handoff/interpret.ts`
3. Update validation in `src/validation/validate-rhiza.ts`
4. Add tests

### Modifying KladosJob

The job lifecycle is: `accepted` → `started` → `completed`/`failed`
- `accept()` - Creates job, client, logger, generates log ID
- `start()` - Writes initial log entry, fetches rhiza flow, adds `first_log` relationship if no parent
- `complete()` - Executes handoff, adds `final_output` relationship if terminal (`done`), updates log
- `fail()` - Updates log status AND batch slot (if applicable)

**Job Collection Relationships:**
- `first_log` - Added when log has no parent (entry point)
- `final_output` - Added when handoff is `done` or no `then` spec (successful terminal)
- `final_error` - Added when job fails (failed terminal - no handoff will happen)

## Dependencies

- **Peer**: `@arke-institute/sdk ^2.9.0` (optional, needed for SDK utilities)
- **Dev**: TypeScript, vitest

## Publishing

```bash
npm run build && npm publish --access public
```

Requires npm login with access to `@arke-institute` scope.
