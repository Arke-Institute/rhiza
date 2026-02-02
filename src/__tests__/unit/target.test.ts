/**
 * Target Discovery Tests
 *
 * Tests for resolving targets from flow steps and discovering target types.
 * Target resolution evaluates route rules to determine the actual target,
 * while type discovery determines if a target is a klados or rhiza.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTarget, discoverTargetType } from '../../handoff/target';
import { createMockClient } from '../fixtures/mock-client';
import { allMockKladoi } from '../fixtures/kladoi';
import { allMockRhizai } from '../fixtures/rhizai';
import type { ThenSpec } from '../../types';
import { ref } from '../../types';
import type { MockArkeClient } from '../fixtures/mock-client';

describe('Target Discovery', () => {
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

  describe('discoverTargetType', () => {
    let client: MockArkeClient;

    beforeEach(() => {
      client = createMockClient({
        kladoi: allMockKladoi,
        rhizai: allMockRhizai,
      });
    });

    it('returns klados when target is klados entity', async () => {
      const result = await discoverTargetType(client, ref('II01klados_producer'));

      expect(result).toBe('klados');
    });

    it('returns rhiza when target is rhiza entity', async () => {
      const result = await discoverTargetType(client, ref('II01rhiza_linear'));

      expect(result).toBe('rhiza');
    });

    it('throws when target not found', async () => {
      await expect(discoverTargetType(client, ref('nonexistent_id'))).rejects.toThrow(
        /not found/
      );
    });

    it('correctly identifies different kladoi', async () => {
      expect(await discoverTargetType(client, ref('II01klados_worker'))).toBe('klados');
      expect(await discoverTargetType(client, ref('II01klados_aggregator'))).toBe('klados');
    });

    it('correctly identifies different rhizai', async () => {
      expect(await discoverTargetType(client, ref('II01rhiza_scatter_gather'))).toBe('rhiza');
      expect(await discoverTargetType(client, ref('II01rhiza_conditional'))).toBe('rhiza');
    });

    it('handles inactive klados (still returns type)', async () => {
      // Even inactive kladoi should be discoverable - active status is validated separately
      const result = await discoverTargetType(client, ref('II01klados_inactive'));

      expect(result).toBe('klados');
    });

    it('skips API call when type hint is provided', async () => {
      // When type hint is provided, should return immediately without API call
      const result = await discoverTargetType(client, ref('any_id', { type: 'klados' }));
      expect(result).toBe('klados');

      const result2 = await discoverTargetType(client, ref('any_other_id', { type: 'rhiza' }));
      expect(result2).toBe('rhiza');
    });
  });
});
