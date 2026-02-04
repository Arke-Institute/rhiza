/**
 * Klados invocation utilities for testing
 */

import { apiRequest } from './client.js';
import type { InvokeResult, InvokeKladosOptions } from './types.js';

/**
 * Invoke a klados worker
 *
 * @example
 * ```typescript
 * const result = await invokeKlados({
 *   kladosId: 'klados_abc123',
 *   targetEntity: entity.id,
 *   targetCollection: collection.id,
 *   jobCollection: jobCollection.id,
 *   confirm: true,
 * });
 *
 * if (result.status === 'started') {
 *   console.log('Job started:', result.job_id);
 * }
 * ```
 *
 * @param options - Invocation options
 * @returns The invocation result
 */
export async function invokeKlados(
  options: InvokeKladosOptions
): Promise<InvokeResult> {
  const body: Record<string, unknown> = {
    target_collection: options.targetCollection,
    job_collection: options.jobCollection,
    confirm: options.confirm ?? true,
  };

  if (options.targetEntity) {
    body.target_entity = options.targetEntity;
  }

  if (options.targetEntities) {
    body.target_entities = options.targetEntities;
  }

  if (options.input) {
    body.input = options.input;
  }

  return apiRequest<InvokeResult>(
    'POST',
    `/kladoi/${options.kladosId}/invoke`,
    body
  );
}
