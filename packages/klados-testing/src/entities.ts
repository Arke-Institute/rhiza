/**
 * Entity and collection operations for klados testing
 */

import { apiRequest } from './client';
import type {
  Entity,
  Collection,
  CollectionEntities,
  CreateEntityOptions,
  CreateCollectionOptions,
} from './types';

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
 * @param id - Entity ID to delete
 */
export async function deleteEntity(id: string): Promise<void> {
  await apiRequest('DELETE', `/entities/${id}`);
}

/**
 * Create a new collection
 *
 * Uses POST /collections to get proper owner permissions.
 *
 * @example
 * ```typescript
 * const collection = await createCollection({
 *   label: 'Test Collection',
 *   allowedTypes: ['document'],
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
