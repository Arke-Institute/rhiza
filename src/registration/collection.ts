/**
 * Collection utilities
 *
 * SDK-dependent functions for managing collections.
 */

import type { ArkeClient } from '@arke-institute/sdk';

/**
 * Collection roles for klados/rhiza entities.
 * Allows public viewing and invocation.
 */
const DEFAULT_COLLECTION_ROLES = {
  public: ['*:view', '*:invoke'],
  viewer: ['*:view'],
  editor: ['*:view', '*:update', '*:create', '*:invoke'],
  owner: [
    '*:view',
    '*:update',
    '*:create',
    '*:manage',
    '*:invoke',
    'collection:update',
    'collection:manage',
  ],
};

interface CollectionResponse {
  id: string;
  cid?: string;
  type?: string;
  properties?: Record<string, unknown>;
}

/**
 * Get or create a collection for registration entities.
 *
 * If a collection with the given label exists for this user, returns its ID.
 * Otherwise creates a new collection.
 *
 * @param client - Arke client (authenticated with user key)
 * @param label - Collection label
 * @returns Collection ID and whether it was created
 */
export async function ensureCollection(
  client: ArkeClient,
  label: string
): Promise<{ id: string; created: boolean }> {
  // Try to find existing collection with this label
  // Note: This searches user's collections, not all collections
  // The SDK types don't include this endpoint, so we use type assertion
  const { data: collections, error: listError } = await (client.api.GET as Function)(
    '/collections',
    {
      params: {
        query: {
          label,
          limit: 1,
        },
      },
    }
  ) as { data?: CollectionResponse[]; error?: { error?: string } };

  if (listError) {
    throw new Error(`Failed to list collections: ${listError.error || 'Unknown error'}`);
  }

  // If collection exists, return it
  if (collections && collections.length > 0) {
    return { id: collections[0].id, created: false };
  }

  // Create new collection
  // The SDK types don't include this endpoint, so we use type assertion
  const { data: created, error: createError } = await (client.api.POST as Function)(
    '/collections',
    {
      body: {
        label,
        description: `Collection for ${label}`,
        roles: DEFAULT_COLLECTION_ROLES,
      },
    }
  ) as { data?: CollectionResponse; error?: { error?: string } };

  if (createError || !created) {
    throw new Error(`Failed to create collection: ${createError?.error || 'Unknown error'}`);
  }

  return { id: created.id, created: true };
}
