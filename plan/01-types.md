# Type Definitions

## Overview

All types are defined in `src/types/`. This document provides the complete type definitions for the rhiza protocol.

---

## Rhiza Definition Types

### `src/types/rhiza.ts`

```typescript
/**
 * Rhiza - A workflow definition
 *
 * The root structure that defines a graph of kladoi (actions)
 * with handoff rules between them.
 */
export interface Rhiza {
  /** Unique identifier (Arke entity ID) */
  id: string;

  /** Human-readable name */
  name: string;

  /** Semantic version */
  version: string;

  /** Optional description */
  description?: string;

  /** Entry point - which klados starts the workflow */
  entry: string;

  /** All kladoi in this workflow, keyed by name */
  kladoi: Record<string, KladosSpec>;
}

/**
 * KladosSpec - Specification for a single action in the workflow
 */
export interface KladosSpec {
  /** Agent ID to invoke for this klados */
  action: string;

  /** Human-readable description */
  description?: string;

  /** Input contract - what this klados accepts */
  accepts: AcceptsSpec;

  /** Output contract - what this klados produces */
  produces: ProducesSpec;

  /** What happens after this klados completes */
  then: ThenSpec;
}

/**
 * AcceptsSpec - Input contract
 */
export interface AcceptsSpec {
  /**
   * Accepted content types
   * Use ["*"] to accept anything
   * Examples: ["file/pdf"], ["file/jpeg", "file/png"], ["*"]
   */
  types: string[];

  /**
   * Input cardinality
   * - 'one': Receives a single entity
   * - 'many': Receives multiple entities (array)
   */
  cardinality: 'one' | 'many';
}

/**
 * ProducesSpec - Output contract
 */
export interface ProducesSpec {
  /**
   * Produced content types
   * Use ["*"] to indicate dynamic types
   * Examples: ["file/jpeg"], ["text/ocr"], ["*"]
   */
  types: string[];

  /**
   * Output cardinality
   * - 'one': Produces a single entity
   * - 'many': Produces multiple entities
   */
  cardinality: 'one' | 'many';
}

/**
 * ThenSpec - Handoff specification
 *
 * Defines what happens after a klados completes.
 */
export type ThenSpec =
  | { done: true }              // Terminal - workflow ends here
  | { pass: TargetRef }         // 1:1 - pass outputs directly to next
  | { scatter: TargetRef }      // 1:N - invoke next once per output (fan-out)
  | { gather: TargetRef }       // N:1 - wait for batch, then invoke (fan-in)
  | { route: RouteRule[] };     // Conditional routing

/**
 * TargetRef - Reference to next klados or sub-rhiza
 */
export type TargetRef =
  | string                      // Local klados name: "ocr-service"
  | { rhiza: string };          // Sub-workflow: { rhiza: "IIrhiza123..." }

/**
 * RouteRule - Conditional routing rule
 */
export interface RouteRule {
  /** Condition to match */
  where: WhereCondition;

  /** What to do if condition matches (recursive) */
  then: ThenSpec;
}

/**
 * WhereCondition - Simple property-based matching
 *
 * For now, only supports equality matching on entity properties.
 * Future: Could add 'in', 'matches', 'and', 'or' operators.
 */
export interface WhereCondition {
  /** Property name to check (e.g., "type", "content_type") */
  property: string;

  /** Value to match */
  equals: string | number | boolean;
}
```

---

## Request Types

### `src/types/request.ts`

```typescript
import type { Rhiza } from './rhiza';

/**
 * KladosRequest - What a klados receives when invoked
 *
 * This extends the standard AgentJobRequest with rhiza-specific context.
 */
export interface KladosRequest {
  // ═══════════════════════════════════════════════════════════════
  // Standard job fields (same as AgentJobRequest)
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
  // Rhiza-specific context
  // ═══════════════════════════════════════════════════════════════

  /** Workflow context */
  rhiza: RhizaContext;

  /** Batch context (if part of scatter) */
  batch?: BatchContext;
}

/**
 * RhizaContext - Workflow execution context
 */
export interface RhizaContext {
  /** Rhiza entity ID */
  id: string;

  /** Full rhiza definition */
  definition: Rhiza;

  /** Current klados name (position in workflow) */
  position: string;

  /**
   * Previous log entry IDs for chain traversal
   * Most recent first: [immediate_parent, grandparent, ...]
   */
  log_chain: string[];

  /** If invoked as sub-rhiza from a parent workflow */
  parent?: ParentContext;
}

/**
 * ParentContext - Context when invoked as sub-rhiza
 */
export interface ParentContext {
  /** Parent's job collection */
  job_collection: string;

  /** Parent's rhiza ID */
  rhiza_id: string;

  /** Log entry ID that invoked us */
  invoking_log_id: string;

  /** If part of scatter from parent */
  batch_id?: string;
  batch_index?: number;

  /** What to do when we complete */
  on_complete: 'update_batch' | 'invoke_next';

  /** If on_complete === 'invoke_next', the target to invoke */
  next_target?: TargetRef;
}

/**
 * BatchContext - Context when part of scatter/gather
 */
export interface BatchContext {
  /** Batch entity ID */
  id: string;

  /** Our slot index (0-based) */
  index: number;

  /** Total slots in batch */
  total: number;

  /** Klados that receives gathered results */
  gather_target: string;
}
```

---

## Response Types

### `src/types/response.ts`

```typescript
/**
 * KladosResponse - What a klados returns after processing
 *
 * This is the internal response used by the protocol.
 * The HTTP response to Arke uses the standard agent response format.
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

### `src/types/log.ts`

```typescript
import type { KladosRequest } from './request';
import type { TargetRef } from './rhiza';

/**
 * KladosLogEntry - Log entry written by each klados
 *
 * This is the critical data structure for resumability.
 * It records everything needed to resume from this point.
 */
export interface KladosLogEntry {
  /** Log entry entity ID */
  id: string;

  /** Entity type marker */
  type: 'klados_log';

  // ═══════════════════════════════════════════════════════════════
  // Identity
  // ═══════════════════════════════════════════════════════════════

  /** Rhiza entity ID */
  rhiza_id: string;

  /** Klados name within rhiza */
  klados: string;

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

    /** Previous log entry ID (for chain traversal) */
    from_log?: string;

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
  };

  // ═══════════════════════════════════════════════════════════════
  // Error (if failed)
  // ═══════════════════════════════════════════════════════════════

  error?: {
    code: string;
    message: string;
    /** Whether this error can be retried */
    retryable: boolean;
  };

  // ═══════════════════════════════════════════════════════════════
  // Handoffs (THE KEY TO RESUMABILITY)
  // ═══════════════════════════════════════════════════════════════

  /**
   * What we handed off to next
   * This records every invocation we made, enabling resume.
   */
  handoffs?: HandoffRecord[];
}

/**
 * HandoffRecord - Record of a handoff operation
 */
export interface HandoffRecord {
  /** Handoff type */
  type: 'pass' | 'scatter' | 'gather' | 'route';

  /** Target klados name or rhiza ID */
  target: string;

  /** Whether target is a klados or rhiza */
  target_type: 'klados' | 'rhiza';

  /** Batch entity ID (if scatter) */
  batch_id?: string;

  /** All invocations we made */
  invocations: InvocationRecord[];
}

/**
 * InvocationRecord - Record of a single invocation
 *
 * Contains everything needed to retry this exact invocation.
 */
export interface InvocationRecord {
  /** Job ID we created for the invocation */
  job_id: string;

  /** Entity ID we passed as target */
  target_entity: string;

  /** Batch index (if part of scatter) */
  batch_index?: number;

  /** Current status of this invocation */
  status: 'pending' | 'done' | 'error';

  /**
   * THE RESUMABILITY DATA
   * The exact request we made, for replay on resume
   */
  request: KladosRequest;
}

/**
 * JobLog - Complete log structure written to job collection
 *
 * This wraps KladosLogEntry with file metadata.
 */
export interface JobLog {
  /** Log entry data */
  entry: KladosLogEntry;

  /** Agent info */
  agent_id: string;
  agent_version: string;

  /** Human-readable log messages */
  messages: LogMessage[];
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

### `src/types/batch.ts`

```typescript
/**
 * BatchEntity - Entity for coordinating scatter/gather
 *
 * Created by scatter, updated by each scattered klados,
 * used to trigger gather when all slots complete.
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

  /** Klados that created this batch */
  source_klados: string;

  /** Klados that receives gathered results */
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

### `src/types/status.ts`

```typescript
import type { KladosLogEntry } from './log';

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

  /** Currently executing klados (if running) */
  current_klados?: string[];

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
  /** Total kladoi expected to run */
  total: number;

  /** Kladoi not yet started */
  pending: number;

  /** Kladoi currently running */
  running: number;

  /** Kladoi completed successfully */
  done: number;

  /** Kladoi failed */
  error: number;
}

/**
 * LogChainEntry - Simplified log entry for status
 */
export interface LogChainEntry {
  log_id: string;
  klados: string;
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
  klados: string;
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
  /** Number of jobs resumed */
  resumed: number;

  /** Number of jobs skipped (not retryable) */
  skipped: number;

  /** Details of resumed jobs */
  jobs: ResumedJob[];
}

export interface ResumedJob {
  /** Original failed job ID */
  original_job_id: string;

  /** New job ID (retry) */
  new_job_id: string;

  /** Klados name */
  klados: string;

  /** Target entity */
  target: string;

  /** Original error message */
  error: string;
}
```

---

## Index Exports

### `src/types/index.ts`

```typescript
// Rhiza definition types
export type {
  Rhiza,
  KladosSpec,
  AcceptsSpec,
  ProducesSpec,
  ThenSpec,
  TargetRef,
  RouteRule,
  WhereCondition,
} from './rhiza';

// Request types
export type {
  KladosRequest,
  RhizaContext,
  ParentContext,
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
  JobLog,
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
