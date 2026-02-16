/**
 * Rhiza Validation Tests
 *
 * Tests for validateRhizaProperties() which validates rhiza entity properties
 * at creation/update time (static validation).
 *
 * Validation Rules:
 * - entry: Required, must be in flow (step name)
 * - flow: Required, non-empty
 * - Each step must have klados field
 * - All targets must exist in flow (step names)
 * - All paths must terminate (done: true)
 * - No cycles allowed
 * - Route rules must have valid where and target
 *
 * NOTE: Uses step-based flow format where:
 * - entry is a step name (string)
 * - flow keys are step names
 * - each step has { klados: EntityRef, then: ThenSpec }
 * - ThenSpec targets are step names (strings)
 */

import { describe, it, expect } from 'vitest';
import { validateRhizaProperties } from '../../../validation';
import { ref } from '../../../types';
import type { RouteRule } from '../../../types';
import {
  linearRhizaProperties,
  scatterGatherRhizaProperties,
  conditionalRhizaProperties,
  complexRoutingRhizaProperties,
  invalidRhizaProperties,
} from '../../fixtures';

describe('validateRhizaProperties', () => {
  // =========================================================================
  // Valid Cases
  // =========================================================================

  describe('valid rhiza properties', () => {
    it('passes for valid linear flow', () => {
      const result = validateRhizaProperties(linearRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for valid scatter-gather flow', () => {
      const result = validateRhizaProperties(scatterGatherRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for valid conditional flow with routes', () => {
      const result = validateRhizaProperties(conditionalRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for complex routing with AND/OR conditions', () => {
      const result = validateRhizaProperties(complexRoutingRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for single klados workflow (entry is terminal)', () => {
      const result = validateRhizaProperties({
        label: 'Single Klados',
        version: '1.0.0',
        entry: 'only_step',
        flow: {
          'only_step': { klados: ref('II01klados_only', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // =========================================================================
  // Entry Validation
  // =========================================================================

  describe('entry validation', () => {
    it('fails when entry step name is missing', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.missingEntry);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_ENTRY',
          field: 'entry',
        })
      );
    });

    it('fails when entry step name is not in flow', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.entryNotInFlow);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'ENTRY_NOT_IN_FLOW',
          field: 'entry',
        })
      );
    });

    it('fails when entry is empty string', () => {
      const result = validateRhizaProperties({
        label: 'Empty Entry',
        version: '1.0.0',
        entry: '',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_ENTRY',
        })
      );
    });
  });

  // =========================================================================
  // Flow Validation
  // =========================================================================

  describe('flow validation', () => {
    it('fails when flow is empty', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.emptyFlow);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'EMPTY_FLOW',
          field: 'flow',
        })
      );
    });

    it('fails when flow is missing', () => {
      const result = validateRhizaProperties({
        label: 'Missing Flow',
        version: '1.0.0',
        entry: 'step_a',
        status: 'active',
      } as Record<string, unknown>);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'EMPTY_FLOW',
        })
      );
    });
  });

  // =========================================================================
  // Target Validation
  // =========================================================================

  describe('target validation', () => {
    it('fails when target step name does not exist in flow', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.targetNotInFlow);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_TARGET',
        })
      );
    });

    it('fails when scatter target does not exist in flow', () => {
      const result = validateRhizaProperties({
        label: 'Invalid Scatter Target',
        version: '1.0.0',
        entry: 'producer_step',
        flow: {
          'producer_step': { klados: ref('II01klados_producer', { type: 'klados' }), then: { scatter: 'nonexistent_step' } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_TARGET',
        })
      );
    });

    it('fails when gather target does not exist in flow', () => {
      const result = validateRhizaProperties({
        label: 'Invalid Gather Target',
        version: '1.0.0',
        entry: 'worker_step',
        flow: {
          'worker_step': { klados: ref('II01klados_worker', { type: 'klados' }), then: { gather: 'nonexistent_step' } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_TARGET',
        })
      );
    });
  });

  // =========================================================================
  // Cycle Detection
  // =========================================================================

  describe('cycle detection', () => {
    it('fails when cycle detected (A -> B -> C -> A)', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.cycleDetected);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'CYCLE_DETECTED',
        })
      );
    });

    it('fails when simple cycle (A -> B -> A)', () => {
      const result = validateRhizaProperties({
        label: 'Simple Cycle',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { pass: 'step_a' } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'CYCLE_DETECTED',
        })
      );
    });

    it('fails when self-referencing (A -> A)', () => {
      const result = validateRhizaProperties({
        label: 'Self Reference',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_a' } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'CYCLE_DETECTED',
        })
      );
    });

    it('cycle error message includes the cycle path', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.cycleDetected);

      const cycleError = result.errors.find((e) => e.code === 'CYCLE_DETECTED');
      expect(cycleError?.message).toContain('->');
    });

    it('does NOT flag recurse as a cycle (recurse is allowed)', () => {
      const result = validateRhizaProperties({
        label: 'Recurse Loop',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { recurse: 'step_a' } },
        },
        status: 'active',
      });

      // Recurse should NOT be flagged as a cycle
      expect(result.valid).toBe(true);
      expect(result.errors.filter(e => e.code === 'CYCLE_DETECTED')).toHaveLength(0);
    });

    it('does NOT flag recurse self-reference as a cycle', () => {
      const result = validateRhizaProperties({
        label: 'Self Recurse',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { recurse: 'step_a' } },
        },
        status: 'active',
      });

      // Recurse to self should be valid (bounded by max_depth)
      expect(result.valid).toBe(true);
      expect(result.errors.filter(e => e.code === 'CYCLE_DETECTED')).toHaveLength(0);
    });

    it('still flags regular pass cycles even when recurse is present elsewhere', () => {
      const result = validateRhizaProperties({
        label: 'Mixed Cycles',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { pass: 'step_c' } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { pass: 'step_a' } },  // Regular cycle - should fail
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'CYCLE_DETECTED',
        })
      );
    });
  });

  // =========================================================================
  // Unreachable Detection
  // =========================================================================

  describe('unreachable detection', () => {
    it('warns about unreachable steps', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.unreachableStep);

      // Valid but with warning
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'UNREACHABLE_KLADOS',
        })
      );
    });

    it('warns about multiple unreachable steps', () => {
      const result = validateRhizaProperties({
        label: 'Multiple Orphans',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { done: true } },
          'orphan_step_1': { klados: ref('II01klados_orphan1', { type: 'klados' }), then: { done: true } },
          'orphan_step_2': { klados: ref('II01klados_orphan2', { type: 'klados' }), then: { pass: 'orphan_step_1' } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.filter((w) => w.code === 'UNREACHABLE_KLADOS')).toHaveLength(2);
    });
  });

  // =========================================================================
  // Then Spec Validation
  // =========================================================================

  describe('then spec validation', () => {
    it('fails when then spec is missing', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.missingThen);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_THEN',
        })
      );
    });

    it('fails when then has unknown handoff type', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.invalidHandoff);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_HANDOFF',
        })
      );
    });

    it('accepts done: true as terminal', () => {
      const result = validateRhizaProperties({
        label: 'Terminal Test',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts pass handoff', () => {
      const result = validateRhizaProperties({
        label: 'Pass Test',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts scatter handoff', () => {
      const result = validateRhizaProperties({
        label: 'Scatter Test',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { scatter: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts gather handoff', () => {
      const result = validateRhizaProperties({
        label: 'Gather Test',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { gather: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts recurse handoff', () => {
      const result = validateRhizaProperties({
        label: 'Recurse Test',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { recurse: 'step_a' } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts recurse handoff with max_depth', () => {
      const result = validateRhizaProperties({
        label: 'Recurse with Depth',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { recurse: 'step_a', max_depth: 20 } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('fails when recurse max_depth is negative', () => {
      const result = validateRhizaProperties({
        label: 'Invalid Max Depth',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { recurse: 'step_a', max_depth: -1 } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_MAX_DEPTH',
        })
      );
    });

    it('fails when recurse max_depth is zero', () => {
      const result = validateRhizaProperties({
        label: 'Zero Max Depth',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { recurse: 'step_a', max_depth: 0 } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_MAX_DEPTH',
        })
      );
    });

    it('fails when recurse max_depth is not an integer', () => {
      const result = validateRhizaProperties({
        label: 'Float Max Depth',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { recurse: 'step_a', max_depth: 10.5 } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_MAX_DEPTH',
        })
      );
    });

    it('fails when recurse target does not exist', () => {
      const result = validateRhizaProperties({
        label: 'Invalid Recurse Target',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { recurse: 'nonexistent' } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_TARGET',
        })
      );
    });

    it('accepts recurse with route rules', () => {
      const result = validateRhizaProperties({
        label: 'Recurse with Routes',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
          'step_b': {
            klados: ref('II01klados_b', { type: 'klados' }),
            then: {
              recurse: 'step_a',
              max_depth: 10,
              route: [
                { where: { property: 'should_terminate', equals: true }, target: 'done' },
              ],
            },
          },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });
  });

  // =========================================================================
  // Route Rules Validation
  // =========================================================================

  describe('route rules validation', () => {
    it('fails when route rule is missing where condition', () => {
      const result = validateRhizaProperties({
        label: 'Missing Where',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [{ target: 'step_c' }] as unknown as RouteRule[],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_ROUTE_RULE',
        })
      );
    });

    it('fails when route rule is missing target', () => {
      const result = validateRhizaProperties({
        label: 'Missing Target',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [{ where: { property: 'type', equals: 'test' } }] as unknown as RouteRule[],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_ROUTE_RULE',
        })
      );
    });

    it('accepts valid route rules with simple where condition', () => {
      const result = validateRhizaProperties({
        label: 'Valid Route',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [
                { where: { property: 'type', equals: 'special' }, target: 'step_c' },
              ],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts route rules with AND condition', () => {
      const result = validateRhizaProperties({
        label: 'AND Route',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [
                {
                  where: {
                    and: [
                      { property: 'type', equals: 'file' },
                      { property: 'size', equals: 'large' },
                    ],
                  },
                  target: 'step_c',
                },
              ],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts route rules with OR condition', () => {
      const result = validateRhizaProperties({
        label: 'OR Route',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [
                {
                  where: {
                    or: [
                      { property: 'type', equals: 'jpeg' },
                      { property: 'type', equals: 'png' },
                    ],
                  },
                  target: 'step_c',
                },
              ],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts route rules with nested AND/OR conditions', () => {
      const result = validateRhizaProperties({
        label: 'Nested Route',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [
                {
                  where: {
                    and: [
                      { property: 'type', equals: 'file' },
                      {
                        or: [
                          { property: 'format', equals: 'jpeg' },
                          { property: 'format', equals: 'png' },
                        ],
                      },
                    ],
                  },
                  target: 'step_c',
                },
              ],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('fails for invalid where condition format', () => {
      const result = validateRhizaProperties({
        label: 'Invalid Where',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [
                {
                  where: { invalid: 'condition' } as unknown as { property: string; equals: string },
                  target: 'step_c',
                },
              ],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_WHERE_CONDITION',
        })
      );
    });

    it('fails for empty AND array', () => {
      const result = validateRhizaProperties({
        label: 'Empty AND',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [
                {
                  where: { and: [] },
                  target: 'step_c',
                },
              ],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_WHERE_CONDITION',
        })
      );
    });

    it('fails for empty OR array', () => {
      const result = validateRhizaProperties({
        label: 'Empty OR',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_b',
              route: [
                {
                  where: { or: [] },
                  target: 'step_c',
                },
              ],
            },
          },
          'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
          'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_WHERE_CONDITION',
        })
      );
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles undefined input gracefully', () => {
      const result = validateRhizaProperties(undefined);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles null input gracefully', () => {
      const result = validateRhizaProperties(null);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles empty object input', () => {
      const result = validateRhizaProperties({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles multiple route rules', () => {
      const result = validateRhizaProperties({
        label: 'Multiple Routes',
        version: '1.0.0',
        entry: 'step_a',
        flow: {
          'step_a': {
            klados: ref('II01klados_a', { type: 'klados' }),
            then: {
              pass: 'step_default',
              route: [
                { where: { property: 'type', equals: 'pdf' }, target: 'step_pdf' },
                { where: { property: 'type', equals: 'image' }, target: 'step_image' },
                { where: { property: 'type', equals: 'text' }, target: 'step_text' },
              ],
            },
          },
          'step_default': { klados: ref('II01klados_default', { type: 'klados' }), then: { done: true } },
          'step_pdf': { klados: ref('II01klados_pdf', { type: 'klados' }), then: { done: true } },
          'step_image': { klados: ref('II01klados_image', { type: 'klados' }), then: { done: true } },
          'step_text': { klados: ref('II01klados_text', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('handles deeply nested workflow', () => {
      const result = validateRhizaProperties({
        label: 'Deep Flow',
        version: '1.0.0',
        entry: 'step_1',
        flow: {
          'step_1': { klados: ref('II01klados_1', { type: 'klados' }), then: { pass: 'step_2' } },
          'step_2': { klados: ref('II01klados_2', { type: 'klados' }), then: { pass: 'step_3' } },
          'step_3': { klados: ref('II01klados_3', { type: 'klados' }), then: { pass: 'step_4' } },
          'step_4': { klados: ref('II01klados_4', { type: 'klados' }), then: { pass: 'step_5' } },
          'step_5': { klados: ref('II01klados_5', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('allows same klados in multiple steps', () => {
      const result = validateRhizaProperties({
        label: 'Duplicate Klados',
        version: '1.0.0',
        entry: 'first_stamp',
        flow: {
          'first_stamp': { klados: ref('II01klados_stamp', { type: 'klados' }), then: { pass: 'second_stamp' } },
          'second_stamp': { klados: ref('II01klados_stamp', { type: 'klados' }), then: { pass: 'third_stamp' } },
          'third_stamp': { klados: ref('II01klados_stamp', { type: 'klados' }), then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });
  });
});
