/**
 * Input Propagation Tests
 *
 * Tests for the three-level input merge in rhiza workflows:
 * 1. Flow definition step input (workflow author defaults) — lowest priority
 * 2. Invocation global input (user overrides) — medium priority
 * 3. Invocation per-step overrides (input.steps[stepName]) — highest priority
 */

import { describe, it, expect } from 'vitest';
import { mergeStepInput, type InterpretContext } from '../../../handoff/interpret';
import type { FlowStep } from '../../../types';

/**
 * Build a minimal InterpretContext for testing mergeStepInput
 */
function buildContext(opts: {
  flow: Record<string, FlowStep>;
  input?: Record<string, unknown>;
}): InterpretContext {
  return {
    client: {} as any,
    rhizaId: 'rhiza_test',
    kladosId: 'klados_test',
    jobId: 'job_test',
    targetCollection: 'col_test',
    jobCollectionId: 'job_col_test',
    flow: opts.flow,
    outputs: [],
    fromLogId: 'log_test',
    path: ['entry'],
    apiBase: 'https://test.arke.institute',
    network: 'test',
    input: opts.input,
  };
}

const baseFlow: Record<string, FlowStep> = {
  extract: {
    klados: { id: 'klados_extract' },
    then: { pass: 'dedupe' },
  },
  dedupe: {
    klados: { id: 'klados_dedupe' },
    input: { threshold: 0.85 },
    then: { done: true },
  },
  describe: {
    klados: { id: 'klados_describe' },
    input: { max_relationships: 500, update_label: false },
    then: { done: true },
  },
};

describe('Input Propagation - mergeStepInput', () => {
  describe('no input at any level', () => {
    it('returns undefined when no flow input, no context input', () => {
      const context = buildContext({ flow: baseFlow });
      expect(mergeStepInput(context, 'extract')).toBeUndefined();
    });
  });

  describe('flow definition input only', () => {
    it('returns flow step input when no context input', () => {
      const context = buildContext({ flow: baseFlow });
      expect(mergeStepInput(context, 'dedupe')).toEqual({ threshold: 0.85 });
    });
  });

  describe('global invocation input only', () => {
    it('propagates global input to steps without flow input', () => {
      const context = buildContext({
        flow: baseFlow,
        input: { instructions: 'Use ISO dates' },
      });
      expect(mergeStepInput(context, 'extract')).toEqual({
        instructions: 'Use ISO dates',
      });
    });

    it('global input overrides flow step input', () => {
      const context = buildContext({
        flow: baseFlow,
        input: { threshold: 0.95 },
      });
      expect(mergeStepInput(context, 'dedupe')).toEqual({ threshold: 0.95 });
    });

    it('merges global input with flow step input', () => {
      const context = buildContext({
        flow: baseFlow,
        input: { instructions: 'Be thorough' },
      });
      const result = mergeStepInput(context, 'dedupe');
      expect(result).toEqual({
        threshold: 0.85,
        instructions: 'Be thorough',
      });
    });
  });

  describe('per-step overrides via steps key', () => {
    it('applies step-specific override', () => {
      const context = buildContext({
        flow: baseFlow,
        input: {
          instructions: 'Global instructions',
          steps: {
            dedupe: { threshold: 0.99 },
          },
        },
      });
      const result = mergeStepInput(context, 'dedupe');
      expect(result).toEqual({
        threshold: 0.99, // per-step override wins
        instructions: 'Global instructions',
        steps: { dedupe: { threshold: 0.99 } }, // preserved for downstream
      });
    });

    it('step override wins over both flow and global', () => {
      const context = buildContext({
        flow: baseFlow,
        input: {
          threshold: 0.5, // global override
          steps: {
            dedupe: { threshold: 0.99 }, // per-step override
          },
        },
      });
      const result = mergeStepInput(context, 'dedupe');
      // Flow has 0.85, global says 0.5, per-step says 0.99 → 0.99 wins
      expect(result?.threshold).toBe(0.99);
    });

    it('steps key does not affect non-targeted steps', () => {
      const context = buildContext({
        flow: baseFlow,
        input: {
          instructions: 'Global',
          steps: {
            dedupe: { threshold: 0.99 },
          },
        },
      });
      // extract step should get global input but NOT dedupe's step override
      const result = mergeStepInput(context, 'extract');
      expect(result).toEqual({
        instructions: 'Global',
        steps: { dedupe: { threshold: 0.99 } }, // preserved for propagation
      });
      expect(result?.threshold).toBeUndefined();
    });

    it('per-step override for step without flow input', () => {
      const context = buildContext({
        flow: baseFlow,
        input: {
          steps: {
            extract: { custom_prompt: 'Extract dates as ISO 8601' },
          },
        },
      });
      const result = mergeStepInput(context, 'extract');
      expect(result).toEqual({
        custom_prompt: 'Extract dates as ISO 8601',
        steps: { extract: { custom_prompt: 'Extract dates as ISO 8601' } },
      });
    });
  });

  describe('three-level merge priority', () => {
    it('full three-level merge: flow < global < per-step', () => {
      const context = buildContext({
        flow: baseFlow,
        input: {
          instructions: 'Global instructions',
          max_relationships: 1000, // overrides flow's 500
          steps: {
            describe: {
              update_label: true, // overrides flow's false AND global
              custom: 'per-step-only',
            },
          },
        },
      });
      const result = mergeStepInput(context, 'describe');
      expect(result).toEqual({
        max_relationships: 1000, // global wins over flow (500)
        update_label: true, // per-step wins over flow (false)
        instructions: 'Global instructions', // global only
        custom: 'per-step-only', // per-step only
        steps: {
          describe: { update_label: true, custom: 'per-step-only' },
        },
      });
    });
  });

  describe('steps key propagation', () => {
    it('preserves steps key in output for downstream resolution', () => {
      const stepsConfig = {
        extract: { prompt: 'A' },
        dedupe: { prompt: 'B' },
      };
      const context = buildContext({
        flow: baseFlow,
        input: { steps: stepsConfig },
      });

      // When resolving for extract, steps should be preserved
      const result = mergeStepInput(context, 'extract');
      expect(result?.steps).toEqual(stepsConfig);

      // When resolving for dedupe, steps should also be preserved
      const result2 = mergeStepInput(context, 'dedupe');
      expect(result2?.steps).toEqual(stepsConfig);
    });

    it('does not include steps key when no steps overrides exist', () => {
      const context = buildContext({
        flow: baseFlow,
        input: { instructions: 'Global' },
      });
      const result = mergeStepInput(context, 'extract');
      expect(result?.steps).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty global input with steps', () => {
      const context = buildContext({
        flow: baseFlow,
        input: {
          steps: { extract: { prompt: 'Custom' } },
        },
      });
      const result = mergeStepInput(context, 'extract');
      expect(result?.prompt).toBe('Custom');
    });

    it('handles unknown step name gracefully', () => {
      const context = buildContext({
        flow: baseFlow,
        input: { instructions: 'Global' },
      });
      // Step not in flow — no flow input, but global still applies
      const result = mergeStepInput(context, 'nonexistent');
      expect(result).toEqual({ instructions: 'Global' });
    });

    it('handles empty steps object', () => {
      const context = buildContext({
        flow: baseFlow,
        input: {
          instructions: 'Global',
          steps: {},
        },
      });
      const result = mergeStepInput(context, 'extract');
      // Empty steps object should not add steps key
      expect(result).toEqual({ instructions: 'Global' });
    });
  });
});
