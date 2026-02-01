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
