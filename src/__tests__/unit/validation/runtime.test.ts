/**
 * Runtime Validation Tests
 *
 * Tests for validateRhizaRuntime() which validates a rhiza at invoke time.
 * This requires loading all targets from the API and checking:
 * - All targets exist (as klados or rhiza) and are active
 * - Cardinality compatibility between producers and consumers
 * - Type compatibility (warnings only)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { validateRhizaRuntime } from '../../../validation';
import {
  createMockClient,
  type MockArkeClient,
  scatterGatherKladoi,
  linearKladoi,
  scatterGatherRhizaProperties,
  linearRhizaProperties,
  producerKlados,
  workerKlados,
  aggregatorKlados,
  passthroughKlados,
  inactiveKlados,
} from '../../fixtures';

describe('validateRhizaRuntime', () => {
  let client: MockArkeClient;

  beforeEach(() => {
    client = createMockClient({
      kladoi: {
        ...scatterGatherKladoi,
        ...linearKladoi,
      },
    });
  });

  // =========================================================================
  // Target Resolution
  // =========================================================================

  describe('target resolution', () => {
    it('passes when all kladoi exist and are active', async () => {
      const result = await validateRhizaRuntime(client, linearRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns loaded kladoi map on success', async () => {
      const result = await validateRhizaRuntime(client, linearRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.kladoi.size).toBe(3); // a, b, c
      expect(result.kladoi.has('II01klados_a')).toBe(true);
      expect(result.kladoi.has('II01klados_b')).toBe(true);
      expect(result.kladoi.has('II01klados_c')).toBe(true);
    });

    it('fails when klados not found', async () => {
      const clientWithMissing = createMockClient({
        kladoi: {
          'II01klados_a': passthroughKlados,
          // Missing: II01klados_b, II01klados_c
        },
      });

      const result = await validateRhizaRuntime(clientWithMissing, linearRhizaProperties);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'TARGET_NOT_FOUND',
        })
      );
    });

    it('fails when klados is not active (disabled)', async () => {
      const clientWithInactive = createMockClient({
        kladoi: {
          'II01klados_a': passthroughKlados,
          'II01klados_b': inactiveKlados, // status: 'disabled'
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithInactive, linearRhizaProperties);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'KLADOS_NOT_ACTIVE',
        })
      );
    });

    it('fails when klados is not active (development)', async () => {
      const clientWithDev = createMockClient({
        kladoi: {
          'II01klados_a': passthroughKlados,
          'II01klados_b': {
            properties: { ...passthroughKlados.properties, status: 'development' },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithDev, linearRhizaProperties);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'KLADOS_NOT_ACTIVE',
        })
      );
    });

    it('reports all missing targets, not just first', async () => {
      const clientWithNone = createMockClient({
        kladoi: {},
      });

      const result = await validateRhizaRuntime(clientWithNone, linearRhizaProperties);

      expect(result.valid).toBe(false);
      const notFoundErrors = result.errors.filter((e) => e.code === 'TARGET_NOT_FOUND');
      expect(notFoundErrors.length).toBe(3); // All three are missing
    });
  });

  // =========================================================================
  // Cardinality Validation - Scatter
  // =========================================================================

  describe('scatter cardinality validation', () => {
    it('passes when scatter klados produces many', async () => {
      const result = await validateRhizaRuntime(client, scatterGatherRhizaProperties);

      expect(result.valid).toBe(true);
    });

    it('fails when scatter klados produces one', async () => {
      // Create a producer that produces 'one' instead of 'many'
      const clientWithBadProducer = createMockClient({
        kladoi: {
          'II01klados_producer': {
            properties: {
              ...producerKlados.properties,
              produces: { types: ['item/*'], cardinality: 'one' }, // Wrong!
            },
          },
          'II01klados_worker': workerKlados,
          'II01klados_aggregator': aggregatorKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithBadProducer, scatterGatherRhizaProperties);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'PRODUCER_CARDINALITY_MISMATCH',
        })
      );
    });

    it('fails when scatter target accepts many (should accept one)', async () => {
      // Create a worker that accepts 'many' instead of 'one'
      const clientWithBadWorker = createMockClient({
        kladoi: {
          'II01klados_producer': producerKlados,
          'II01klados_worker': {
            properties: {
              ...workerKlados.properties,
              accepts: { types: ['item/*'], cardinality: 'many' }, // Wrong!
            },
          },
          'II01klados_aggregator': aggregatorKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithBadWorker, scatterGatherRhizaProperties);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'TARGET_CARDINALITY_MISMATCH',
        })
      );
    });
  });

  // =========================================================================
  // Cardinality Validation - Gather
  // =========================================================================

  describe('gather cardinality validation', () => {
    it('passes when gather target accepts many', async () => {
      const result = await validateRhizaRuntime(client, scatterGatherRhizaProperties);

      expect(result.valid).toBe(true);
    });

    it('fails when gather target accepts one (should accept many)', async () => {
      // Create an aggregator that accepts 'one' instead of 'many'
      const clientWithBadAggregator = createMockClient({
        kladoi: {
          'II01klados_producer': producerKlados,
          'II01klados_worker': workerKlados,
          'II01klados_aggregator': {
            properties: {
              ...aggregatorKlados.properties,
              accepts: { types: ['result/*'], cardinality: 'one' }, // Wrong!
            },
          },
        },
      });

      const result = await validateRhizaRuntime(clientWithBadAggregator, scatterGatherRhizaProperties);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'TARGET_CARDINALITY_MISMATCH',
        })
      );
    });
  });

  // =========================================================================
  // Cardinality Validation - Pass
  // =========================================================================

  describe('pass cardinality validation', () => {
    it('passes when cardinalities match (one to one)', async () => {
      const result = await validateRhizaRuntime(client, linearRhizaProperties);

      expect(result.valid).toBe(true);
      // No cardinality mismatch warning
      const cardinalityWarnings = result.warnings.filter((w) => w.code === 'CARDINALITY_MISMATCH');
      expect(cardinalityWarnings).toHaveLength(0);
    });

    it('warns about cardinality mismatch in pass (many to one)', async () => {
      const clientWithMismatch = createMockClient({
        kladoi: {
          'II01klados_a': {
            properties: {
              ...passthroughKlados.properties,
              produces: { types: ['*'], cardinality: 'many' }, // Produces many
            },
          },
          'II01klados_b': {
            properties: {
              ...passthroughKlados.properties,
              accepts: { types: ['*'], cardinality: 'one' }, // Accepts one
            },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithMismatch, linearRhizaProperties);

      // Valid but with warning
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'CARDINALITY_MISMATCH',
        })
      );
    });

    it('warns about cardinality mismatch in pass (one to many)', async () => {
      const clientWithMismatch = createMockClient({
        kladoi: {
          'II01klados_a': {
            properties: {
              ...passthroughKlados.properties,
              produces: { types: ['*'], cardinality: 'one' }, // Produces one
            },
          },
          'II01klados_b': {
            properties: {
              ...passthroughKlados.properties,
              accepts: { types: ['*'], cardinality: 'many' }, // Accepts many
            },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithMismatch, linearRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'CARDINALITY_MISMATCH',
        })
      );
    });
  });

  // =========================================================================
  // Type Compatibility
  // =========================================================================

  describe('type compatibility', () => {
    it('passes without warning when types match exactly', async () => {
      const clientWithMatchingTypes = createMockClient({
        kladoi: {
          'II01klados_a': {
            properties: {
              ...passthroughKlados.properties,
              produces: { types: ['file/pdf'], cardinality: 'one' },
            },
          },
          'II01klados_b': {
            properties: {
              ...passthroughKlados.properties,
              accepts: { types: ['file/pdf'], cardinality: 'one' },
            },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithMatchingTypes, linearRhizaProperties);

      expect(result.valid).toBe(true);
      const typeWarnings = result.warnings.filter((w) => w.code === 'TYPE_MISMATCH');
      expect(typeWarnings).toHaveLength(0);
    });

    it('passes without warning when producer uses wildcard', async () => {
      const clientWithWildcard = createMockClient({
        kladoi: {
          'II01klados_a': {
            properties: {
              ...passthroughKlados.properties,
              produces: { types: ['*'], cardinality: 'one' },
            },
          },
          'II01klados_b': {
            properties: {
              ...passthroughKlados.properties,
              accepts: { types: ['file/pdf'], cardinality: 'one' },
            },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithWildcard, linearRhizaProperties);

      expect(result.valid).toBe(true);
      const typeWarnings = result.warnings.filter((w) => w.code === 'TYPE_MISMATCH');
      expect(typeWarnings).toHaveLength(0);
    });

    it('passes without warning when consumer uses wildcard', async () => {
      const clientWithWildcard = createMockClient({
        kladoi: {
          'II01klados_a': {
            properties: {
              ...passthroughKlados.properties,
              produces: { types: ['file/pdf'], cardinality: 'one' },
            },
          },
          'II01klados_b': {
            properties: {
              ...passthroughKlados.properties,
              accepts: { types: ['*'], cardinality: 'one' },
            },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithWildcard, linearRhizaProperties);

      expect(result.valid).toBe(true);
      const typeWarnings = result.warnings.filter((w) => w.code === 'TYPE_MISMATCH');
      expect(typeWarnings).toHaveLength(0);
    });

    it('warns about type mismatch when types do not overlap', async () => {
      const clientWithTypeMismatch = createMockClient({
        kladoi: {
          'II01klados_a': {
            properties: {
              ...passthroughKlados.properties,
              produces: { types: ['file/pdf'], cardinality: 'one' },
            },
          },
          'II01klados_b': {
            properties: {
              ...passthroughKlados.properties,
              accepts: { types: ['file/jpeg'], cardinality: 'one' }, // Mismatch!
            },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithTypeMismatch, linearRhizaProperties);

      // Valid but with warning
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'TYPE_MISMATCH',
        })
      );
    });

    it('passes when glob pattern matches (file/* accepts file/pdf)', async () => {
      const clientWithGlob = createMockClient({
        kladoi: {
          'II01klados_a': {
            properties: {
              ...passthroughKlados.properties,
              produces: { types: ['file/pdf'], cardinality: 'one' },
            },
          },
          'II01klados_b': {
            properties: {
              ...passthroughKlados.properties,
              accepts: { types: ['file/*'], cardinality: 'one' }, // Glob pattern
            },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithGlob, linearRhizaProperties);

      expect(result.valid).toBe(true);
      const typeWarnings = result.warnings.filter((w) => w.code === 'TYPE_MISMATCH');
      expect(typeWarnings).toHaveLength(0);
    });

    it('passes when multiple producer types overlap with accepted types', async () => {
      const clientWithMultiple = createMockClient({
        kladoi: {
          'II01klados_a': {
            properties: {
              ...passthroughKlados.properties,
              produces: { types: ['file/pdf', 'file/doc', 'file/txt'], cardinality: 'one' },
            },
          },
          'II01klados_b': {
            properties: {
              ...passthroughKlados.properties,
              accepts: { types: ['file/doc', 'file/txt'], cardinality: 'one' }, // Partial overlap
            },
          },
          'II01klados_c': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithMultiple, linearRhizaProperties);

      expect(result.valid).toBe(true);
      const typeWarnings = result.warnings.filter((w) => w.code === 'TYPE_MISMATCH');
      expect(typeWarnings).toHaveLength(0);
    });
  });

  // =========================================================================
  // Rhiza Targets (Sub-workflows)
  // =========================================================================

  describe('rhiza targets', () => {
    it('passes when target is a valid active rhiza', async () => {
      // Flow that references a sub-rhiza
      const flowWithSubRhiza = {
        label: 'Main Workflow',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { pass: 'II01rhiza_sub' } },
          'II01rhiza_sub': { then: { done: true } }, // This is actually a rhiza reference
        },
        status: 'active' as const,
      };

      const clientWithRhiza = createMockClient({
        kladoi: {
          'II01klados_a': passthroughKlados,
        },
        rhizai: {
          'II01rhiza_sub': {
            properties: {
              label: 'Sub Workflow',
              version: '1.0.0',
              entry: 'II01klados_sub_a',
              flow: {
                'II01klados_sub_a': { then: { done: true } },
              },
              status: 'active',
            },
          },
        },
      });

      const result = await validateRhizaRuntime(clientWithRhiza, flowWithSubRhiza);

      expect(result.valid).toBe(true);
      expect(result.rhizai.has('II01rhiza_sub')).toBe(true);
    });

    it('fails when sub-rhiza is not active', async () => {
      const flowWithSubRhiza = {
        label: 'Main Workflow',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { pass: 'II01rhiza_sub' } },
          'II01rhiza_sub': { then: { done: true } },
        },
        status: 'active' as const,
      };

      const clientWithInactiveRhiza = createMockClient({
        kladoi: {
          'II01klados_a': passthroughKlados,
        },
        rhizai: {
          'II01rhiza_sub': {
            properties: {
              label: 'Sub Workflow',
              version: '1.0.0',
              entry: 'II01klados_sub_a',
              flow: {
                'II01klados_sub_a': { then: { done: true } },
              },
              status: 'disabled', // Not active!
            },
          },
        },
      });

      const result = await validateRhizaRuntime(clientWithInactiveRhiza, flowWithSubRhiza);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'RHIZA_NOT_ACTIVE',
        })
      );
    });
  });

  // =========================================================================
  // Route Targets
  // =========================================================================

  describe('route targets', () => {
    it('validates all route target kladoi', async () => {
      const flowWithRoutes = {
        label: 'Conditional Workflow',
        version: '1.0.0',
        entry: 'II01klados_router',
        flow: {
          'II01klados_router': {
            then: {
              pass: 'II01klados_default',
              route: [
                { where: { property: 'type', equals: 'pdf' }, target: 'II01klados_pdf' },
                { where: { property: 'type', equals: 'image' }, target: 'II01klados_image' },
              ],
            },
          },
          'II01klados_default': { then: { done: true } },
          'II01klados_pdf': { then: { done: true } },
          'II01klados_image': { then: { done: true } },
        },
        status: 'active' as const,
      };

      const clientWithAllTargets = createMockClient({
        kladoi: {
          'II01klados_router': passthroughKlados,
          'II01klados_default': passthroughKlados,
          'II01klados_pdf': passthroughKlados,
          'II01klados_image': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientWithAllTargets, flowWithRoutes);

      expect(result.valid).toBe(true);
      expect(result.kladoi.size).toBe(4);
    });

    it('fails when route target klados not found', async () => {
      const flowWithRoutes = {
        label: 'Conditional Workflow',
        version: '1.0.0',
        entry: 'II01klados_router',
        flow: {
          'II01klados_router': {
            then: {
              pass: 'II01klados_default',
              route: [
                { where: { property: 'type', equals: 'pdf' }, target: 'II01klados_missing' },
              ],
            },
          },
          'II01klados_default': { then: { done: true } },
          'II01klados_missing': { then: { done: true } },
        },
        status: 'active' as const,
      };

      const clientMissingRouteTarget = createMockClient({
        kladoi: {
          'II01klados_router': passthroughKlados,
          'II01klados_default': passthroughKlados,
          // Missing: II01klados_missing
        },
      });

      const result = await validateRhizaRuntime(clientMissingRouteTarget, flowWithRoutes);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'TARGET_NOT_FOUND',
        })
      );
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles single klados workflow', async () => {
      const singleKladosFlow = {
        label: 'Single',
        version: '1.0.0',
        entry: 'II01klados_only',
        flow: {
          'II01klados_only': { then: { done: true } },
        },
        status: 'active' as const,
      };

      const clientSingle = createMockClient({
        kladoi: {
          'II01klados_only': passthroughKlados,
        },
      });

      const result = await validateRhizaRuntime(clientSingle, singleKladosFlow);

      expect(result.valid).toBe(true);
      expect(result.kladoi.size).toBe(1);
    });

    it('skips cardinality validation when target not found', async () => {
      // If we can't load the target, we shouldn't try to validate cardinality
      const result = await validateRhizaRuntime(
        createMockClient({ kladoi: {} }),
        linearRhizaProperties
      );

      expect(result.valid).toBe(false);
      // Should have TARGET_NOT_FOUND but not cardinality errors
      expect(result.errors.every((e) =>
        e.code === 'TARGET_NOT_FOUND' || e.code.includes('NOT_ACTIVE')
      )).toBe(true);
    });
  });
});
