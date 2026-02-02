/**
 * Scatter Helper Tests
 *
 * Tests for pure scatter helper functions.
 */

import { describe, it, expect } from 'vitest';
import { findGatherTarget } from '../../../handoff/scatter';
import { scatterGatherFlow } from '../../fixtures/rhizai';
import type { FlowStep } from '../../../types';
import { ref } from '../../../types';

describe('Scatter', () => {
  describe('findGatherTarget', () => {
    it('finds gather target from scatter klados flow step', () => {
      const flow = scatterGatherFlow;

      const result = findGatherTarget(flow, 'II01klados_worker');

      expect(result?.pi).toBe('II01klados_aggregator');
    });

    it('returns gather target when step has gather handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { gather: ref('custom_aggregator') } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result?.pi).toBe('custom_aggregator');
    });

    it('returns null when target not in flow', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { gather: ref('aggregator') } },
      };

      const result = findGatherTarget(flow, 'nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when target has done handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { done: true } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });

    it('returns null when target has pass handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { pass: ref('next_step') } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });

    it('returns null when target has scatter handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { then: { scatter: ref('sub_worker') } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });
  });
});
