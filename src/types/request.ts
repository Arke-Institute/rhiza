/**
 * KladosRequest - What a klados receives when invoked (from the Arke API)
 */
export interface KladosRequest {
  /** Unique job identifier */
  job_id: string;

  /** Single entity to process (required when klados.accepts.cardinality = 'one') */
  target_entity?: string;

  /** Multiple entities to process (required when klados.accepts.cardinality = 'many') */
  target_entities?: string[];

  /** Collection for permission grant (required) */
  target_collection: string;

  /** Job collection for logs/outputs */
  job_collection: string;

  /** Optional input data */
  input?: Record<string, unknown>;

  /** Arke API base URL for callbacks */
  api_base: string;

  /** When permissions expire (ISO 8601) */
  expires_at: string;

  /** Which network (test/main) */
  network: 'test' | 'main';

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
