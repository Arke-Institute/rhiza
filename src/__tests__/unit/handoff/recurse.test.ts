/**
 * Recurse Handoff Tests
 *
 * Tests for recurse handoff functionality:
 * - groupOutputsByTarget with recurse ThenSpec
 * - Route resolution for recurse
 * - Depth tracking behavior
 */

import { describe, it, expect } from 'vitest';
import { groupOutputsByTarget, resolveTarget } from '../../../handoff/target';
import type { Output, ThenSpec } from '../../../types';

describe('Recurse Handoff', () => {
  describe('resolveTarget with recurse', () => {
    it('resolves to default recurse target when no routes', () => {
      const then: ThenSpec = { recurse: 'cluster' };
      const properties = { entity_id: 'ent_1' };

      const target = resolveTarget(then, properties);

      expect(target).toBe('cluster');
    });

    it('resolves to route target when route matches', () => {
      const then: ThenSpec = {
        recurse: 'cluster',
        route: [
          { where: { property: 'should_terminate', equals: true }, target: 'done' },
        ],
      };
      const properties = { entity_id: 'ent_1', should_terminate: true };

      const target = resolveTarget(then, properties);

      expect(target).toBe('done');
    });

    it('resolves to default when no route matches', () => {
      const then: ThenSpec = {
        recurse: 'cluster',
        route: [
          { where: { property: 'should_terminate', equals: true }, target: 'done' },
        ],
      };
      const properties = { entity_id: 'ent_1', should_terminate: false };

      const target = resolveTarget(then, properties);

      expect(target).toBe('cluster');
    });

    it('handles recurse with max_depth (max_depth ignored in routing)', () => {
      const then: ThenSpec = {
        recurse: 'cluster',
        max_depth: 10,
      };
      const properties = { entity_id: 'ent_1' };

      // max_depth doesn't affect routing - it's handled in handleRecurse
      const target = resolveTarget(then, properties);

      expect(target).toBe('cluster');
    });
  });

  describe('groupOutputsByTarget with recurse', () => {
    it('groups all outputs to recurse target when no routes', () => {
      const outputs: Output[] = ['ent_1', 'ent_2', 'ent_3'];
      const then: ThenSpec = { recurse: 'cluster' };

      const groups = groupOutputsByTarget(outputs, then);

      expect(groups.size).toBe(1);
      expect(groups.get('cluster')).toHaveLength(3);
      expect(groups.get('cluster')![0].entity_id).toBe('ent_1');
      expect(groups.get('cluster')![1].entity_id).toBe('ent_2');
      expect(groups.get('cluster')![2].entity_id).toBe('ent_3');
    });

    it('routes items to "done" when condition matches', () => {
      const outputs: Output[] = [
        { entity_id: 'ent_1', is_root: false },
        { entity_id: 'ent_2', is_root: true },
        { entity_id: 'ent_3', is_root: false },
      ];
      const then: ThenSpec = {
        recurse: 'cluster',
        route: [
          { where: { property: 'is_root', equals: true }, target: 'done' },
        ],
      };

      const groups = groupOutputsByTarget(outputs, then);

      expect(groups.size).toBe(2);
      expect(groups.get('cluster')).toHaveLength(2);
      expect(groups.get('done')).toHaveLength(1);
      expect(groups.get('done')![0].entity_id).toBe('ent_2');
    });

    it('handles all outputs routed to "done" (termination case)', () => {
      const outputs: Output[] = [
        { entity_id: 'ent_1', complete: true },
        { entity_id: 'ent_2', complete: true },
      ];
      const then: ThenSpec = {
        recurse: 'cluster',
        route: [
          { where: { property: 'complete', equals: true }, target: 'done' },
        ],
      };

      const groups = groupOutputsByTarget(outputs, then);

      expect(groups.size).toBe(1);
      expect(groups.get('done')).toHaveLength(2);
      expect(groups.has('cluster')).toBe(false);
    });

    it('handles empty outputs (base case)', () => {
      const outputs: Output[] = [];
      const then: ThenSpec = { recurse: 'cluster', max_depth: 20 };

      const groups = groupOutputsByTarget(outputs, then);

      expect(groups.size).toBe(0);
    });

    it('handles complex routing with AND condition', () => {
      const outputs: Output[] = [
        { entity_id: 'ent_1', layer: 3, count: 1 },
        { entity_id: 'ent_2', layer: 3, count: 5 },
        { entity_id: 'ent_3', layer: 2, count: 1 },
      ];
      const then: ThenSpec = {
        recurse: 'cluster',
        route: [
          {
            where: {
              and: [
                { property: 'layer', equals: 3 },
                { property: 'count', equals: 1 },
              ],
            },
            target: 'done',
          },
        ],
      };

      const groups = groupOutputsByTarget(outputs, then);

      expect(groups.size).toBe(2);
      expect(groups.get('done')).toHaveLength(1);
      expect(groups.get('done')![0].entity_id).toBe('ent_1');
      expect(groups.get('cluster')).toHaveLength(2);
    });

    it('handles OR condition routing', () => {
      const outputs: Output[] = [
        { entity_id: 'ent_1', status: 'complete' },
        { entity_id: 'ent_2', status: 'error' },
        { entity_id: 'ent_3', status: 'pending' },
      ];
      const then: ThenSpec = {
        recurse: 'process',
        route: [
          {
            where: {
              or: [
                { property: 'status', equals: 'complete' },
                { property: 'status', equals: 'error' },
              ],
            },
            target: 'done',
          },
        ],
      };

      const groups = groupOutputsByTarget(outputs, then);

      expect(groups.get('done')).toHaveLength(2);
      expect(groups.get('process')).toHaveLength(1);
      expect(groups.get('process')![0].entity_id).toBe('ent_3');
    });

    it('preserves OutputItem properties after grouping', () => {
      const outputs: Output[] = [
        { entity_id: 'ent_1', cluster_id: 'c1', member_count: 5 },
        { entity_id: 'ent_2', cluster_id: 'c2', member_count: 3 },
      ];
      const then: ThenSpec = { recurse: 'describe' };

      const groups = groupOutputsByTarget(outputs, then);
      const grouped = groups.get('describe')!;

      expect(grouped[0]).toEqual({ entity_id: 'ent_1', cluster_id: 'c1', member_count: 5 });
      expect(grouped[1]).toEqual({ entity_id: 'ent_2', cluster_id: 'c2', member_count: 3 });
    });
  });

  describe('recurse routing scenarios', () => {
    describe('knowledge graph clustering', () => {
      it('simulates cluster decision: continue recursion', () => {
        // Multiple cluster leaders returned -> recurse to describe
        const outputs: Output[] = [
          { entity_id: 'leader_1', is_leader: true },
          { entity_id: 'leader_2', is_leader: true },
          { entity_id: 'leader_3', is_leader: true },
        ];
        const then: ThenSpec = { recurse: 'cluster' };

        const groups = groupOutputsByTarget(outputs, then);

        // All should go to cluster (for the next iteration)
        expect(groups.get('cluster')).toHaveLength(3);
      });

      it('simulates cluster decision: single root terminates', () => {
        // Single output means we've reached the root
        // In practice, the cluster klados would return empty,
        // but we can also use routing to terminate
        const outputs: Output[] = [
          { entity_id: 'root', is_single: true },
        ];
        const then: ThenSpec = {
          recurse: 'cluster',
          route: [
            { where: { property: 'is_single', equals: true }, target: 'done' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.get('done')).toHaveLength(1);
        expect(groups.has('cluster')).toBe(false);
      });

      it('simulates mixed routing: some done, some continue', () => {
        // Some entities are already clustered (joiners), others are new leaders
        const outputs: Output[] = [
          { entity_id: 'leader_1', action: 'created_leader' },
          { entity_id: 'joiner_1', action: 'joined_existing' },
          { entity_id: 'leader_2', action: 'created_leader' },
          { entity_id: 'joiner_2', action: 'joined_existing' },
        ];
        const then: ThenSpec = {
          recurse: 'describe',
          route: [
            { where: { property: 'action', equals: 'joined_existing' }, target: 'done' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.get('describe')).toHaveLength(2);
        expect(groups.get('done')).toHaveLength(2);
      });
    });

    describe('iterative processing', () => {
      it('routes based on iteration depth property', () => {
        // Items carry their own depth tracking
        const outputs: Output[] = [
          { entity_id: 'item_1', iteration: 1 },
          { entity_id: 'item_2', iteration: 5 },
          { entity_id: 'item_3', iteration: 10 },
        ];
        const then: ThenSpec = {
          recurse: 'process',
          max_depth: 100,
          route: [
            { where: { property: 'iteration', equals: 10 }, target: 'done' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.get('process')).toHaveLength(2);
        expect(groups.get('done')).toHaveLength(1);
        expect(groups.get('done')![0].entity_id).toBe('item_3');
      });

      it('handles convergence check routing', () => {
        // Items with no change should terminate
        const outputs: Output[] = [
          { entity_id: 'item_1', changed: true },
          { entity_id: 'item_2', changed: false },
          { entity_id: 'item_3', changed: true },
        ];
        const then: ThenSpec = {
          recurse: 'refine',
          route: [
            { where: { property: 'changed', equals: false }, target: 'done' },
          ],
        };

        const groups = groupOutputsByTarget(outputs, then);

        expect(groups.get('refine')).toHaveLength(2);
        expect(groups.get('done')).toHaveLength(1);
      });
    });
  });
});
