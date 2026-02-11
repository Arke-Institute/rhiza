/**
 * Type definitions for klados testing utilities
 */

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for the test client
 */
export interface TestConfig {
  /** Arke API base URL */
  apiBase: string;
  /** User API key (uk_...) for authentication */
  userKey: string;
  /** Network to operate on ('test' or 'main') */
  network: 'test' | 'main';
}

// =============================================================================
// Entity Types
// =============================================================================

/**
 * A generic Arke entity
 */
export interface Entity {
  id: string;
  type: string;
  cid: string;
  properties: Record<string, unknown>;
  relationships?: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
    // Note: GET /entities/{id} only returns outgoing relationships,
    // so no direction field is included.
  }>;
}

/**
 * A collection entity
 */
export interface Collection {
  id: string;
  type: 'collection';
  cid: string;
  properties: {
    label: string;
    description?: string;
    allowed_types?: string[];
  };
}

/**
 * Response from /collections/{id}/entities endpoint
 */
export interface CollectionEntities {
  collection_id: string;
  entities: Array<{
    pi: string;
    type: string;
    label: string;
  }>;
}

// =============================================================================
// Klados Types
// =============================================================================

/**
 * Result of invoking a klados
 */
export interface InvokeResult {
  status: 'started' | 'rejected' | 'pending_confirmation';
  job_id?: string;
  job_collection?: string;
  klados_id?: string;
  error?: string;
  message?: string;
}

/**
 * A log message from klados execution
 */
export interface LogMessage {
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/**
 * A klados log entry entity
 */
export interface KladosLogEntry {
  id: string;
  type: string;
  cid: string;
  properties: {
    job_id: string;
    klados_id: string;
    status: 'running' | 'done' | 'error';
    log_data: {
      agent_id: string;
      agent_version: string;
      entry: {
        id: string;
        job_id: string;
        klados_id: string;
        status: 'running' | 'done' | 'error';
        started_at: string;
        completed_at?: string;
        received: {
          target_entity?: string;
          target_entities?: string[];
          target_collection: string;
          from_logs?: string[];
          batch?: {
            slot_id: string;
            batch_id: string;
            index: number;
            total: number;
          };
        };
        handoffs?: Array<{
          target: string;
          type: 'invoke' | 'scatter' | 'complete' | 'error' | 'none';
          job_id?: string;
          error?: string;
          /** For scatter: the actual invocations made */
          invocations?: Array<{
            target: string;
            request?: Record<string, unknown>;
          }>;
          /** True if scatter was delegated to scatter-utility */
          delegated?: boolean;
          /** Dispatch ID for delegated scatters */
          dispatch_id?: string;
        }>;
        error?: {
          code: string;
          message: string;
          retryable: boolean;
        };
      };
      messages: LogMessage[];
    };
  };
}

// =============================================================================
// Options Types
// =============================================================================

/**
 * Options for creating an entity
 */
export interface CreateEntityOptions {
  type: string;
  properties: Record<string, unknown>;
  collectionId?: string;
}

/**
 * Options for creating a collection
 */
export interface CreateCollectionOptions {
  label: string;
  description?: string;
  allowedTypes?: string[];
}

/**
 * Options for invoking a klados
 */
export interface InvokeKladosOptions {
  /** Klados ID to invoke */
  kladosId: string;
  /** Collection for permission scope (required) */
  targetCollection: string;
  /** Single entity to process (for cardinality: 'one') */
  targetEntity?: string;
  /** Multiple entities to process (for cardinality: 'many') */
  targetEntities?: string[];
  /** Job collection for logs (optional - API creates one if not provided) */
  jobCollection?: string;
  /** Execute (true) or preview (false) */
  confirm?: boolean;
  /** Optional input data */
  input?: Record<string, unknown>;
}

/**
 * Options for waiting for a klados log
 */
export interface WaitForLogOptions {
  /** Maximum time to wait in milliseconds (default: 10000) */
  timeout?: number;
  /** Poll interval in milliseconds (default: 1000) */
  pollInterval?: number;
}

// =============================================================================
// Log Tree Types
// =============================================================================

/**
 * A node in the workflow log tree
 */
export interface LogTreeNode {
  /** The log entry at this node */
  log: KladosLogEntry;
  /** Child nodes (logs that have this log in their from_logs) */
  children: LogTreeNode[];
  /** Whether this node is a leaf (no children expected) */
  isLeaf: boolean;
  /** Whether this log is terminal (done or error) */
  isTerminal: boolean;
  /** Number of expected children based on handoffs (may differ from actual) */
  expectedChildren: number;
}

/**
 * Result of building/traversing a workflow log tree
 */
export interface WorkflowLogTree {
  /** Root log node (found via first_log relationship) */
  root: LogTreeNode | null;
  /** All discovered logs indexed by entity ID */
  logs: Map<string, KladosLogEntry>;
  /** Whether the entire workflow has completed (all branches terminal) */
  isComplete: boolean;
  /** Whether any branch has errors */
  hasErrors: boolean;
  /** All leaf nodes in the tree */
  leaves: LogTreeNode[];
  /** All errors in the tree */
  errors: Array<{
    logId: string;
    kladosId: string;
    error: { code: string; message: string; retryable: boolean };
  }>;
  /** Whether all expected children have been discovered */
  allChildrenDiscovered: boolean;
}

/**
 * Options for waiting for workflow tree completion
 */
export interface WaitForWorkflowTreeOptions {
  /** Maximum time to wait in milliseconds (default: 30000) */
  timeout?: number;
  /** Poll interval in milliseconds (default: 2000) */
  pollInterval?: number;
  /** Callback for each poll iteration (for debugging/logging) */
  onPoll?: (tree: WorkflowLogTree, elapsed: number) => void;
}

/**
 * Criteria for matching a log message
 */
export interface LogMessageCriteria {
  /** Expected log level */
  level?: 'info' | 'warning' | 'error' | 'success';
  /** Text that should be contained in the message */
  textContains?: string;
  /** Exact message text match */
  textEquals?: string;
}
