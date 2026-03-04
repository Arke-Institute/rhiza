/**
 * Klados registration types
 */

import type { Network, KeyStore } from '../types';

/** Configuration for klados registration (typically from agent.json) */
export interface KladosConfig {
  /** Human-readable name */
  label: string;
  /** Description of what this klados does */
  description?: string;
  /** Worker endpoint URL */
  endpoint: string;
  /** Required Arke actions (e.g., ['entity:view', 'entity:create']) */
  actions_required: string[];
  /** Input contract */
  accepts: {
    /** Entity types accepted (use ['*'] for any) */
    types: string[];
    /** Input cardinality */
    cardinality: 'one' | 'many';
  };
  /** Output contract */
  produces: {
    /** Entity types produced (use ['*'] for any) */
    types: string[];
    /** Output cardinality */
    cardinality: 'one' | 'many';
  };
}

/** Options for klados sync */
export interface KladosSyncOptions {
  /** Which network to register on */
  network: Network;
  /** Existing collection ID to use (if not provided, creates new collection) */
  collectionId?: string;
  /** Collection label for new collection (default: 'Klados Workers') */
  collectionLabel?: string;

  /**
   * Key store for managing secrets.
   * If provided, secrets are automatically pushed/cleaned up.
   */
  keyStore?: KeyStore;

  /**
   * Secret name for the API key in the keyStore.
   * Defaults to network-specific names:
   * - 'ARKE_AGENT_KEY_TEST' for test network
   * - 'ARKE_AGENT_KEY_MAIN' for main network
   */
  secretName?: string;

  /**
   * Dry run mode - return what would happen without making changes.
   * When true, returns DryRunResult instead of SyncResult.
   */
  dryRun?: boolean;

  /**
   * Force update even if config hash matches state file.
   * Useful when state file is out of sync with the actual API entity.
   */
  force?: boolean;

  /**
   * Called when worker needs to be deployed.
   * This is called after secrets are pushed to keyStore.
   */
  onDeploy?: () => Promise<void>;

  /**
   * Called to wait for endpoint to be healthy after deploy.
   * Should poll the endpoint until it responds successfully.
   */
  onWaitForHealth?: (endpoint: string) => Promise<void>;
}
