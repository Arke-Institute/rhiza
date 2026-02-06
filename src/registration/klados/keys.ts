/**
 * Klados API key management
 *
 * SDK-dependent functions for creating, listing, rotating, and revoking API keys.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type {
  ApiKeyInfo,
  ApiKeyCreateResult,
  ApiKeyRotateResult,
  KeyStore,
} from '../types';

// Response types for API calls (not in SDK types)
interface KeyCreateResponse {
  id?: string;
  key: string;
  prefix?: string;
}

interface KeyListResponse {
  id: string;
  prefix?: string;
  key?: string;
  label?: string;
  created_at?: string;
  last_used_at?: string;
}

/**
 * Create a new API key for a klados.
 *
 * IMPORTANT: The full key is only returned once! Store it securely.
 *
 * @param client - Arke client (authenticated with user key)
 * @param kladosId - Klados entity ID
 * @param label - Human-readable label for the key
 * @returns Key creation result including full key
 */
export async function createApiKey(
  client: ArkeClient,
  kladosId: string,
  label: string = 'API Key'
): Promise<ApiKeyCreateResult> {
  // The SDK types don't include this endpoint, so we use type assertion
  const { data, error } = await (client.api.POST as Function)(
    `/kladoi/${kladosId}/keys`,
    { body: { label } }
  ) as { data?: KeyCreateResponse; error?: { error?: string } };

  if (error || !data) {
    throw new Error(`Failed to create API key: ${error?.error || 'Unknown error'}`);
  }

  return {
    id: data.id || '',
    key: data.key,
    prefix: data.key.slice(0, 10),
  };
}

/**
 * List all API keys for a klados.
 *
 * Note: Does not include the actual key values, only metadata.
 *
 * @param client - Arke client (authenticated with user key)
 * @param kladosId - Klados entity ID
 * @returns Array of key info objects
 */
export async function listApiKeys(
  client: ArkeClient,
  kladosId: string
): Promise<ApiKeyInfo[]> {
  // The SDK types don't include this endpoint, so we use type assertion
  const { data, error } = await (client.api.GET as Function)(
    `/kladoi/${kladosId}/keys`
  ) as { data?: KeyListResponse[]; error?: { error?: string } };

  if (error) {
    throw new Error(`Failed to list API keys: ${error.error || 'Unknown error'}`);
  }

  if (!data || !Array.isArray(data)) {
    return [];
  }

  return data.map((key) => ({
    id: key.id,
    prefix: key.prefix || key.key?.slice(0, 10) || '',
    label: key.label || 'Unnamed',
    created_at: key.created_at || new Date().toISOString(),
    last_used_at: key.last_used_at,
  }));
}

/**
 * Revoke an API key.
 *
 * @param client - Arke client (authenticated with user key)
 * @param kladosId - Klados entity ID
 * @param keyId - Key ID to revoke
 */
export async function revokeApiKey(
  client: ArkeClient,
  kladosId: string,
  keyId: string
): Promise<void> {
  // The SDK types don't include this endpoint, so we use type assertion
  const { error } = await (client.api.DELETE as Function)(
    `/kladoi/${kladosId}/keys/${keyId}`
  ) as { error?: { error?: string } };

  if (error) {
    throw new Error(`Failed to revoke API key: ${error.error || 'Unknown error'}`);
  }
}

/**
 * Rotate API key: creates a new key and optionally revokes the old one.
 *
 * If keyStore is provided, automatically updates the stored key.
 * The rotation is atomic from the keyStore perspective - new key is set
 * before old key is revoked.
 *
 * @param client - Arke client (authenticated with user key)
 * @param kladosId - Klados entity ID
 * @param options - Rotation options
 * @returns Rotation result including new key and revoked key ID
 */
export async function rotateApiKey(
  client: ArkeClient,
  kladosId: string,
  options: {
    /** Label for new key (default: 'Rotated key') */
    label?: string;
    /** Revoke old key after creating new one */
    revokeOld?: boolean;
    /** Key ID to revoke (required if revokeOld is true) */
    oldKeyId?: string;
    /** Key store to update with new key */
    keyStore?: KeyStore;
    /** Secret name to update in keyStore (default: ARKE_AGENT_KEY) */
    secretName?: string;
  } = {}
): Promise<ApiKeyRotateResult> {
  const {
    label = `Rotated ${new Date().toISOString()}`,
    revokeOld = false,
    oldKeyId,
    keyStore,
    secretName = 'ARKE_AGENT_KEY',
  } = options;

  // Create new key
  const newKey = await createApiKey(client, kladosId, label);

  // Update keyStore if provided (before revoking old key)
  if (keyStore) {
    await keyStore.set(secretName, newKey.key);
  }

  // Revoke old key if requested
  let revokedKeyId: string | undefined;
  if (revokeOld && oldKeyId) {
    await revokeApiKey(client, kladosId, oldKeyId);
    revokedKeyId = oldKeyId;
  }

  return {
    new_key: newKey,
    revoked_key_id: revokedKeyId,
  };
}
