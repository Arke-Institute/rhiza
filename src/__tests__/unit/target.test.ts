/**
 * Target Resolution Tests
 *
 * Tests for resolving step names from flow steps using route rules.
 * Pure function - no API calls.
 *
 * NOTE: Uses step-based flow format where targets are step names (strings).
 */

import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../../handoff/target';
import type { ThenSpec } from '../../types';

describe('Target Resolution', () => {
  describe('resolveTarget', () => {
    describe('without route rules', () => {
      it('returns default target for pass', () => {
        const then: ThenSpec = { pass: 'target_step_a' };
        const properties = { type: 'File' };

        const result = resolveTarget(then, properties);

        expect(result).toBe('target_step_a');
      });

      it('returns default target for scatter', () => {
        const then: ThenSpec = { scatter: 'worker_step' };
        const properties = { type: 'File' };

        const result = resolveTarget(then, properties);

        expect(result).toBe('worker_step');
      });

      it('returns default target for gather', () => {
        const then: ThenSpec = { gather: 'aggregator_step' };
        const properties = { type: 'Result' };

        const result = resolveTarget(then, properties);

        expect(result).toBe('aggregator_step');
      });

      it('returns null for done', () => {
        const then: ThenSpec = { done: true };
        const properties = { type: 'File' };

        const result = resolveTarget(then, properties);

        expect(result).toBeNull();
      });
    });

    describe('with route rules', () => {
      it('evaluates route rules in order', () => {
        const then: ThenSpec = {
          pass: 'default_handler',
          route: [
            { where: { property: 'type', equals: 'pdf' }, target: 'pdf_handler' },
            { where: { property: 'type', equals: 'image' }, target: 'image_handler' },
          ],
        };
        const properties = { type: 'pdf' };

        const result = resolveTarget(then, properties);

        expect(result).toBe('pdf_handler');
      });

      it('returns second rule target when first does not match', () => {
        const then: ThenSpec = {
          pass: 'default_handler',
          route: [
            { where: { property: 'type', equals: 'pdf' }, target: 'pdf_handler' },
            { where: { property: 'type', equals: 'image' }, target: 'image_handler' },
          ],
        };
        const properties = { type: 'image' };

        const result = resolveTarget(then, properties);

        expect(result).toBe('image_handler');
      });

      it('falls back to default when no rules match', () => {
        const then: ThenSpec = {
          pass: 'default_handler',
          route: [
            { where: { property: 'type', equals: 'pdf' }, target: 'pdf_handler' },
            { where: { property: 'type', equals: 'image' }, target: 'image_handler' },
          ],
        };
        const properties = { type: 'unknown' };

        const result = resolveTarget(then, properties);

        expect(result).toBe('default_handler');
      });

      it('works with scatter and route rules', () => {
        const then: ThenSpec = {
          scatter: 'default_worker',
          route: [
            { where: { property: 'priority', equals: 'high' }, target: 'priority_worker' },
          ],
        };
        const properties = { priority: 'high' };

        const result = resolveTarget(then, properties);

        expect(result).toBe('priority_worker');
      });

      it('handles complex AND/OR route conditions', () => {
        const then: ThenSpec = {
          pass: 'default_handler',
          route: [
            {
              where: {
                and: [
                  { property: 'type', equals: 'file' },
                  { or: [{ property: 'ext', equals: 'jpg' }, { property: 'ext', equals: 'png' }] },
                ],
              },
              target: 'image_handler',
            },
          ],
        };

        expect(resolveTarget(then, { type: 'file', ext: 'jpg' })).toBe('image_handler');
        expect(resolveTarget(then, { type: 'file', ext: 'pdf' })).toBe('default_handler');
      });

      it('handles empty route array as no routing', () => {
        const then: ThenSpec = {
          pass: 'default_handler',
          route: [],
        };
        const properties = { type: 'anything' };

        const result = resolveTarget(then, properties);

        expect(result).toBe('default_handler');
      });
    });
  });
});
