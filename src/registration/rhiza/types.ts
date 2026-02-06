/**
 * Rhiza registration types
 */

import type { FlowStep } from '../../types/rhiza';
import type { Network } from '../types';

/** Flow definition - maps step names to their klados and handoff spec */
export type RhizaFlow = Record<string, FlowStep>;

/** Configuration for rhiza registration (typically from workflow.json) */
export interface RhizaConfig {
  /** Human-readable name */
  label: string;
  /** Description of what this workflow does */
  description?: string;
  /** Semantic version */
  version: string;
  /** Entry point - step name that starts the workflow */
  entry: string;
  /** Flow definition */
  flow: RhizaFlow;
}

/** Options for rhiza sync */
export interface RhizaSyncOptions {
  /** Which network to register on */
  network: Network;
  /** Collection label (default: 'Rhiza Workflows') */
  collectionLabel?: string;

  /**
   * Dry run mode - return what would happen without making changes.
   * When true, returns DryRunResult instead of SyncResult.
   */
  dryRun?: boolean;
}
