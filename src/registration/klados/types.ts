/**
 * Klados registration types
 */

import type { Network, KeyStore } from '../types';

/**
 * Match criteria for klados discovery.
 * See arke_v1/docs/architecture/KLADOS_DISCOVERY.md for full documentation.
 */
export type MatchCriteria =
  | { always: true }
  | { never: true }
  | { and: MatchCriteria[] }
  | { or: MatchCriteria[] }
  | { not: MatchCriteria }
  | PropertyCondition;

export interface PropertyCondition {
  /** JSON path into the entity (e.g., "type", "properties.content_type") */
  path: string;
  equals?: unknown;
  not_equals?: unknown;
  in?: unknown[];
  not_in?: unknown[];
  exists?: boolean;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  matches?: string;
  starts_with?: string;
  contains?: string;
  /**
   * Matches if ANY entry in the map/array at this path satisfies the nested criteria.
   * For objects, iterates over values. For arrays, iterates over elements.
   */
  any?: MatchCriteria;
  /**
   * Matches if ALL entries in the map/array at this path satisfy the nested criteria.
   * Empty collections return true (vacuous truth).
   */
  all?: MatchCriteria;
}

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
  /**
   * Match criteria for automatic discovery.
   * Defines when this klados applies to a given entity.
   * @see arke_v1/docs/architecture/KLADOS_DISCOVERY.md
   */
  match?: MatchCriteria;
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
