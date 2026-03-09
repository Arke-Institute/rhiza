/**
 * Entity and collection operations for klados testing
 *
 * These functions pass through to the SDK types directly.
 * For full SDK access, use getClient() instead.
 */

import { components } from '@arke-institute/sdk';
import { apiRequest } from './client.js';
import type { Entity, Collection, CollectionEntities } from './types.js';

// Re-export SDK types for convenience
export type CreateEntityBody = components['schemas']['CreateEntityRequest'];
export type CreateCollectionBody = components['schemas']['CreateCollectionRequest'];

/**
 * Create a new entity
 *
 * Pass-through to SDK types - accepts any fields the API supports.
 *
 * @example
 * ```typescript
 * const entity = await createEntity({
 *   type: 'document',
 *   properties: { title: 'Test Document' },
 *   collection: collection.id,
 *   relationships: [{ predicate: 'related_to', peer: otherId }],
 * });
 * ```
 */
export async function createEntity(body: CreateEntityBody): Promise<Entity> {
  return apiRequest<Entity>('POST', '/entities', body as Record<string, unknown>);
}

/**
 * Get an entity by ID
 *
 * @param id - Entity ID
 */
export async function getEntity(id: string): Promise<Entity> {
  return apiRequest<Entity>('GET', `/entities/${id}`);
}

/**
 * Delete an entity
 *
 * Fetches the entity tip first for CAS protection, then deletes.
 *
 * @param id - Entity ID to delete
 */
export async function deleteEntity(id: string): Promise<void> {
  // Get current tip for CAS
  const tip = await apiRequest<{ cid: string }>('GET', `/entities/${id}/tip`);

  // Delete with expect_tip
  await apiRequest('DELETE', `/entities/${id}`, {
    expect_tip: tip.cid,
  });
}

/**
 * Create a new collection
 *
 * Pass-through to SDK types - accepts any fields the API supports.
 * By default, collections include standard roles with public *:view access.
 *
 * @example
 * ```typescript
 * // Minimal - gets default roles
 * const collection = await createCollection({
 *   label: 'Test Collection',
 * });
 *
 * // Agent-accessible collection
 * const agentCollection = await createCollection({
 *   label: 'Agent Collection',
 *   roles: { public: ['*:view', '*:invoke'] }
 * });
 * ```
 */
export async function createCollection(
  body: CreateCollectionBody
): Promise<Collection> {
  return apiRequest<Collection>('POST', '/collections', body as Record<string, unknown>);
}

/**
 * Get entities in a collection
 *
 * Note: This endpoint has indexing lag. For log discovery, prefer
 * using `getFirstLogFromCollection` which uses the log_started relationship.
 *
 * @param collectionId - Collection ID
 */
export async function getCollectionEntities(
  collectionId: string
): Promise<CollectionEntities> {
  return apiRequest<CollectionEntities>(
    'GET',
    `/collections/${collectionId}/entities`
  );
}
