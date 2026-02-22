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

interface CollectionRoles {
  public?: string[];
  viewer?: string[];
  editor?: string[];
  owner?: string[];
}

interface CollectionResponse {
  id: string;
  cid?: string;
  type?: string;
  properties?: {
    roles?: CollectionRoles;
    [key: string]: unknown;
  };
  // Roles may be at top level or in properties depending on API version
  roles?: CollectionRoles;
}

/**
 * Ensure a collection exists for registration.
 *
 * If collectionId is provided, verifies it exists.
 * If not provided, creates a new collection.
 *
 * @param client - Arke client (authenticated with user key)
 * @param label - Collection label (used when creating)
 * @param collectionId - Optional existing collection ID to use
 * @returns Collection ID and whether it was created
 */
export async function ensureCollection(
  client: ArkeClient,
  label: string,
  collectionId?: string
): Promise<{ id: string; created: boolean }> {
  // If collection ID provided, verify it exists and check permissions
  if (collectionId) {
    const { data, error } = await client.api.GET('/collections/{id}', {
      params: { path: { id: collectionId } },
    });

    if (error || !data) {
      throw new Error(
        `Collection ${collectionId} not found: ${error?.error || 'Unknown error'}`
      );
    }

    // Check if public role has invoke permission
    // Roles may be at top level or nested in properties depending on API response
    const collection = data as CollectionResponse;
    const publicRoles = collection.roles?.public ?? collection.properties?.roles?.public;
    const hasInvoke = Array.isArray(publicRoles) &&
      (publicRoles.includes('*:invoke') || publicRoles.includes('klados:invoke'));

    if (!hasInvoke) {
      console.warn(
        `\n⚠️  Warning: Collection ${collectionId} does not have '*:invoke' in public role.\n` +
        `   Workflow chaining may fail - other workers won't be able to invoke this klados.\n` +
        `   Consider updating the collection roles to include: public: ['*:view', '*:invoke']\n`
      );
    }

    return { id: collectionId, created: false };
  }

  // Create new collection
  const { data: created, error: createError } = await client.api.POST(
    '/collections',
    {
      body: {
        label,
        description: `Collection for ${label}`,
        roles: DEFAULT_COLLECTION_ROLES,
      },
    }
  );

  if (createError || !created) {
    throw new Error(
      `Failed to create collection: ${createError?.error || 'Unknown error'}`
    );
  }

  return { id: (created as CollectionResponse).id, created: true };
}
