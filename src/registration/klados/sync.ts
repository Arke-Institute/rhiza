/**
 * Klados sync orchestrator
 *
 * Handles the full registration lifecycle: create or update based on state.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type { KladosRegistrationState, SyncResult, DryRunResult } from '../types';
import type { KladosConfig, KladosSyncOptions } from './types';
import { hashConfig, diffConfig } from '../state';
import { ensureCollection } from '../collection';
import { createApiKey } from './keys';
import { runVerificationFlow } from './verify';

/**
 * Create a new klados entity.
 */
async function createKladosEntity(
  client: ArkeClient,
  config: KladosConfig,
  collectionId: string
): Promise<{ id: string; cid: string }> {
  const { data, error } = await client.api.POST('/kladoi', {
    body: {
      label: config.label,
      description: config.description,
      endpoint: config.endpoint,
      actions_required: config.actions_required,
      accepts: config.accepts,
      produces: config.produces,
      collection: collectionId,
      // Include match criteria for discovery
      ...(config.match ? { match: config.match } : {}),
    },
  });

  if (error || !data) {
    throw new Error(`Failed to create klados: ${error?.error || 'Unknown error'}`);
  }

  return { id: data.id, cid: data.cid };
}

/**
 * Update an existing klados entity.
 */
async function updateKladosEntity(
  client: ArkeClient,
  kladosId: string,
  config: KladosConfig
): Promise<void> {
  // Get current tip for CAS
  const { data: tipData, error: tipError } = await client.api.GET(
    '/entities/{id}/tip',
    {
      params: { path: { id: kladosId } },
    }
  );

  if (tipError || !tipData) {
    throw new Error(`Failed to get entity tip: ${tipError?.error || 'Unknown error'}`);
  }

  // Update klados
  const { error: updateError } = await client.api.PUT('/kladoi/{id}', {
    params: { path: { id: kladosId } },
    body: {
      expect_tip: tipData.cid,
      label: config.label,
      description: config.description,
      endpoint: config.endpoint,
      actions_required: config.actions_required,
      accepts: config.accepts,
      produces: config.produces,
      // Include match criteria for discovery
      ...(config.match ? { match: config.match } : {}),
    },
  });

  if (updateError) {
    throw new Error(`Failed to update klados: ${updateError.error || 'Unknown error'}`);
  }
}

/**
 * Sync klados registration - creates or updates based on state.
 *
 * Handles the full lifecycle:
 * - Create: entity → verify → activate → api key → store key
 * - Update: metadata update, re-verify if endpoint changed
 *
 * With KeyStore:
 * - Automatically pushes/manages secrets
 * - Stores API key after creation
 * - Cleans up verification secrets
 *
 * With dryRun:
 * - Returns what WOULD happen without making changes
 *
 * @param client - Arke client (authenticated with user key)
 * @param config - Klados configuration
 * @param state - Existing state (null if new registration)
 * @param options - Sync options
 * @returns Sync result or dry-run result
 */
export async function syncKlados(
  client: ArkeClient,
  config: KladosConfig,
  state: KladosRegistrationState | null,
  options: KladosSyncOptions
): Promise<SyncResult<KladosRegistrationState> | DryRunResult> {
  const {
    collectionId,
    collectionLabel = 'Klados Workers',
    keyStore,
    dryRun = false,
    onDeploy,
    onWaitForHealth,
  } = options;

  const configHash = hashConfig(config);

  // ==========================================================================
  // DRY RUN - Return what would happen
  // ==========================================================================

  if (dryRun) {
    if (!state) {
      return {
        action: 'would_create',
        changes: [
          { field: 'klados_id', from: undefined, to: '(new)' },
          { field: 'endpoint', from: undefined, to: config.endpoint },
          { field: 'label', from: undefined, to: config.label },
        ],
      };
    }

    // Check for changes
    const changes = diffConfig(
      {
        label: config.label, // Placeholder
        endpoint: state.endpoint,
        config_hash: state.config_hash,
      },
      {
        label: config.label,
        endpoint: config.endpoint,
        config_hash: configHash,
      }
    );

    if (changes.length === 0 || state.config_hash === configHash) {
      return { action: 'unchanged' };
    }

    const endpointChanged = state.endpoint !== config.endpoint;
    return {
      action: 'would_update',
      changes: [
        ...diffConfig(state, { ...state, config_hash: configHash }),
        ...(endpointChanged
          ? [{ field: 'verification', from: 'verified', to: 're-verification required' }]
          : []),
      ],
    };
  }

  // ==========================================================================
  // CREATE - New registration
  // ==========================================================================

  if (!state) {
    // Step 1: Ensure collection exists
    const { id: resolvedCollectionId } = await ensureCollection(client, collectionLabel, collectionId);

    // Step 2: Create klados entity (status: development)
    const { id: kladosId } = await createKladosEntity(client, config, resolvedCollectionId);

    // Step 3-6: Verification flow
    if (keyStore && onDeploy && onWaitForHealth) {
      // Full automated flow
      const verifyResult = await runVerificationFlow(client, kladosId, config.endpoint, {
        keyStore,
        onDeploy,
        onWaitForHealth,
      });

      if (!verifyResult.verified) {
        throw new Error(`Verification failed: ${verifyResult.error}`);
      }

      // Step 7: Create and store API key
      const apiKey = await createApiKey(client, kladosId, 'Primary API Key');
      await keyStore.set('ARKE_AGENT_KEY', apiKey.key);

      const now = new Date().toISOString();
      return {
        action: 'created',
        state: {
          schema_version: 1,
          klados_id: kladosId,
          collection_id: resolvedCollectionId,
          api_key_prefix: apiKey.prefix,
          endpoint: config.endpoint,
          endpoint_verified_at: verifyResult.verifiedAt,
          config_hash: configHash,
          registered_at: now,
          updated_at: now,
        },
      };
    } else {
      // Manual flow - caller handles verification
      // Just create entity and return
      const now = new Date().toISOString();
      return {
        action: 'created',
        state: {
          schema_version: 1,
          klados_id: kladosId,
          collection_id: resolvedCollectionId,
          api_key_prefix: '',
          endpoint: config.endpoint,
          endpoint_verified_at: undefined,
          config_hash: configHash,
          registered_at: now,
          updated_at: now,
        },
      };
    }
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

  const endpointChanged = state.endpoint !== config.endpoint;

  // Update klados metadata
  await updateKladosEntity(client, state.klados_id, config);

  // Re-verify if endpoint changed
  if (endpointChanged && keyStore && onDeploy && onWaitForHealth) {
    const verifyResult = await runVerificationFlow(
      client,
      state.klados_id,
      config.endpoint,
      {
        keyStore,
        onDeploy,
        onWaitForHealth,
      }
    );

    if (!verifyResult.verified) {
      throw new Error(`Re-verification failed: ${verifyResult.error}`);
    }

    return {
      action: 'updated',
      state: {
        ...state,
        endpoint: config.endpoint,
        endpoint_verified_at: verifyResult.verifiedAt,
        config_hash: configHash,
        updated_at: new Date().toISOString(),
      },
    };
  }

  // No re-verification needed (or no keyStore provided)
  return {
    action: 'updated',
    state: {
      ...state,
      endpoint: config.endpoint,
      config_hash: configHash,
      updated_at: new Date().toISOString(),
    },
  };
}
