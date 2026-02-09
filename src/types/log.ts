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

  /** Klados entity ID */
  klados_id: string;

  /** Rhiza entity ID (if part of workflow) */
  rhiza_id?: string;

  /** Job ID */
  job_id: string;

  /** When processing started (ISO 8601) */
  started_at: string;

  /** When processing completed (ISO 8601) */
  completed_at?: string;

  /** Current status */
  status: 'running' | 'done' | 'error';

  /** Input (what we received) */
  received: {
    /** Single entity ID we processed (when cardinality = 'one') */
    target_entity?: string;

    /** Multiple entity IDs we processed (when cardinality = 'many') */
    target_entities?: string[];

    /** Collection for permission scope */
    target_collection: string;

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

    /** The invocation record that created this job (for resume) */
    invocation?: InvocationRecord;
  };

  /** Produced entity IDs (if done) */
  produced?: {
    entity_ids: string[];
    /** Optional metadata about what was produced */
    metadata?: Record<string, unknown>;
  };

  /** Error (if failed) */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };

  /** Handoffs (THE KEY TO RESUMABILITY) */
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
  invocations?: InvocationRecord[];

  /** Whether scatter was delegated to scatter-utility */
  delegated?: boolean;

  /** Dispatch ID from scatter-utility (if delegated) */
  dispatch_id?: string;
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

/**
 * JobLog - Full log structure written to file
 */
export interface JobLog {
  entry: KladosLogEntry;
  agent_id: string;
  agent_version: string;
  messages: LogMessage[];
}
