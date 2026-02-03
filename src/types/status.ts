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
  /** Single entity being processed (when cardinality = 'one') */
  target_entity?: string;
  /** Multiple entities being processed (when cardinality = 'many') */
  target_entities?: string[];
  /** Collection for permission scope */
  target_collection: string;
  /** Original error message */
  error: string;
}
