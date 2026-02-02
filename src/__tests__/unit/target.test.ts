/**
 * Target Resolution Tests
 *
 * Tests for resolving targets from flow steps using route rules.
 * Pure function - no API calls.
 */

import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../../handoff/target';
import type { ThenSpec } from '../../types';
import { ref } from '../../types';

describe('Target Resolution', () => {
  describe('resolveTarget', () => {
    describe('without route rules', () => {
      it('returns default target for pass', () => {
        const then: ThenSpec = { pass: ref('target_a') };
        const properties = { type: 'File' };

        const result = resolveTarget(then, properties);

        expect(result?.pi).toBe('target_a');
      });

      it('returns default target for scatter', () => {
        const then: ThenSpec = { scatter: ref('worker_klados') };
        const properties = { type: 'File' };

        const result = resolveTarget(then, properties);

        expect(result?.pi).toBe('worker_klados');
      });

      it('returns default target for gather', () => {
        const then: ThenSpec = { gather: ref('aggregator_klados') };
        const properties = { type: 'Result' };

        const result = resolveTarget(then, properties);

        expect(result?.pi).toBe('aggregator_klados');
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
          pass: ref('default_handler'),
          route: [
            { where: { property: 'type', equals: 'pdf' }, target: ref('pdf_handler') },
            { where: { property: 'type', equals: 'image' }, target: ref('image_handler') },
          ],
        };
        const properties = { type: 'pdf' };

        const result = resolveTarget(then, properties);

        expect(result?.pi).toBe('pdf_handler');
      });

      it('returns second rule target when first does not match', () => {
        const then: ThenSpec = {
          pass: ref('default_handler'),
          route: [
            { where: { property: 'type', equals: 'pdf' }, target: ref('pdf_handler') },
            { where: { property: 'type', equals: 'image' }, target: ref('image_handler') },
          ],
        };
        const properties = { type: 'image' };

        const result = resolveTarget(then, properties);

        expect(result?.pi).toBe('image_handler');
      });

      it('falls back to default when no rules match', () => {
        const then: ThenSpec = {
          pass: ref('default_handler'),
          route: [
            { where: { property: 'type', equals: 'pdf' }, target: ref('pdf_handler') },
            { where: { property: 'type', equals: 'image' }, target: ref('image_handler') },
          ],
        };
        const properties = { type: 'unknown' };

        const result = resolveTarget(then, properties);

        expect(result?.pi).toBe('default_handler');
      });

      it('works with scatter and route rules', () => {
        const then: ThenSpec = {
          scatter: ref('default_worker'),
          route: [
            { where: { property: 'priority', equals: 'high' }, target: ref('priority_worker') },
          ],
        };
        const properties = { priority: 'high' };

        const result = resolveTarget(then, properties);

        expect(result?.pi).toBe('priority_worker');
      });

      it('handles complex AND/OR route conditions', () => {
        const then: ThenSpec = {
          pass: ref('default_handler'),
          route: [
            {
              where: {
                and: [
                  { property: 'type', equals: 'file' },
                  { or: [{ property: 'ext', equals: 'jpg' }, { property: 'ext', equals: 'png' }] },
                ],
              },
              target: ref('image_handler'),
            },
          ],
        };

        expect(resolveTarget(then, { type: 'file', ext: 'jpg' })?.pi).toBe('image_handler');
        expect(resolveTarget(then, { type: 'file', ext: 'pdf' })?.pi).toBe('default_handler');
      });

      it('handles empty route array as no routing', () => {
        const then: ThenSpec = {
          pass: ref('default_handler'),
          route: [],
        };
        const properties = { type: 'anything' };

        const result = resolveTarget(then, properties);

        expect(result?.pi).toBe('default_handler');
      });
    });
  });
});
