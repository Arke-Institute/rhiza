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
