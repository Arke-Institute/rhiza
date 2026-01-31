# Implementation Phases

## Overview

This document outlines the implementation phases for the rhiza protocol. Each phase builds on the previous, with testable milestones.

---

## Phase 1: Package Foundation

**Goal**: Set up package structure and define all types.

### Tasks

- [ ] Initialize npm package `@arke-institute/rhiza`
- [ ] Set up TypeScript configuration
- [ ] Create directory structure
- [ ] Implement all type definitions
  - [ ] `types/rhiza.ts` - Rhiza, KladosSpec, ThenSpec
  - [ ] `types/request.ts` - KladosRequest, RhizaContext
  - [ ] `types/response.ts` - KladosResponse
  - [ ] `types/log.ts` - KladosLogEntry, HandoffRecord
  - [ ] `types/batch.ts` - BatchEntity, BatchSlot
  - [ ] `types/status.ts` - WorkflowStatus, ResumeResult
- [ ] Export all types from `index.ts`

### Deliverables

- Package compiles with `tsc`
- Types are importable: `import { Rhiza, KladosSpec } from '@arke-institute/rhiza'`

### Estimated Effort

1-2 days

---

## Phase 2: Validation

**Goal**: Implement rhiza definition validation.

### Tasks

- [ ] Implement `validateRhiza()` in `validation/validate-rhiza.ts`
  - [ ] Entry point exists
  - [ ] All targets valid
  - [ ] Has terminal
  - [ ] No cycles
- [ ] Implement `validateCardinality()` in `validation/validate-cardinality.ts`
  - [ ] Scatter requires produces many
  - [ ] Scatter target accepts one
  - [ ] Gather target accepts many
- [ ] Add validation tests

### Deliverables

- `validateRhiza(rhiza)` returns validation result
- Tests cover all validation rules

### Estimated Effort

1 day

---

## Phase 3: Logging

**Goal**: Implement log writing and chain helpers.

### Tasks

- [ ] Implement `KladosLogger` class
- [ ] Implement `writeKladosLog()` with CAS retry
- [ ] Implement `updateLogWithHandoffs()`
- [ ] Implement `updateLogStatus()`
- [ ] Implement chain traversal helpers
  - [ ] `getJobLogs()`
  - [ ] `getLogEntry()`
  - [ ] `getRootLog()`
  - [ ] `getChildLogs()`
  - [ ] `buildLogTree()`
- [ ] Add logging tests (mock ArkeClient)

### Deliverables

- Logs can be written to job collection
- Log chain can be traversed

### Estimated Effort

2 days

---

## Phase 4: Handoff Logic

**Goal**: Implement core handoff operations.

### Tasks

- [ ] Implement `interpretThen()` - main handoff router
- [ ] Implement `invokeKlados()` and `invokeRhiza()`
- [ ] Implement `buildKladosRequest()`
- [ ] Implement scatter
  - [ ] `createScatter()` - create batch, invoke N times
  - [ ] `findGatherTarget()` - trace to gather klados
- [ ] Implement gather
  - [ ] `completeBatchSlot()` - atomic slot update
  - [ ] `errorBatchSlot()` - mark slot as error
- [ ] Implement route
  - [ ] `matchRoute()` - find matching rule
  - [ ] `evaluateWhere()` - property matching
- [ ] Add handoff tests (mock ArkeClient)

### Deliverables

- All handoff types work: pass, scatter, gather, route
- Batch entities created and updated correctly

### Estimated Effort

3-4 days

---

## Phase 5: Resume

**Goal**: Implement workflow resumability.

### Tasks

- [ ] Implement `findLeaves()` - find terminal nodes
- [ ] Implement `findErrorLeaves()` - find error nodes
- [ ] Implement `findStuckJobs()` - find pending invocations with no log
- [ ] Implement `getErrorSummary()`
- [ ] Implement `resumeWorkflow()`
- [ ] Implement `resumeJob()` - resume single job
- [ ] Implement `canResume()` - check if resumable
- [ ] Add resume tests

### Deliverables

- Failed workflows can be resumed
- Error summary provides actionable information

### Estimated Effort

2 days

---

## Phase 6: Status

**Goal**: Implement status aggregation from log chain.

### Tasks

- [ ] Implement `buildStatusFromLogs()`
- [ ] Implement `calculateProgress()` - aggregate counters
- [ ] Implement simplified log chain for status response
- [ ] Add status tests

### Deliverables

- Workflow status built from log chain
- Progress counters accurate

### Estimated Effort

1 day

---

## Phase 7: API Integration (arke_v1)

**Goal**: Add rhiza support to Arke API.

### Tasks

- [ ] Create `src/profiles/rhiza/` in arke_v1
  - [ ] `types.ts`
  - [ ] `operations.ts`
  - [ ] `validation.ts`
- [ ] Create `src/routes/rhizai.ts`
  - [ ] POST /rhizai - Create
  - [ ] GET /rhizai/:id - Get
  - [ ] PUT /rhizai/:id - Update
  - [ ] POST /rhizai/:id/invoke - Invoke
  - [ ] GET /rhizai/:id/jobs/:job_id/status - Status
  - [ ] POST /rhizai/:id/jobs/:job_id/resume - Resume
- [ ] Add rhiza to entity type enum
- [ ] Add batch to entity type enum
- [ ] Add new relationship predicates
- [ ] Add rhiza permission actions
- [ ] Update job collection to support rhiza_id
- [ ] Add API tests

### Deliverables

- Rhiza CRUD works
- Rhiza invocation works
- Status and resume endpoints work

### Estimated Effort

3-4 days

---

## Phase 8: Integration Testing

**Goal**: End-to-end testing with real workflows.

### Tasks

- [ ] Create test rhiza definitions
  - [ ] Linear workflow (pass only)
  - [ ] Fan-out/fan-in workflow (scatter/gather)
  - [ ] Conditional workflow (route)
  - [ ] Nested workflow (sub-rhiza)
- [ ] Create test agents that implement klados protocol
- [ ] Run full workflow tests
- [ ] Test resume after failure
- [ ] Test concurrent scatter operations
- [ ] Performance testing with large batches

### Deliverables

- All workflow patterns tested
- Resume verified working
- Performance acceptable

### Estimated Effort

3-4 days

---

## Phase 9: Documentation

**Goal**: Document the protocol and package.

### Tasks

- [ ] Write package README
- [ ] Document all exported types
- [ ] Document all exported functions
- [ ] Create usage examples
- [ ] Create migration guide (from agent-core orchestrators)
- [ ] API documentation for new endpoints

### Deliverables

- Comprehensive documentation
- Examples for common patterns

### Estimated Effort

2 days

---

## Total Estimated Effort

| Phase | Days |
|-------|------|
| 1. Package Foundation | 1-2 |
| 2. Validation | 1 |
| 3. Logging | 2 |
| 4. Handoff Logic | 3-4 |
| 5. Resume | 2 |
| 6. Status | 1 |
| 7. API Integration | 3-4 |
| 8. Integration Testing | 3-4 |
| 9. Documentation | 2 |
| **Total** | **18-22** |

---

## Dependencies

### Package Dependencies

```json
{
  "dependencies": {
    "@arke-institute/sdk": "^2.6.2"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0"
  }
}
```

### API Dependencies

- arke_v1 must import `@arke-institute/rhiza` for types and validation
- No circular dependencies (rhiza package doesn't import arke_v1)

---

## Risk Mitigation

### Risk: CAS Contention in Scatter

**Mitigation**:
- Use exponential backoff with jitter
- Initial random delay to spread writes
- Tested with 500+ concurrent updates in agent-core

### Risk: Log Chain Query Performance

**Mitigation**:
- Index on `type: 'klados_log'` property
- Index on `received_from` relationship
- Pagination for large workflows

### Risk: Sub-Rhiza Context Complexity

**Mitigation**:
- Start with simple linear sub-rhiza
- Add scatter/gather to sub-rhiza later
- Comprehensive tests for each pattern

---

## Success Criteria

1. **Functional**: All workflow patterns work (linear, scatter/gather, route, nested)
2. **Resumable**: Failed workflows can be resumed from last successful point
3. **Observable**: Status endpoint provides accurate progress
4. **Performant**: 100+ concurrent scatter operations work
5. **Documented**: Clear documentation and examples

---

## Next Steps

1. Create the package with Phase 1 tasks
2. Get initial types reviewed
3. Implement validation (Phase 2)
4. Continue iteratively through phases
