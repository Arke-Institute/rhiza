/**
 * Entity and collection operations for klados testing
 */

import { apiRequest } from './client.js';
import type {
  Entity,
  Collection,
  CollectionEntities,
  CreateEntityOptions,
  CreateCollectionOptions,
} from './types.js';

/**
 * Create a new entity
 *
 * @example
 * ```typescript
 * const entity = await createEntity({
 *   type: 'document',
 *   properties: { title: 'Test Document' },
 *   collectionId: collection.id,
 * });
 * ```
 */
export async function createEntity(options: CreateEntityOptions): Promise<Entity> {
  const body: Record<string, unknown> = {
    type: options.type,
    properties: options.properties,
  };

  if (options.collectionId) {
    body.collection = options.collectionId;
  }

  return apiRequest<Entity>('POST', '/entities', body);
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
 * Uses POST /collections to get proper owner permissions.
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
  options: CreateCollectionOptions
): Promise<Collection> {
  return apiRequest<Collection>('POST', '/collections', {
    label: options.label,
    description: options.description,
    allowed_types: options.allowedTypes,
    roles: options.roles,
    use_roles_default: options.useRolesDefault,
  });
}

/**
 * Get entities in a collection
 *
 * Note: This endpoint has indexing lag. For log discovery, prefer
 * using `getFirstLogFromCollection` which uses the first_log relationship.
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
