/**
 * @arke-institute/klados-testing
 *
 * Test utilities for klados workers on the Arke network.
 *
 * @example
 * ```typescript
 * import {
 *   configureTestClient,
 *   createCollection,
 *   createEntity,
 *   deleteEntity,
 *   invokeKlados,
 *   waitForKladosLog,
 *   assertLogCompleted,
 *   assertLogHasMessages,
 * } from '@arke-institute/klados-testing';
 *
 * // Configure once in test setup
 * configureTestClient({
 *   apiBase: 'https://arke-v1.arke.institute',
 *   userKey: process.env.ARKE_USER_KEY!,
 *   network: 'test',
 * });
 *
 * // Create test fixtures
 * const collection = await createCollection({ label: 'Test' });
 * const entity = await createEntity({
 *   type: 'document',
 *   properties: { content: 'test' },
 *   collectionId: collection.id,
 * });
 *
 * // Invoke klados
 * const result = await invokeKlados({
 *   kladosId: 'klados_xxx',
 *   targetEntity: entity.id,
 *   targetCollection: collection.id,
 *   jobCollection: collection.id,
 * });
 *
 * // Wait for completion and verify
 * const log = await waitForKladosLog(result.job_collection!);
 * assertLogCompleted(log);
 * assertLogHasMessages(log, [
 *   { level: 'info', textContains: 'Processing' },
 * ]);
 *
 * // Cleanup
 * await deleteEntity(entity.id);
 * await deleteEntity(collection.id);
 * ```
 */

// Configuration
export { configureTestClient, getConfig, resetTestClient, apiRequest, sleep, log } from './client';

// Entity operations
export { createEntity, getEntity, deleteEntity, createCollection, getCollectionEntities } from './entities';

// Log utilities
export { getKladosLog, getFirstLogFromCollection, waitForKladosLog, getLogMessages, getLogEntry } from './logs';

// Klados invocation
export { invokeKlados } from './invoke';

// Assertions
export {
  assertLogCompleted,
  assertLogFailed,
  assertLogHasMessages,
  assertLogMessageCount,
  assertLogHasHandoff,
} from './assertions';

// Types
export type {
  TestConfig,
  Entity,
  Collection,
  CollectionEntities,
  InvokeResult,
  LogMessage,
  KladosLogEntry,
  CreateEntityOptions,
  CreateCollectionOptions,
  InvokeKladosOptions,
  WaitForLogOptions,
  LogMessageCriteria,
} from './types';
