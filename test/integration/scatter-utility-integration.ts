/**
 * Integration Test: Rhiza → Scatter Utility
 *
 * Tests that large scatters (>threshold) are delegated to scatter-utility.
 *
 * Usage:
 *   ARKE_USER_KEY=uk_... npx tsx test/integration/scatter-utility-integration.ts
 */

import { ArkeClient } from '@arke-institute/sdk';
import {
  interpretThen,
  type InterpretContext,
  type ThenSpec,
  type RhizaRuntimeConfig,
  type FlowStep,
} from '../../src';

// =============================================================================
// Configuration
// =============================================================================

const ARKE_API_BASE = process.env.ARKE_API_BASE || 'https://arke-v1.arke.institute';
const ARKE_USER_KEY = process.env.ARKE_USER_KEY!;
const NETWORK = (process.env.ARKE_NETWORK || 'test') as 'test' | 'main';
const STAMP_KLADOS = process.env.STAMP_KLADOS || 'IIKGNRDYWJVCM7M4MWDDN72BGT';
const SCATTER_UTILITY_URL = process.env.SCATTER_UTILITY_URL || 'https://scatter-utility.arke.institute';

// Test parameters
const SMALL_COUNT = 10;   // Below threshold - should dispatch locally
const LARGE_COUNT = 100;  // Above threshold - should delegate

// =============================================================================
// Helpers
// =============================================================================

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Test Functions
// =============================================================================

async function createTestEntities(
  client: ArkeClient,
  collectionId: string,
  count: number
): Promise<string[]> {
  const entityIds: string[] = [];
  const batchSize = 20;

  for (let i = 0; i < count; i += batchSize) {
    const promises = [];
    for (let j = i; j < Math.min(i + batchSize, count); j++) {
      promises.push(
        client.api.POST('/entities', {
          body: {
            type: 'test_entity',
            properties: {
              title: `Integration Test Entity ${j}`,
              index: j,
            },
            collection: collectionId,
          },
        })
      );
    }

    const results = await Promise.all(promises);
    for (const res of results) {
      if (res.error) {
        throw new Error(`Failed to create entity: ${res.error.error}`);
      }
      entityIds.push(res.data!.id);
    }
  }

  return entityIds;
}

async function testScatterWithThreshold(
  client: ArkeClient,
  collectionId: string,
  jobCollectionId: string,
  outputCount: number,
  config: RhizaRuntimeConfig | undefined,
  expectDelegation: boolean
): Promise<{ delegated: boolean; dispatchId?: string }> {
  log(`Testing scatter with ${outputCount} outputs (expect delegation: ${expectDelegation})`);

  // Create test entities
  const outputs = await createTestEntities(client, collectionId, outputCount);
  log(`  Created ${outputs.length} test entities`);

  // Create a mock rhiza flow
  const flow: Record<string, FlowStep> = {
    'scatter_step': {
      klados: { pi: STAMP_KLADOS },
      then: { scatter: 'process_step' },
    },
    'process_step': {
      klados: { pi: STAMP_KLADOS },
      then: { done: true },
    },
  };

  // Create a fake log entity for fromLogId
  const { data: logEntity, error: logError } = await client.api.POST('/entities', {
    body: {
      type: 'klados_log',
      properties: {
        status: 'running',
        job_id: `job_test_${Date.now()}`,
      },
      collection: jobCollectionId,
    },
  });

  if (logError || !logEntity) {
    throw new Error(`Failed to create log entity: ${logError?.error}`);
  }

  // Build context (authToken enables automatic scatter-utility delegation)
  const context: InterpretContext = {
    client,
    rhizaId: 'rhiza_test_integration',
    kladosId: 'klados_test_source',
    jobId: `job_test_${Date.now()}`,
    targetCollection: collectionId,
    jobCollectionId,
    flow,
    outputs,
    fromLogId: logEntity.id,
    path: ['scatter_step'],
    apiBase: ARKE_API_BASE,
    network: NETWORK,
    authToken: ARKE_USER_KEY,
  };

  // Create the scatter ThenSpec
  const thenSpec: ThenSpec = { scatter: 'process_step' };

  // Execute interpretThen
  log(`  Executing interpretThen...`);
  const startTime = Date.now();
  const result = await interpretThen(thenSpec, context, config);
  const elapsed = Date.now() - startTime;

  log(`  Result: action=${result.action}, elapsed=${elapsed}ms`);

  // Check if it was delegated
  const wasDelegated = result.handoffRecord?.delegated === true;
  const dispatchId = result.handoffRecord?.dispatch_id;

  if (wasDelegated) {
    log(`  Delegated to scatter-utility: dispatchId=${dispatchId}`);
  } else {
    log(`  Dispatched locally: ${result.invocations?.length || 0} invocations`);
  }

  // Verify expectation
  if (wasDelegated !== expectDelegation) {
    throw new Error(
      `Expected delegation=${expectDelegation}, got delegation=${wasDelegated}`
    );
  }

  // If delegated, poll for completion
  if (wasDelegated && dispatchId) {
    log(`  Polling scatter-utility for completion...`);
    let complete = false;
    for (let i = 0; i < 60; i++) {
      const statusRes = await fetch(`${SCATTER_UTILITY_URL}/status/${dispatchId}`);
      if (!statusRes.ok) {
        throw new Error(`Status check failed: ${statusRes.status}`);
      }
      const status = await statusRes.json() as {
        status: string;
        dispatched: number;
        total: number;
        failed: number;
      };

      if (status.status === 'complete') {
        log(`  Complete: ${status.dispatched}/${status.total} dispatched, ${status.failed} failed`);
        complete = true;
        break;
      }

      if (status.status === 'error') {
        throw new Error(`Scatter-utility error: ${JSON.stringify(status)}`);
      }

      await sleep(1000);
    }

    if (!complete) {
      throw new Error('Scatter-utility did not complete in time');
    }
  }

  // Cleanup test entities
  log(`  Cleaning up ${outputs.length} test entities...`);
  const cleanupBatchSize = 20;
  for (let i = 0; i < outputs.length; i += cleanupBatchSize) {
    const batch = outputs.slice(i, i + cleanupBatchSize);
    await Promise.all(batch.map(id =>
      client.api.DELETE('/entities/{id}', { params: { path: { id } } })
    ));
  }
  await client.api.DELETE('/entities/{id}', { params: { path: { id: logEntity.id } } });

  return { delegated: wasDelegated, dispatchId };
}

// =============================================================================
// Main Test
// =============================================================================

async function main(): Promise<void> {
  log('=== Scatter Utility Integration Test ===');
  log(`API Base: ${ARKE_API_BASE}`);
  log(`Network: ${NETWORK}`);
  log(`Stamp Klados: ${STAMP_KLADOS}`);
  log(`Scatter Utility: ${SCATTER_UTILITY_URL}`);
  log(`Threshold: 50 (default)`);
  log('');

  if (!ARKE_USER_KEY) {
    throw new Error('ARKE_USER_KEY not set');
  }

  const client = new ArkeClient({
    baseUrl: ARKE_API_BASE,
    authToken: ARKE_USER_KEY,
    network: NETWORK,
  });

  // Create test collections
  log('Creating test collections...');
  const { data: targetColl, error: targetErr } = await client.api.POST('/collections', {
    body: {
      label: `Scatter Integration Test ${Date.now()}`,
      roles: { public: ['*:view', '*:invoke', 'entity:create', 'entity:update'] },
    },
  });
  if (targetErr) throw new Error(`Failed to create collection: ${targetErr.error}`);

  const { data: jobColl, error: jobErr } = await client.api.POST('/collections', {
    body: {
      label: `Scatter Integration Jobs ${Date.now()}`,
      roles: { public: ['*:view', 'entity:create', 'entity:update'] },
    },
  });
  if (jobErr) throw new Error(`Failed to create job collection: ${jobErr.error}`);

  log(`  Target collection: ${targetColl!.id}`);
  log(`  Job collection: ${jobColl!.id}`);

  // Config is optional - scatter-utility is used by default for large scatters
  // We just set threshold explicitly for clarity
  const rhizaConfig: RhizaRuntimeConfig = {
    scatterUtility: {
      threshold: 50,
    },
  };

  try {
    // Test 1: Small scatter (below threshold) - should dispatch locally
    log('');
    log('--- Test 1: Small scatter (below threshold) ---');
    const smallResult = await testScatterWithThreshold(
      client,
      targetColl!.id,
      jobColl!.id,
      SMALL_COUNT,
      rhizaConfig,
      false  // expect local dispatch
    );
    log(`  PASS: Small scatter dispatched locally`);

    // Test 2: Large scatter (above threshold) - should delegate
    log('');
    log('--- Test 2: Large scatter (above threshold) ---');
    const largeResult = await testScatterWithThreshold(
      client,
      targetColl!.id,
      jobColl!.id,
      LARGE_COUNT,
      rhizaConfig,
      true  // expect delegation
    );
    log(`  PASS: Large scatter delegated to scatter-utility`);

    // Test 3: Large scatter with forceLocal - should dispatch locally
    log('');
    log('--- Test 3: Large scatter with forceLocal ---');
    const forceLocalConfig: RhizaRuntimeConfig = {
      scatterUtility: {
        forceLocal: true,
      },
    };
    const forceLocalResult = await testScatterWithThreshold(
      client,
      targetColl!.id,
      jobColl!.id,
      LARGE_COUNT,
      forceLocalConfig,
      false  // expect local dispatch (forceLocal overrides default)
    );
    log(`  PASS: Large scatter with forceLocal dispatched locally`);

    log('');
    log('=== All Tests Passed ===');

  } finally {
    // Cleanup collections
    log('');
    log('Cleaning up collections...');
    await client.api.DELETE('/entities/{id}', { params: { path: { id: targetColl!.id } } });
    await client.api.DELETE('/entities/{id}', { params: { path: { id: jobColl!.id } } });
    log('Done');
  }
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
