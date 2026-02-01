# Type Definitions

## Overview

All types are defined in `src/types/`. This document provides the complete type definitions for the rhiza protocol.

---

## Entity Types

NOTE: it should be emphasized both of these things are just entities on the arke knowledge graph. The implementation of klados need be hosted somewhere at some kind of endpoint, of course, but the entities are on arke.

### Klados Entity

A klados is a **standalone, reusable action**. It knows HOW to do something, but not WHAT comes next.

```typescript
// src/types/klados.ts

/**
 * KladosEntity - A standalone action entity
 *
 * Kladoi are first-class entities that can be:
 * - Invoked directly via POST /kladoi/:id/invoke (only invokeable via the Arke API (not directly) recuires verification/credentialing flow just like the current agent system)
 * - Composed into workflows (rhizai)
 * - Reused across multiple rhizai 
 */
export interface KladosEntity {
  /** Unique identifier (Arke entity ID) */
  id: string;

  /** Entity type */
  type: 'klados';

  properties: KladosProperties;

  relationships?: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
    peer_label?: string;
    properties?: Record<string, unknown>;
  }>;
}

export interface KladosProperties {
  /** Human-readable name */
  label: string;

  /** Description of what this klados does */
  description?: string;

  /** Endpoint URL where this klados is deployed */
  endpoint: string;

  /** Permissions required on target collection */
  actions_required: string[];

  /** Input contract - what this klados accepts */
  accepts: ContractSpec;

  /** Output contract - what this klados produces */
  produces: ContractSpec;

  /** Optional JSON Schema for additional input parameters */
  input_schema?: Record<string, unknown>;

  /** Status */
  status: 'development' | 'active' | 'disabled';

  /** When endpoint was verified */
  endpoint_verified_at?: string;

  /** Timestamps */
  created_at?: string;
  updated_at?: string;
}

/**
 * ContractSpec - Input/output contract
 */
export interface ContractSpec {
  /**
   * Accepted/produced content types
   * Use ["*"] to accept/produce anything
   * Examples: ["file/pdf"], ["file/jpeg", "file/png"], ["*"]
   */
  types: string[];

  /**
   * Cardinality
   * - 'one': Single entity
   * - 'many': Multiple entities (array)
   */
  cardinality: 'one' | 'many';
}
```

### Rhiza Entity

Note: we should type anyhting that is an arke ID with a type check for it being a valid arke id this should be a utility function that's imported from the sdk

A rhiza **composes kladoi** into a flow. It defines WHAT happens, in WHAT order.

```typescript
// src/types/rhiza.ts

/**
 * RhizaEntity - A workflow entity
 *
 * Rhizai compose kladoi into executable workflows.
 * They define the flow (what klados invokes what next).
 */
export interface RhizaEntity {
  /** Unique identifier (Arke entity ID) */
  id: string;

  /** Entity type */
  type: 'rhiza';

  properties: RhizaProperties;

  relationships?: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
    peer_label?: string;
    properties?: Record<string, unknown>;
  }>;
}

export interface RhizaProperties {
  /** Human-readable name */
  label: string;

  /** Description of what this workflow does */
  description?: string;

  /** Semantic version */
  version: string;

  /** Entry point - klados ID that starts the workflow */
  entry: string;

  /** Flow definition - what happens after each klados */
  flow: Record<string, FlowStep>;

  /** Status */
  status: 'development' | 'active' | 'disabled';

  /** Timestamps */
  created_at?: string;
  updated_at?: string;
}

/**
 * FlowStep - What happens after a klados completes
 */
export interface FlowStep {
  /** Handoff specification */
  then: ThenSpec;
}

/**
 * ThenSpec - Handoff specification
 *
 * Three core operations: pass, scatter, gather (+ done for terminal)
 * - Target can be klados ID or rhiza ID (discovered at runtime)
 * - Route conditions can be added to any operation via `route` array
 */
export type ThenSpec =
  | { done: true }                                    // Terminal - workflow ends
  | { pass: string; route?: RouteRule[] }            // 1:1 - target ID (klados or rhiza)
  | { scatter: string; route?: RouteRule[] }         // 1:N fan-out - target ID
  | { gather: string; route?: RouteRule[] };         // N:1 fan-in - target ID

/**
 * RouteRule - Conditional routing rule
 *
 * Routes are evaluated in order. First matching rule wins.
 * If no rule matches, the default target (pass/scatter/gather value) is used.
 */
export interface RouteRule {
  /** Condition to match (supports AND/OR logic) */
  where: WhereCondition;

  /** Target ID if condition matches (overrides default) */
  target: string;
}

/**
 * WhereCondition - Property-based matching with AND/OR logic
 *
 * Examples:
 * - Simple: { property: "type", equals: "File" }
 * - AND: { and: [{ property: "type", equals: "File" }, { property: "file_type", equals: "image/jpeg" }] }
 * - OR: { or: [{ property: "file_type", equals: "image/jpeg" }, { property: "file_type", equals: "image/png" }] }
 */
export type WhereCondition =
  | WhereEquals
  | WhereAnd
  | WhereOr;

export interface WhereEquals {
  /** Property name to check (e.g., "type", "content_type") */
  property: string;
  /** Value to match */
  equals: string | number | boolean;
}

export interface WhereAnd {
  /** All conditions must match */
  and: WhereCondition[];
}

export interface WhereOr {
  /** Any condition must match */
  or: WhereCondition[];
}

---

## Request Types

### Klados Request

What a klados receives when invoked.

// should mention here that the headers (i believe) should include the verification signature from the arke api (public-private key)

```typescript
// src/types/request.ts

/**
 * KladosRequest - What a klados receives when invoked (from the Arke API)
 */
export interface KladosRequest {
  // ═══════════════════════════════════════════════════════════════
  // Standard job fields
  // ═══════════════════════════════════════════════════════════════

  /** Unique job identifier */
  job_id: string;

  /** Target entity/collection to process */
  target: string;

  /** Job collection for logs */
  job_collection: string;

  /** Optional input data */
  input?: Record<string, unknown>;

  /** Arke API base URL for callbacks */
  api_base: string;

  /** When permissions expire (ISO 8601) */
  expires_at: string;

  /** Which network (test/main) */
  network: 'test' | 'main';

  // ═══════════════════════════════════════════════════════════════
  // Workflow context (present when invoked as part of a rhiza)
  // ═══════════════════════════════════════════════════════════════

  /** Workflow context - present when invoked via rhiza */
  rhiza?: RhizaContext;
}

/**
 * RhizaContext - Workflow execution context
 *
 * The context passed to a klados when invoked as part of a workflow.
 * Uses path-based tracking to handle multiple mentions of the same klados.
 */
export interface RhizaContext {
  /** Rhiza entity ID */
  id: string;

  /**
   * Path that got us here - sequence of klados IDs from entry to current
   * This solves the problem of multiple mentions of the same klados:
   * we know which instance we are by our position in the path.
   *
   * Example: ['II01klados_pdf...', 'II01klados_ocr...']
   * The current klados looks up its position to find what to do next.
   */
  path: string[];

  /**
   * Immediate parent log entry ID(s)
   * - For pass/scatter: single parent ID
   * - For gather: array of all parent sibling IDs (fan-in)
   *
   * Children create log entries pointing back to these parents.
   * No parent updates needed (fire-and-forget).
   */
  parent_logs: string[];

  /**
   * Batch context - present when part of scatter/gather
   * Only exists within workflow context (no standalone batching)
   */
  batch?: BatchContext;
}

/**
 * BatchContext - Context when part of scatter/gather
 *
 * Note: gather_target is NOT included here - it's in the workflow definition.
 * The klados looks up what to do next from the rhiza flow.
 */
export interface BatchContext {
  /** Batch entity ID */
  id: string;

  /** Our slot index (0-based) */
  index: number;

  /** Total slots in batch */
  total: number;
}
```

---

## Response Types

```typescript
// src/types/response.ts

/**
 * KladosResponse - What a klados returns after accepting/rejecting
 */
export interface KladosResponse {
  /** Whether the klados accepted the job */
  accepted: boolean;

  /** Job ID (must match request) */
  job_id: string;

  /** Error message if rejected */
  error?: string;

  /** Retry delay in seconds (for transient errors) */
  retry_after?: number;
}

/**
 * KladosResult - Final result after klados completes
 */
export interface KladosResult {
  /** Completion status */
  status: 'done' | 'error';

  /** Produced entity IDs (if done) */
  outputs?: string[];

  /** Error details (if error) */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };

  /** Optional result metadata */
  metadata?: Record<string, unknown>;
}
```

---

## Log Types

```typescript
// src/types/log.ts

import type { KladosRequest } from './request';

/**
 * KladosLogEntry - Log entry written by each klados
 *
 * This is the critical data structure for resumability.
 */
export interface KladosLogEntry {
  /** Log entry entity ID */
  id: string;

  /** Entity type marker */
  type: 'klados_log';

  // ═══════════════════════════════════════════════════════════════
  // Identity
  // ═══════════════════════════════════════════════════════════════

  /** Klados entity ID */
  klados_id: string;

  /** Rhiza entity ID (if part of workflow) */
  rhiza_id?: string;

  /** Job ID */
  job_id: string;

  // ═══════════════════════════════════════════════════════════════
  // Timing
  // ═══════════════════════════════════════════════════════════════

  /** When processing started (ISO 8601) */
  started_at: string;

  /** When processing completed (ISO 8601) */
  completed_at?: string;

  // ═══════════════════════════════════════════════════════════════
  // Status
  // ═══════════════════════════════════════════════════════════════

  /** Current status */
  status: 'running' | 'done' | 'error';

  // ═══════════════════════════════════════════════════════════════
  // Input (what we received)
  // ═══════════════════════════════════════════════════════════════

  received: {
    /** Entity ID(s) we processed */
    target: string | string[];

    /**
     * Previous log entry ID(s) for chain traversal
     * - Single ID for pass/scatter
     * - Multiple IDs for gather (all parent siblings)
     * Also stored as relationships on the log entity.
     */
    from_logs?: string[];

    /** Batch context if part of scatter */
    batch?: {
      id: string;
      index: number;
      total: number;
    };
  };

  // ═══════════════════════════════════════════════════════════════
  // Output (what we produced)
  // ═══════════════════════════════════════════════════════════════

  /** Produced entity IDs (if done) */
  produced?: {
    entity_ids: string[];
    /** Optional metadata about what was produced */
    metadata?: Record<string, unknown>;
  };

  // ═══════════════════════════════════════════════════════════════
  // Error (if failed)
  // ═══════════════════════════════════════════════════════════════

  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };

  // ═══════════════════════════════════════════════════════════════
  // Handoffs (THE KEY TO RESUMABILITY)
  // ═══════════════════════════════════════════════════════════════

  handoffs?: HandoffRecord[];
}

/**
 * HandoffRecord - Record of a handoff operation
 *
 * Three core types: pass, scatter, gather
 * Target can be klados or rhiza (discovered at invocation time)
 */
export interface HandoffRecord {
  /** Handoff type (core operations only) */
  type: 'pass' | 'scatter' | 'gather';

  /** Target ID (klados or rhiza) */
  target: string;

  /** Whether target is a klados or rhiza (discovered at invocation) */
  target_type: 'klados' | 'rhiza';

  /** Batch entity ID (if scatter) */
  batch_id?: string;

  /** All invocations we made (fire-and-forget) */
  invocations: InvocationRecord[];
}

/**
 * InvocationRecord - Record of a single invocation
 *
 * Fire-and-forget: we record what we sent, not the result.
 * The invoked klados creates its own log entry pointing back to us.
 */
export interface InvocationRecord {
  /** The exact request we made (for replay on resume) */
  request: KladosRequest;

  /** Batch index (if part of scatter) */
  batch_index?: number;
}

/**
 * LogMessage - Human-readable log message
 */
export interface LogMessage {
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

---

## Batch Types

```typescript
// src/types/batch.ts

/**
 * BatchEntity - Entity for coordinating scatter/gather
 */
export interface BatchEntity {
  /** Entity ID */
  id: string;

  /** Entity type */
  type: 'batch';

  properties: BatchProperties;
}

export interface BatchProperties {
  /** Rhiza entity ID */
  rhiza_id: string;

  /** Job ID */
  job_id: string;

  /** Klados ID that created this batch */
  source_klados: string;

  /** Klados ID that receives gathered results */
  gather_klados: string;

  /** Total number of slots */
  total: number;

  /** Number of completed slots */
  completed: number;

  /** Overall batch status */
  status: 'pending' | 'complete' | 'error';

  /** Individual slot states */
  slots: BatchSlot[];

  /** When batch was created (ISO 8601) */
  created_at: string;

  /** When batch completed (ISO 8601) */
  completed_at?: string;
}

/**
 * BatchSlot - State of a single slot in the batch
 */
export interface BatchSlot {
  /** Slot index (0-based) */
  index: number;

  /** Slot status */
  status: 'pending' | 'complete' | 'error';

  /** Output entity IDs (if complete) */
  output_ids?: string[];

  /** Job ID that processed this slot */
  job_id?: string;

  /** When slot completed (ISO 8601) */
  completed_at?: string;

  /** Error info (if error) */
  error?: {
    code: string;
    message: string;
  };
}
```

---

## Status Types

```typescript
// src/types/status.ts

/**
 * WorkflowStatus - Overall workflow execution status
 */
export interface WorkflowStatus {
  /** Job ID */
  job_id: string;

  /** Rhiza entity ID */
  rhiza_id: string;

  /** Overall status */
  status: 'pending' | 'running' | 'done' | 'error';

  /** Progress counters */
  progress: ProgressCounters;

  /** Currently executing kladoi (if running) */
  current_kladoi?: string[];

  /** Simplified log chain for debugging */
  log_chain: LogChainEntry[];

  /** Error leaves (if any) */
  errors?: ErrorSummary[];

  /** Timing */
  started_at: string;
  completed_at?: string;
}

/**
 * ProgressCounters - Aggregated progress
 */
export interface ProgressCounters {
  total: number;
  pending: number;
  running: number;
  done: number;
  error: number;
}

/**
 * LogChainEntry - Simplified log entry for status
 */
export interface LogChainEntry {
  log_id: string;
  klados_id: string;
  status: 'running' | 'done' | 'error';
  started_at: string;
  completed_at?: string;
  children?: LogChainEntry[];
}

/**
 * ErrorSummary - Summary of an error leaf
 */
export interface ErrorSummary {
  log_id: string;
  klados_id: string;
  job_id: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

/**
 * ResumeResult - Result of resume operation
 */
export interface ResumeResult {
  resumed: number;
  skipped: number;
  jobs: ResumedJob[];
}

/**
 * ResumedJob - Record of a job that was resumed
 *
 * Resume creates a NEW job_id for the retry attempt. The original job_id
 * remains in the log chain for audit trail. The new job's log entry will
 * point back to the failed log entry, maintaining the chain.
 */
export interface ResumedJob {
  /** Original failed job ID */
  original_job_id: string;
  /** New job ID for the retry */
  new_job_id: string;
  /** Klados that is being retried */
  klados_id: string;
  /** Target entity/entities being processed */
  target: string | string[];
  /** Original error message */
  error: string;
}
```

---

## Index Exports

```typescript
// src/types/index.ts

// Klados entity types
export type {
  KladosEntity,
  KladosProperties,
  ContractSpec,
} from './klados';

// Rhiza entity types
export type {
  RhizaEntity,
  RhizaProperties,
  FlowStep,
  ThenSpec,
  RouteRule,
  WhereCondition,
  WhereEquals,
  WhereAnd,
  WhereOr,
} from './rhiza';

// Request types
export type {
  KladosRequest,
  RhizaContext,
  BatchContext,
} from './request';

// Response types
export type {
  KladosResponse,
  KladosResult,
} from './response';

// Log types
export type {
  KladosLogEntry,
  HandoffRecord,
  InvocationRecord,
  LogMessage,
} from './log';

// Batch types
export type {
  BatchEntity,
  BatchProperties,
  BatchSlot,
} from './batch';

// Status types
export type {
  WorkflowStatus,
  ProgressCounters,
  LogChainEntry,
  ErrorSummary,
  ResumeResult,
  ResumedJob,
} from './status';
```
