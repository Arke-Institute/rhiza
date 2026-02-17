/**
 * Rhiza sync orchestrator
 *
 * Handles the full registration lifecycle: create or update based on state.
 */

import type { ArkeClient, components } from '@arke-institute/sdk';
import type { RhizaRegistrationState, SyncResult, DryRunResult } from '../types';
import type { RhizaConfig, RhizaSyncOptions } from './types';
import { hashConfig, diffConfig } from '../state';
import { ensureCollection } from '../collection';

// SDK flow type - uses looser WhereCondition with index signature.
// Our internal types are stricter (no index signature), so we cast at the API boundary.
type SdkFlow = components['schemas']['CreateRhizaRequest']['flow'];

/**
 * Create a new rhiza entity.
 */
async function createRhizaEntity(
  client: ArkeClient,
  config: RhizaConfig,
  collectionId: string
): Promise<{ id: string; cid: string }> {
  const { data, error } = await client.api.POST('/rhizai', {
    body: {
      label: config.label,
      version: config.version,
      entry: config.entry,
      flow: config.flow as SdkFlow,
      collection: collectionId,
      ...(config.description && { description: config.description }),
    },
  });

  if (error || !data) {
    throw new Error(`Failed to create rhiza: ${JSON.stringify(error) || 'Unknown error'}`);
  }

  return { id: data.id, cid: data.cid };
}

/**
 * Update an existing rhiza entity.
 */
async function updateRhizaEntity(
  client: ArkeClient,
  rhizaId: string,
  config: RhizaConfig
): Promise<void> {
  // Get current tip for CAS
  const { data: tipData, error: tipError } = await client.api.GET(
    '/entities/{id}/tip',
    {
      params: { path: { id: rhizaId } },
    }
  );

  if (tipError || !tipData) {
    throw new Error(`Failed to get entity tip: ${tipError?.error || 'Unknown error'}`);
  }

  const { error: updateError } = await client.api.PUT('/rhizai/{id}', {
    params: { path: { id: rhizaId } },
    body: {
      expect_tip: tipData.cid,
      label: config.label,
      version: config.version,
      entry: config.entry,
      flow: config.flow as SdkFlow,
      ...(config.description && { description: config.description }),
    },
  });

  if (updateError) {
    throw new Error(`Failed to update rhiza: ${updateError.error || 'Unknown error'}`);
  }
}

/**
 * Sync rhiza registration - creates or updates based on state.
 *
 * Detects changes via config hash comparison.
 * Updates flow, version, label, etc. if changed.
 *
 * With dryRun:
 * - Returns what WOULD happen without making changes
 *
 * @param client - Arke client (authenticated with user key)
 * @param config - Rhiza configuration
 * @param state - Existing state (null if new registration)
 * @param options - Sync options
 * @returns Sync result or dry-run result
 */
export async function syncRhiza(
  client: ArkeClient,
  config: RhizaConfig,
  state: RhizaRegistrationState | null,
  options: RhizaSyncOptions
): Promise<SyncResult<RhizaRegistrationState> | DryRunResult> {
  const { collectionId, collectionLabel = 'Rhiza Workflows', dryRun = false } = options;

  const configHash = hashConfig(config);

  // ==========================================================================
  // DRY RUN - Return what would happen
  // ==========================================================================

  if (dryRun) {
    if (!state) {
      return {
        action: 'would_create',
        changes: [
          { field: 'rhiza_id', from: undefined, to: '(new)' },
          { field: 'version', from: undefined, to: config.version },
          { field: 'entry', from: undefined, to: config.entry },
          { field: 'label', from: undefined, to: config.label },
        ],
      };
    }

    // Check for changes
    if (state.config_hash === configHash) {
      return { action: 'unchanged' };
    }

    // Calculate what changed
    const oldConfig = {
      label: config.label, // We don't store label in state, so we can't diff it
      version: state.version,
      config_hash: state.config_hash,
    };
    const newConfig = {
      label: config.label,
      version: config.version,
      config_hash: configHash,
    };

    return {
      action: 'would_update',
      changes: diffConfig(oldConfig, newConfig),
    };
  }

  // ==========================================================================
  // CREATE - New registration
  // ==========================================================================

  if (!state) {
    // Step 1: Ensure collection exists
    const { id: resolvedCollectionId } = await ensureCollection(client, collectionLabel, collectionId);

    // Step 2: Create rhiza entity
    const { id: rhizaId } = await createRhizaEntity(client, config, resolvedCollectionId);

    const now = new Date().toISOString();
    return {
      action: 'created',
      state: {
        schema_version: 1,
        rhiza_id: rhizaId,
        collection_id: resolvedCollectionId,
        version: config.version,
        config_hash: configHash,
        registered_at: now,
        updated_at: now,
      },
    };
  }

  // ==========================================================================
  // UPDATE - Existing registration
  // ==========================================================================

  // Check if anything changed
  if (state.config_hash === configHash) {
    return {
      action: 'unchanged',
      state,
    };
  }

  // Update rhiza entity
  await updateRhizaEntity(client, state.rhiza_id, config);

  return {
    action: 'updated',
    state: {
      ...state,
      version: config.version,
      config_hash: configHash,
      updated_at: new Date().toISOString(),
    },
  };
}
