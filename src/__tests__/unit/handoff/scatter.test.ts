/**
 * Scatter Helper Tests
 *
 * Tests for pure scatter helper functions.
 *
 * NOTE: Uses step-based flow format where targets are step names (strings).
 */

import { describe, it, expect } from 'vitest';
import { findGatherTarget } from '../../../handoff/scatter';
import { scatterGatherFlow } from '../../fixtures/rhizai';
import type { FlowStep } from '../../../types';
import { ref } from '../../../types';

describe('Scatter', () => {
  describe('findGatherTarget', () => {
    it('finds gather target from scatter step flow step', () => {
      const flow = scatterGatherFlow;

      // Worker step has gather: 'aggregator'
      const result = findGatherTarget(flow, 'worker');

      expect(result).toBe('aggregator');
    });

    it('returns gather target when step has gather handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { klados: ref('klados_worker'), then: { gather: 'custom_aggregator_step' } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBe('custom_aggregator_step');
    });

    it('returns null when target not in flow', () => {
      const flow: Record<string, FlowStep> = {
        worker: { klados: ref('klados_worker'), then: { gather: 'aggregator' } },
      };

      const result = findGatherTarget(flow, 'nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when target has done handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { klados: ref('klados_worker'), then: { done: true } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });

    it('returns null when target has pass handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { klados: ref('klados_worker'), then: { pass: 'next_step' } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });

    it('returns null when target has scatter handoff', () => {
      const flow: Record<string, FlowStep> = {
        worker: { klados: ref('klados_worker'), then: { scatter: 'sub_worker_step' } },
      };

      const result = findGatherTarget(flow, 'worker');

      expect(result).toBeNull();
    });
  });
});
