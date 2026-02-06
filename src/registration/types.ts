/**
 * Registration types
 *
 * Shared types for klados and rhiza registration utilities.
 * Pure types with no external dependencies.
 */

// ============================================================================
// NETWORK TYPE
// ============================================================================

/** Arke network identifier */
export type Network = 'test' | 'main';

// ============================================================================
// KEY STORE INTERFACE
// ============================================================================

/**
 * Platform-agnostic interface for storing secrets.
 * Templates implement this for their platform (Cloudflare, AWS, etc.)
 *
 * @example
 * ```typescript
 * class CloudflareKeyStore implements KeyStore {
 *   async set(name: string, value: string): Promise<void> {
 *     execSync(`echo "${value}" | wrangler secret put ${name}`)
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface KeyStore {
  /** Get a secret value by name */
  get(name: string): Promise<string | null>;

  /** Set a secret value */
  set(name: string, value: string): Promise<void>;

  /** Delete a secret */
  delete(name: string): Promise<void>;

  /** Check if a secret exists */
  exists(name: string): Promise<boolean>;
}

/** Well-known secret names used by registration */
export const SECRET_NAMES = {
  /** API key for klados authentication */
  AGENT_KEY: 'ARKE_AGENT_KEY',
  /** Temporary verification token during registration */
  VERIFICATION_TOKEN: 'VERIFICATION_TOKEN',
  /** Klados ID used during verification (before AGENT_ID is set) */
  VERIFY_AGENT_ID: 'ARKE_VERIFY_AGENT_ID',
} as const;

// ============================================================================
// STATE TYPES
// ============================================================================

/** State persisted between registration runs */
export interface RegistrationState {
  /** Schema version for future migrations */
  schema_version: 1;
  /** Collection ID containing the registered entity */
  collection_id: string;
  /** ISO timestamp of initial registration */
  registered_at: string;
  /** ISO timestamp of last update */
  updated_at: string;
}

/** Klados-specific registration state */
export interface KladosRegistrationState extends RegistrationState {
  /** Klados entity ID */
  klados_id: string;
  /** First 10 chars of API key (for display/matching) */
  api_key_prefix: string;
  /** Worker endpoint URL */
  endpoint: string;
  /** ISO timestamp of last endpoint verification */
  endpoint_verified_at?: string;
  /** Hash of config for change detection */
  config_hash: string;
}

/** Rhiza-specific registration state */
export interface RhizaRegistrationState extends RegistrationState {
  /** Rhiza entity ID */
  rhiza_id: string;
  /** Workflow version */
  version: string;
  /** Hash of config for change detection */
  config_hash: string;
}

// ============================================================================
// SYNC RESULT TYPES
// ============================================================================

/** Result from sync operations (non-dry-run) */
export interface SyncResult<S extends RegistrationState> {
  /** What action was taken */
  action: 'created' | 'updated' | 'unchanged';
  /** Updated state to persist */
  state: S;
}

/** Dry-run result showing what WOULD happen */
export interface DryRunResult {
  /** What action would be taken */
  action: 'would_create' | 'would_update' | 'unchanged';
  /** List of fields that would change (for would_update) */
  changes?: Array<{
    field: string;
    from: unknown;
    to: unknown;
  }>;
}

// ============================================================================
// API KEY TYPES
// ============================================================================

/** API key info (without the actual key value) */
export interface ApiKeyInfo {
  /** Key ID (for revocation) */
  id: string;
  /** First 10 chars of key (for display/matching) */
  prefix: string;
  /** Human-readable label */
  label: string;
  /** ISO timestamp of creation */
  created_at: string;
  /** ISO timestamp of last use (if tracked) */
  last_used_at?: string;
}

/** Result from key creation */
export interface ApiKeyCreateResult {
  /** Key ID (for revocation) */
  id: string;
  /** Full API key - only returned once! */
  key: string;
  /** First 10 chars of key (for display/matching) */
  prefix: string;
}

/** Result from key rotation */
export interface ApiKeyRotateResult {
  /** The newly created key */
  new_key: ApiKeyCreateResult;
  /** ID of revoked key (if revokeOld was true) */
  revoked_key_id?: string;
}
