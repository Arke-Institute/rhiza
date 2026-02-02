/**
 * Test Infrastructure Verification
 *
 * These tests verify that the test infrastructure is working correctly:
 * - Mock client creates, reads, updates entities
 * - Fixtures are properly typed and accessible
 * - Error simulation works
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockClient,
  type MockArkeClient,
  producerKlados,
  workerKlados,
  aggregatorKlados,
  scatterGatherKladoi,
  linearRhiza,
  scatterGatherRhiza,
  validKladosProperties,
  invalidKladosProperties,
  invalidRhizaProperties,
  successfulLinearLogs,
  partialErrorLogs,
} from '../fixtures';

describe('Mock Client', () => {
  let client: MockArkeClient;

  beforeEach(() => {
    client = createMockClient({
      kladoi: scatterGatherKladoi,
      rhizai: {
        'II01rhiza_linear': linearRhiza,
        'II01rhiza_scatter_gather': scatterGatherRhiza,
      },
    });
  });

  describe('GET operations', () => {
    it('returns klados by ID', async () => {
      const result = await client.api.GET('/kladoi/{id}', {
        params: { path: { id: 'II01klados_producer' } },
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toBeDefined();
      expect(result.data).toMatchObject({
        id: 'II01klados_producer',
        type: 'klados',
        properties: producerKlados.properties,
      });
    });

    it('returns rhiza by ID', async () => {
      const result = await client.api.GET('/rhizai/{id}', {
        params: { path: { id: 'II01rhiza_scatter_gather' } },
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toBeDefined();
      expect(result.data).toMatchObject({
        id: 'II01rhiza_scatter_gather',
        type: 'rhiza',
        properties: scatterGatherRhiza.properties,
      });
    });

    it('returns 404 for unknown klados', async () => {
      const result = await client.api.GET('/kladoi/{id}', {
        params: { path: { id: 'nonexistent' } },
      });

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('404');
    });

    it('returns entity by ID (klados)', async () => {
      const result = await client.api.GET('/entities/{id}', {
        params: { path: { id: 'II01klados_worker' } },
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toBeDefined();
      expect((result.data as { type: string }).type).toBe('klados');
    });

    it('returns tip for entity', async () => {
      const result = await client.api.GET('/entities/{id}/tip', {
        params: { path: { id: 'II01klados_producer' } },
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toBeDefined();
      expect((result.data as { cid: string }).cid).toBeDefined();
    });
  });

  describe('POST operations', () => {
    it('invokes klados and tracks invocation', async () => {
      const result = await client.api.POST('/kladoi/{id}/invoke', {
        params: { path: { id: 'II01klados_worker' } },
        body: {
          target: 'entity_123',
          job_collection: 'job_col_1',
          confirm: true,
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({
        accepted: true,
        status: 'started',
      });

      const invocations = client.getInvokedKladoi();
      expect(invocations).toHaveLength(1);
      expect(invocations[0].kladosId).toBe('II01klados_worker');
      expect(invocations[0].request).toMatchObject({
        target: 'entity_123',
        confirm: true,
      });
    });

    it('creates entity and tracks creation', async () => {
      const result = await client.api.POST('/entities', {
        body: {
          type: 'batch',
          collection: 'job_col_1',
          properties: { total: 3, completed: 0 },
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toBeDefined();
      expect((result.data as { id: string }).id).toBeDefined();

      const created = client.getCreated();
      expect(created).toHaveLength(1);
      expect(created[0].type).toBe('batch');
    });
  });

  describe('PUT operations', () => {
    it('updates entity and tracks update', async () => {
      // First create an entity
      const createResult = await client.api.POST('/entities', {
        body: { type: 'test', properties: { value: 1 } },
      });
      const entityId = (createResult.data as { id: string }).id;

      // Then update it
      const result = await client.api.PUT('/entities/{id}', {
        params: { path: { id: entityId } },
        body: {
          properties: { value: 2 },
          expect_tip: 'some_cid',
        },
      });

      expect(result.error).toBeUndefined();

      const updated = client.getUpdated();
      expect(updated).toHaveLength(1);
      expect(updated[0].id).toBe(entityId);
    });
  });

  describe('error simulation', () => {
    it('returns 404 for configured not found entities', async () => {
      const errorClient = createMockClient({
        kladoi: scatterGatherKladoi,
        errors: {
          notFound: ['II01klados_producer'],
        },
      });

      const result = await errorClient.api.GET('/kladoi/{id}', {
        params: { path: { id: 'II01klados_producer' } },
      });

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('404');
    });

    it('simulates CAS conflicts on update', async () => {
      const errorClient = createMockClient({
        kladoi: scatterGatherKladoi,
        errors: {
          onUpdate: 2, // Fail first 2 updates
        },
      });

      // First update should fail
      const result1 = await errorClient.api.PUT('/entities/{id}', {
        params: { path: { id: 'II01klados_producer' } },
        body: { properties: { value: 1 } },
      });
      expect(result1.error).toBeDefined();
      expect(result1.error?.code).toBe('409');

      // Second update should also fail
      const result2 = await errorClient.api.PUT('/entities/{id}', {
        params: { path: { id: 'II01klados_producer' } },
        body: { properties: { value: 2 } },
      });
      expect(result2.error).toBeDefined();

      // Third update should succeed
      const result3 = await errorClient.api.PUT('/entities/{id}', {
        params: { path: { id: 'II01klados_producer' } },
        body: { properties: { value: 3 } },
      });
      expect(result3.error).toBeUndefined();
    });

    it('simulates invoke errors', async () => {
      const errorClient = createMockClient({
        kladoi: scatterGatherKladoi,
        errors: {
          onInvoke: {
            'II01klados_worker': 'Service unavailable',
          },
        },
      });

      const result = await errorClient.api.POST('/kladoi/{id}/invoke', {
        params: { path: { id: 'II01klados_worker' } },
        body: { target: 'entity_123' },
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Service unavailable');
    });
  });

  describe('reset', () => {
    it('clears tracked mutations', async () => {
      await client.api.POST('/kladoi/{id}/invoke', {
        params: { path: { id: 'II01klados_worker' } },
        body: { target: 'entity_123' },
      });

      expect(client.getInvokedKladoi()).toHaveLength(1);

      client.reset();

      expect(client.getInvokedKladoi()).toHaveLength(0);
      expect(client.getCreated()).toHaveLength(0);
      expect(client.getUpdated()).toHaveLength(0);
    });
  });
});

describe('Klados Fixtures', () => {
  it('producer has correct cardinality for scatter', () => {
    expect(producerKlados.properties.produces.cardinality).toBe('many');
    expect(producerKlados.properties.accepts.cardinality).toBe('one');
  });

  it('worker has correct cardinality for scatter target', () => {
    expect(workerKlados.properties.accepts.cardinality).toBe('one');
    expect(workerKlados.properties.produces.cardinality).toBe('one');
  });

  it('aggregator has correct cardinality for gather', () => {
    expect(aggregatorKlados.properties.accepts.cardinality).toBe('many');
    expect(aggregatorKlados.properties.produces.cardinality).toBe('one');
  });

  it('valid klados properties pass basic checks', () => {
    expect(validKladosProperties.endpoint).toMatch(/^https?:\/\//);
    expect(validKladosProperties.actions_required.length).toBeGreaterThan(0);
    expect(validKladosProperties.accepts.types.length).toBeGreaterThan(0);
    expect(validKladosProperties.produces.types.length).toBeGreaterThan(0);
  });

  it('invalid klados properties have expected issues', () => {
    expect(invalidKladosProperties.missingEndpoint).not.toHaveProperty('endpoint');
    expect(invalidKladosProperties.invalidEndpoint.endpoint).not.toMatch(/^https?:\/\//);
    expect(invalidKladosProperties.emptyAcceptsTypes.accepts.types).toHaveLength(0);
    expect(invalidKladosProperties.emptyProducesTypes.produces.types).toHaveLength(0);
    expect(invalidKladosProperties.emptyActionsRequired.actions_required).toHaveLength(0);
  });
});

describe('Rhiza Fixtures', () => {
  it('linear rhiza has correct entry', () => {
    expect(linearRhiza.properties.entry.pi).toBe('II01klados_a');
    expect(linearRhiza.properties.flow['II01klados_a']).toBeDefined();
  });

  it('scatter-gather rhiza has correct flow structure', () => {
    const flow = scatterGatherRhiza.properties.flow;

    // Producer scatters to worker
    expect(flow['II01klados_producer'].then).toHaveProperty('scatter');
    expect((flow['II01klados_producer'].then as { scatter: { pi: string } }).scatter.pi).toBe('II01klados_worker');

    // Worker gathers to aggregator
    expect(flow['II01klados_worker'].then).toHaveProperty('gather');
    expect((flow['II01klados_worker'].then as { gather: { pi: string } }).gather.pi).toBe('II01klados_aggregator');

    // Aggregator is terminal
    expect(flow['II01klados_aggregator'].then).toHaveProperty('done');
  });

  it('invalid rhiza properties have expected issues', () => {
    expect(invalidRhizaProperties.missingEntry).not.toHaveProperty('entry');
    expect(invalidRhizaProperties.entryNotInFlow.entry.pi).toBe('II01klados_nonexistent');
    expect(invalidRhizaProperties.emptyFlow.flow).toEqual({});
  });
});

describe('Log Fixtures', () => {
  it('successful linear logs form a chain', () => {
    const logs = successfulLinearLogs;

    // Root has no from_logs
    expect(logs[0].received.from_logs).toBeUndefined();

    // Second log points to first
    expect(logs[1].received.from_logs).toContain(logs[0].id);

    // Third log points to second
    expect(logs[2].received.from_logs).toContain(logs[1].id);
  });

  it('partial error logs contain one error', () => {
    const errorLogs = partialErrorLogs.filter((l) => l.status === 'error');
    expect(errorLogs).toHaveLength(1);

    const errorLog = errorLogs[0];
    expect(errorLog.error).toBeDefined();
    expect(errorLog.error?.retryable).toBe(true);
  });

  it('error logs have invocation for resume', () => {
    const errorLog = partialErrorLogs.find((l) => l.status === 'error');
    expect(errorLog?.received.invocation).toBeDefined();
    expect(errorLog?.received.invocation?.request).toBeDefined();
  });
});
