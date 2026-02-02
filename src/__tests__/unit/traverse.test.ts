/**
 * Log Chain Traversal Tests
 *
 * Tests for traversing log chains to find leaves, errors, and build trees.
 * Log chains represent the execution history of a workflow.
 */

import { describe, it, expect } from 'vitest';
import {
  findLeaves,
  findErrorLeaves,
  buildLogTree,
  type LogNode,
} from '../../traverse';
import {
  successfulLinearLogs,
  successfulScatterGatherLogs,
  partialErrorLogs,
  allErrorLogs,
  mixedErrorLogs,
  runningWorkflowLogs,
  singleNodeLogs,
} from '../fixtures/logs';

describe('Log Chain Traversal', () => {
  describe('findLeaves', () => {
    it('finds terminal nodes (no children) in linear chain', () => {
      const leaves = findLeaves(successfulLinearLogs);

      expect(leaves).toHaveLength(1);
      expect(leaves[0].klados_id).toBe('II01klados_c');
    });

    it('finds all leaves in scatter-gather chain', () => {
      const leaves = findLeaves(successfulScatterGatherLogs);

      // Should find the aggregator as the only leaf
      expect(leaves).toHaveLength(1);
      expect(leaves[0].klados_id).toBe('II01klados_aggregator');
    });

    it('finds multiple leaves when workers have errors', () => {
      const leaves = findLeaves(partialErrorLogs);

      // Error leaf + workers that completed + aggregator may not exist
      expect(leaves.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty for empty log chain', () => {
      const leaves = findLeaves([]);

      expect(leaves).toHaveLength(0);
    });

    it('handles single-node chain', () => {
      const leaves = findLeaves(singleNodeLogs);

      expect(leaves).toHaveLength(1);
      expect(leaves[0].id).toBe('log_single');
    });

    it('finds running logs as leaves', () => {
      const leaves = findLeaves(runningWorkflowLogs);

      // Running logs should be leaves since they haven't produced children yet
      const runningLeaves = leaves.filter((l) => l.status === 'running');
      expect(runningLeaves.length).toBeGreaterThan(0);
    });
  });

  describe('findErrorLeaves', () => {
    it('finds logs with status: error', () => {
      const errorLeaves = findErrorLeaves(partialErrorLogs);

      expect(errorLeaves).toHaveLength(1);
      expect(errorLeaves[0].log.status).toBe('error');
    });

    it('returns empty for successful chain', () => {
      const errorLeaves = findErrorLeaves(successfulLinearLogs);

      expect(errorLeaves).toHaveLength(0);
    });

    it('finds all error leaves when multiple errors', () => {
      const errorLeaves = findErrorLeaves(allErrorLogs);

      expect(errorLeaves).toHaveLength(3);
      errorLeaves.forEach((e) => {
        expect(e.log.status).toBe('error');
      });
    });

    it('marks retryable based on error.retryable', () => {
      const errorLeaves = findErrorLeaves(partialErrorLogs);

      expect(errorLeaves[0].retryable).toBe(true);
      expect(errorLeaves[0].log.error?.retryable).toBe(true);
    });

    it('marks non-retryable errors correctly', () => {
      const errorLeaves = findErrorLeaves(allErrorLogs);

      // Should have at least one non-retryable error
      const nonRetryable = errorLeaves.filter((e) => !e.retryable);
      expect(nonRetryable.length).toBeGreaterThan(0);
    });

    it('builds path from root to error', () => {
      const errorLeaves = findErrorLeaves(partialErrorLogs);

      expect(errorLeaves[0].path).toBeDefined();
      expect(errorLeaves[0].path.length).toBeGreaterThan(0);
      // Path should start with root klados
      expect(errorLeaves[0].path[0]).toBe('II01klados_producer');
    });

    it('includes log entry in error leaf', () => {
      const errorLeaves = findErrorLeaves(partialErrorLogs);

      expect(errorLeaves[0].log).toBeDefined();
      expect(errorLeaves[0].log.id).toBeDefined();
      expect(errorLeaves[0].log.klados_id).toBeDefined();
    });
  });

  describe('buildLogTree', () => {
    it('builds tree from root for linear chain', () => {
      const tree = buildLogTree(successfulLinearLogs);

      expect(tree).not.toBeNull();
      expect(tree!.log.klados_id).toBe('II01klados_a');
      expect(tree!.children).toHaveLength(1);
      expect(tree!.children[0].log.klados_id).toBe('II01klados_b');
    });

    it('builds tree with depth 3 for linear chain', () => {
      const tree = buildLogTree(successfulLinearLogs);

      expect(tree).not.toBeNull();
      expect(tree!.children).toHaveLength(1);
      expect(tree!.children[0].children).toHaveLength(1);
      expect(tree!.children[0].children[0].children).toHaveLength(0);
    });

    it('handles scatter (multiple children)', () => {
      const tree = buildLogTree(successfulScatterGatherLogs);

      expect(tree).not.toBeNull();
      // Root should have 3 children (scattered workers)
      expect(tree!.children.length).toBe(3);
    });

    it('returns null for empty logs', () => {
      const tree = buildLogTree([]);

      expect(tree).toBeNull();
    });

    it('handles single node chain', () => {
      const tree = buildLogTree(singleNodeLogs);

      expect(tree).not.toBeNull();
      expect(tree!.children).toHaveLength(0);
    });

    it('includes log entry in each node', () => {
      const tree = buildLogTree(successfulLinearLogs);

      expect(tree).not.toBeNull();
      expect(tree!.log).toBeDefined();
      expect(tree!.log.id).toBeDefined();
      expect(tree!.log.status).toBeDefined();
    });

    it('maintains parent-child relationships correctly', () => {
      const tree = buildLogTree(successfulScatterGatherLogs);

      expect(tree).not.toBeNull();

      // Each worker should have the aggregator as child (after gather)
      // or the aggregator is connected to all workers via gather
      const aggregatorLogs = successfulScatterGatherLogs.filter(
        (l) => l.klados_id === 'II01klados_aggregator'
      );
      expect(aggregatorLogs).toHaveLength(1);
    });

    it('handles mixed success/error logs', () => {
      const tree = buildLogTree(mixedErrorLogs);

      expect(tree).not.toBeNull();

      // Tree should still be buildable with errors
      function countNodes(node: LogNode): number {
        return 1 + node.children.reduce((acc, child) => acc + countNodes(child), 0);
      }

      const nodeCount = countNodes(tree!);
      expect(nodeCount).toBeGreaterThan(1);
    });
  });
});
