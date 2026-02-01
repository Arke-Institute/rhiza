/**
 * Rhiza Validation Tests
 *
 * Tests for validateRhizaProperties() which validates rhiza entity properties
 * at creation/update time (static validation).
 *
 * Validation Rules:
 * - entry: Required, must be in flow
 * - flow: Required, non-empty
 * - All targets must exist in flow (or be external rhiza IDs)
 * - All paths must terminate (done: true)
 * - No cycles allowed
 * - Route rules must have valid where and target
 */

import { describe, it, expect } from 'vitest';
import { validateRhizaProperties } from '../../../validation';
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
        entry: 'II01klados_only',
        flow: {
          'II01klados_only': { then: { done: true } },
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
    it('fails when entry klados ID is missing', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.missingEntry);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_ENTRY',
          field: 'entry',
        })
      );
    });

    it('fails when entry klados ID is not in flow', () => {
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
          'II01klados_a': { then: { done: true } },
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
        entry: 'II01klados_a',
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
    it('fails when target klados ID does not exist in flow', () => {
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
        entry: 'II01klados_producer',
        flow: {
          'II01klados_producer': { then: { scatter: 'nonexistent' } },
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
        entry: 'II01klados_worker',
        flow: {
          'II01klados_worker': { then: { gather: 'nonexistent' } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { pass: 'II01klados_b' } },
          'II01klados_b': { then: { pass: 'II01klados_a' } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { pass: 'II01klados_a' } },
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
  });

  // =========================================================================
  // Unreachable Detection
  // =========================================================================

  describe('unreachable detection', () => {
    it('warns about unreachable klados IDs', () => {
      const result = validateRhizaProperties(invalidRhizaProperties.unreachableKlados);

      // Valid but with warning
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'UNREACHABLE_KLADOS',
          klados_id: 'II01klados_orphan',
        })
      );
    });

    it('warns about multiple unreachable kladoi', () => {
      const result = validateRhizaProperties({
        label: 'Multiple Orphans',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { done: true } },
          'II01klados_orphan1': { then: { done: true } },
          'II01klados_orphan2': { then: { pass: 'II01klados_orphan1' } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts pass handoff', () => {
      const result = validateRhizaProperties({
        label: 'Pass Test',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { pass: 'II01klados_b' } },
          'II01klados_b': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts scatter handoff', () => {
      const result = validateRhizaProperties({
        label: 'Scatter Test',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { scatter: 'II01klados_b' } },
          'II01klados_b': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts gather handoff', () => {
      const result = validateRhizaProperties({
        label: 'Gather Test',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': { then: { gather: 'II01klados_b' } },
          'II01klados_b': { then: { done: true } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
              route: [{ target: 'II01klados_c' }] as unknown as Array<{ where: { property: string; equals: string }; target: string }>,
            },
          },
          'II01klados_b': { then: { done: true } },
          'II01klados_c': { then: { done: true } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
              route: [{ where: { property: 'type', equals: 'test' } }] as unknown as Array<{ where: { property: string; equals: string }; target: string }>,
            },
          },
          'II01klados_b': { then: { done: true } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
              route: [
                { where: { property: 'type', equals: 'special' }, target: 'II01klados_c' },
              ],
            },
          },
          'II01klados_b': { then: { done: true } },
          'II01klados_c': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts route rules with AND condition', () => {
      const result = validateRhizaProperties({
        label: 'AND Route',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
              route: [
                {
                  where: {
                    and: [
                      { property: 'type', equals: 'file' },
                      { property: 'size', equals: 'large' },
                    ],
                  },
                  target: 'II01klados_c',
                },
              ],
            },
          },
          'II01klados_b': { then: { done: true } },
          'II01klados_c': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts route rules with OR condition', () => {
      const result = validateRhizaProperties({
        label: 'OR Route',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
              route: [
                {
                  where: {
                    or: [
                      { property: 'type', equals: 'jpeg' },
                      { property: 'type', equals: 'png' },
                    ],
                  },
                  target: 'II01klados_c',
                },
              ],
            },
          },
          'II01klados_b': { then: { done: true } },
          'II01klados_c': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('accepts route rules with nested AND/OR conditions', () => {
      const result = validateRhizaProperties({
        label: 'Nested Route',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
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
                  target: 'II01klados_c',
                },
              ],
            },
          },
          'II01klados_b': { then: { done: true } },
          'II01klados_c': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('fails for invalid where condition format', () => {
      const result = validateRhizaProperties({
        label: 'Invalid Where',
        version: '1.0.0',
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
              route: [
                {
                  where: { invalid: 'condition' } as unknown as { property: string; equals: string },
                  target: 'II01klados_c',
                },
              ],
            },
          },
          'II01klados_b': { then: { done: true } },
          'II01klados_c': { then: { done: true } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
              route: [
                {
                  where: { and: [] },
                  target: 'II01klados_c',
                },
              ],
            },
          },
          'II01klados_b': { then: { done: true } },
          'II01klados_c': { then: { done: true } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_b',
              route: [
                {
                  where: { or: [] },
                  target: 'II01klados_c',
                },
              ],
            },
          },
          'II01klados_b': { then: { done: true } },
          'II01klados_c': { then: { done: true } },
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
        entry: 'II01klados_a',
        flow: {
          'II01klados_a': {
            then: {
              pass: 'II01klados_default',
              route: [
                { where: { property: 'type', equals: 'pdf' }, target: 'II01klados_pdf' },
                { where: { property: 'type', equals: 'image' }, target: 'II01klados_image' },
                { where: { property: 'type', equals: 'text' }, target: 'II01klados_text' },
              ],
            },
          },
          'II01klados_default': { then: { done: true } },
          'II01klados_pdf': { then: { done: true } },
          'II01klados_image': { then: { done: true } },
          'II01klados_text': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });

    it('handles deeply nested workflow', () => {
      const result = validateRhizaProperties({
        label: 'Deep Flow',
        version: '1.0.0',
        entry: 'II01klados_1',
        flow: {
          'II01klados_1': { then: { pass: 'II01klados_2' } },
          'II01klados_2': { then: { pass: 'II01klados_3' } },
          'II01klados_3': { then: { pass: 'II01klados_4' } },
          'II01klados_4': { then: { pass: 'II01klados_5' } },
          'II01klados_5': { then: { done: true } },
        },
        status: 'active',
      });

      expect(result.valid).toBe(true);
    });
  });
});
