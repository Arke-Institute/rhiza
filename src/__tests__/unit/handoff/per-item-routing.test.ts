/**
 * Per-Item Routing Tests
 *
 * Tests for normalizeOutput and groupOutputsByTarget functions
 * that enable per-item routing for scatter/pass handoffs.
 */

import { describe, it, expect } from 'vitest';
import { normalizeOutput, groupOutputsByTarget } from '../../../handoff/target';
import type { Output, ThenSpec } from '../../../types';

describe('Per-Item Routing', () => {
  describe('normalizeOutput', () => {
    it('converts string to OutputItem', () => {
      const output = 'ent_abc123';
      const result = normalizeOutput(output);

      expect(result).toEqual({ entity_id: 'ent_abc123' });
    });

    it('returns OutputItem unchanged', () => {
      const output = { entity_id: 'ent_abc123', entity_class: 'canonical' };
      const result = normalizeOutput(output);

      expect(result).toEqual({ entity_id: 'ent_abc123', entity_class: 'canonical' });
    });

    it('preserves all properties on OutputItem', () => {
      const output = {
        entity_id: 'ent_abc123',
        entity_class: 'canonical',
        custom_prop: 'value',
        nested: { data: 1 },
      };
      const result = normalizeOutput(output);

      expect(result).toEqual(output);
    });
  });

  describe('groupOutputsByTarget', () => {
    describe('without routes', () => {
      it('groups all outputs to default target', () => {
        const outputs: Output[] = ['ent_1', 'ent_2', 'ent_3'];
        const then: ThenSpec = { scatter: 'process' };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.size).toBe(1);
        expect(groups.get('process')).toHaveLength(3);
        expect(groups.get('process')![0].entity_id).toBe('ent_1');
      });

      it('handles OutputItem objects', () => {
        const outputs: Output[] = [
          { entity_id: 'ent_1', type: 'file' },
          { entity_id: 'ent_2', type: 'folder' },
        ];
        const then: ThenSpec = { pass: 'handler' };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.size).toBe(1);
        expect(groups.get('handler')).toHaveLength(2);
      });

      it('handles done ThenSpec', () => {
        const outputs: Output[] = ['ent_1', 'ent_2'];
        const then: ThenSpec = { done: true };

        const groups = groupOutputsByTarget(outputs, then);

        // For done ThenSpec, resolveTarget returns null, which becomes 'done'
        expect(groups.size).toBe(1);
        expect(groups.get('done')).toHaveLength(2);
      });
    });

    describe('with routes', () => {
      it('routes items based on properties', () => {
        const outputs: Output[] = [
          { entity_id: 'ent_1', entity_class: 'canonical' },
          { entity_id: 'ent_2', entity_class: 'mention' },
          { entity_id: 'ent_3', entity_class: 'canonical' },
        ];
        const then: ThenSpec = {
          scatter: 'default_handler',
          route: [
            { where: { property: 'entity_class', equals: 'canonical' }, target: 'describe' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.size).toBe(2);
        expect(groups.get('describe')).toHaveLength(2);
        expect(groups.get('default_handler')).toHaveLength(1);
      });

      it('routes to "done" target', () => {
        const outputs: Output[] = [
          { entity_id: 'ent_1', entity_class: 'canonical' },
          { entity_id: 'ent_2', entity_class: 'mention' },
        ];
        const then: ThenSpec = {
          scatter: 'describe',
          route: [
            { where: { property: 'entity_class', equals: 'mention' }, target: 'done' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.size).toBe(2);
        expect(groups.get('describe')).toHaveLength(1);
        expect(groups.get('describe')![0].entity_id).toBe('ent_1');
        expect(groups.get('done')).toHaveLength(1);
        expect(groups.get('done')![0].entity_id).toBe('ent_2');
      });

      it('applies first matching rule (if-else-if)', () => {
        const outputs: Output[] = [
          { entity_id: 'ent_1', type: 'pdf', priority: 'high' },
        ];
        const then: ThenSpec = {
          pass: 'default',
          route: [
            { where: { property: 'priority', equals: 'high' }, target: 'priority_handler' },
            { where: { property: 'type', equals: 'pdf' }, target: 'pdf_handler' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        // First matching rule wins
        expect(groups.size).toBe(1);
        expect(groups.get('priority_handler')).toHaveLength(1);
      });

      it('routes string outputs to default (no properties for matching)', () => {
        const outputs: Output[] = ['ent_1', 'ent_2'];
        const then: ThenSpec = {
          scatter: 'default',
          route: [
            { where: { property: 'entity_class', equals: 'canonical' }, target: 'describe' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        // String outputs have no properties, so no route matches -> default
        expect(groups.size).toBe(1);
        expect(groups.get('default')).toHaveLength(2);
      });

      it('handles complex AND/OR routing conditions', () => {
        const outputs: Output[] = [
          { entity_id: 'ent_1', type: 'file', format: 'pdf' },
          { entity_id: 'ent_2', type: 'file', format: 'docx' },
          { entity_id: 'ent_3', type: 'folder' },
        ];
        const then: ThenSpec = {
          scatter: 'default',
          route: [
            {
              where: {
                and: [
                  { property: 'type', equals: 'file' },
                  { property: 'format', equals: 'pdf' },
                ],
              },
              target: 'pdf_handler',
            },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.get('pdf_handler')).toHaveLength(1);
        expect(groups.get('pdf_handler')![0].entity_id).toBe('ent_1');
        expect(groups.get('default')).toHaveLength(2);
      });
    });

    describe('mixed string and object outputs', () => {
      it('handles mix of string and OutputItem', () => {
        const outputs: Output[] = [
          'ent_1',
          { entity_id: 'ent_2', entity_class: 'canonical' },
          'ent_3',
        ];
        const then: ThenSpec = {
          scatter: 'default',
          route: [
            { where: { property: 'entity_class', equals: 'canonical' }, target: 'describe' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.get('describe')).toHaveLength(1);
        expect(groups.get('describe')![0].entity_id).toBe('ent_2');
        expect(groups.get('default')).toHaveLength(2);
      });
    });

    describe('edge cases', () => {
      it('handles empty outputs array', () => {
        const outputs: Output[] = [];
        const then: ThenSpec = { scatter: 'process' };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.size).toBe(0);
      });

      it('handles all outputs routed to "done"', () => {
        const outputs: Output[] = [
          { entity_id: 'ent_1', skip: true },
          { entity_id: 'ent_2', skip: true },
        ];
        const then: ThenSpec = {
          scatter: 'process',
          route: [
            { where: { property: 'skip', equals: true }, target: 'done' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.size).toBe(1);
        expect(groups.get('done')).toHaveLength(2);
      });

      it('handles gather handoff type', () => {
        const outputs: Output[] = [
          { entity_id: 'ent_1', priority: 'high' },
        ];
        const then: ThenSpec = {
          gather: 'aggregator',
          route: [
            { where: { property: 'priority', equals: 'high' }, target: 'priority_aggregator' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.get('priority_aggregator')).toHaveLength(1);
      });
    });
  });
});
