/**
 * Branching Workflow Tests
 *
 * Tests for workflows with:
 * - Multiple branches converging to the same step
 * - Same klados used in different branches (different step names)
 * - Path tracking through branching workflows
 *
 * These tests verify that the step-based flow format correctly handles
 * complex branching scenarios where path history is essential for
 * determining execution context.
 */

import { describe, it, expect } from 'vitest';
import { validateRhizaProperties } from '../../../validation';
import { resolveTarget } from '../../../handoff/target';
import type { FlowStep, ThenSpec } from '../../../types';
import {
  branchingConvergeFlow,
  branchingConvergeRhizaProperties,
  branchingSameKladosFlow,
  branchingSameKladosRhizaProperties,
  deepBranchingFlow,
  deepBranchingRhizaProperties,
  duplicateKladosFlow,
  duplicateKladosRhizaProperties,
} from '../../fixtures';

describe('Branching Workflows', () => {
  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validation', () => {
    it('validates branching converge workflow (two paths to same step)', () => {
      const result = validateRhizaProperties(branchingConvergeRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates branching same klados workflow (same klados, different steps)', () => {
      const result = validateRhizaProperties(branchingSameKladosRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates deep branching workflow (multiple converging paths)', () => {
      const result = validateRhizaProperties(deepBranchingRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates duplicate klados workflow (same klados in chain)', () => {
      const result = validateRhizaProperties(duplicateKladosRhizaProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Flow Lookup Tests - Simulating how KladosJob finds its step
  // ===========================================================================

  describe('flow lookup via path', () => {
    /**
     * Simulates how KladosJob.accept() finds the current step from path.
     * This is the core logic: path.at(-1) gives the current step name.
     */
    function getStepFromPath(
      flow: Record<string, FlowStep>,
      path: string[]
    ): FlowStep | undefined {
      const currentStepName = path.at(-1);
      if (!currentStepName) return undefined;
      return flow[currentStepName];
    }

    describe('branching converge flow', () => {
      it('finds correct step for PDF path', () => {
        // Path: router → handle_pdf → pdf_to_image → ocr
        const pdfPath = ['router', 'handle_pdf', 'pdf_to_image', 'ocr'];

        const step = getStepFromPath(branchingConvergeFlow, pdfPath);

        expect(step).toBeDefined();
        expect(step!.klados.pi).toBe('II01klados_ocr');
        expect(step!.then).toEqual({ done: true });
      });

      it('finds correct step for image path', () => {
        // Path: router → handle_image → ocr
        const imagePath = ['router', 'handle_image', 'ocr'];

        const step = getStepFromPath(branchingConvergeFlow, imagePath);

        expect(step).toBeDefined();
        expect(step!.klados.pi).toBe('II01klados_ocr');
        expect(step!.then).toEqual({ done: true });
      });

      it('same step (ocr) reached via different paths', () => {
        const pdfPath = ['router', 'handle_pdf', 'pdf_to_image', 'ocr'];
        const imagePath = ['router', 'handle_image', 'ocr'];

        const pdfStep = getStepFromPath(branchingConvergeFlow, pdfPath);
        const imageStep = getStepFromPath(branchingConvergeFlow, imagePath);

        // Same step object (same flow key)
        expect(pdfStep).toBe(imageStep);

        // But paths are different - distinguishes how we got there
        expect(pdfPath).not.toEqual(imagePath);
        expect(pdfPath.length).toBe(4);
        expect(imagePath.length).toBe(3);
      });
    });

    describe('branching same klados flow', () => {
      it('finds ocr_from_pdf step on PDF path', () => {
        const pdfPath = ['router', 'handle_pdf', 'pdf_to_image', 'ocr_from_pdf'];

        const step = getStepFromPath(branchingSameKladosFlow, pdfPath);

        expect(step).toBeDefined();
        expect(step!.klados.pi).toBe('II01klados_ocr'); // Same klados
      });

      it('finds ocr_from_image step on image path', () => {
        const imagePath = ['router', 'handle_image', 'ocr_from_image'];

        const step = getStepFromPath(branchingSameKladosFlow, imagePath);

        expect(step).toBeDefined();
        expect(step!.klados.pi).toBe('II01klados_ocr'); // Same klados
      });

      it('same klados but different steps have different then specs', () => {
        const pdfPath = ['router', 'handle_pdf', 'pdf_to_image', 'ocr_from_pdf'];
        const imagePath = ['router', 'handle_image', 'ocr_from_image'];

        const pdfStep = getStepFromPath(branchingSameKladosFlow, pdfPath);
        const imageStep = getStepFromPath(branchingSameKladosFlow, imagePath);

        // Same klados ID
        expect(pdfStep!.klados.pi).toBe(imageStep!.klados.pi);

        // But different step objects (different flow keys)
        expect(pdfStep).not.toBe(imageStep);
      });
    });

    describe('deep branching flow', () => {
      it('finds stamp_c step via normal path (3 stamps)', () => {
        // Normal path: router → stamp_a → stamp_b → stamp_c
        const normalPath = ['router', 'stamp_a', 'stamp_b', 'stamp_c'];

        const step = getStepFromPath(deepBranchingFlow, normalPath);

        expect(step).toBeDefined();
        expect(step!.klados.pi).toBe('II01klados_stamp');
      });

      it('finds stamp_c step via fast track (1 stamp)', () => {
        // Fast path: router → fast_track → stamp_c
        const fastPath = ['router', 'fast_track', 'stamp_c'];

        const step = getStepFromPath(deepBranchingFlow, fastPath);

        expect(step).toBeDefined();
        expect(step!.klados.pi).toBe('II01klados_stamp');
      });

      it('same stamp_c step but path shows different history', () => {
        const normalPath = ['router', 'stamp_a', 'stamp_b', 'stamp_c'];
        const fastPath = ['router', 'fast_track', 'stamp_c'];

        // Both end at stamp_c
        expect(normalPath.at(-1)).toBe(fastPath.at(-1));

        // But path length differs (normal: 4 steps, fast: 3 steps)
        expect(normalPath.length).toBe(4);
        expect(fastPath.length).toBe(3);

        // Path can tell you how many stamps were applied
        const normalStampCount = normalPath.filter((s) => s.startsWith('stamp_')).length;
        const fastStampCount = fastPath.filter((s) => s.startsWith('stamp_')).length;

        expect(normalStampCount).toBe(3); // stamp_a, stamp_b, stamp_c
        expect(fastStampCount).toBe(1); // only stamp_c
      });
    });

    describe('duplicate klados flow', () => {
      it('finds first_stamp step at path start', () => {
        const path = ['first_stamp'];

        const step = getStepFromPath(duplicateKladosFlow, path);

        expect(step).toBeDefined();
        expect(step!.klados.pi).toBe('II01klados_stamp');
        expect(step!.then).toEqual({ pass: 'second_stamp' });
      });

      it('finds second_stamp step at path end', () => {
        const path = ['first_stamp', 'second_stamp'];

        const step = getStepFromPath(duplicateKladosFlow, path);

        expect(step).toBeDefined();
        expect(step!.klados.pi).toBe('II01klados_stamp');
        expect(step!.then).toEqual({ done: true });
      });

      it('same klados but path determines which step we are on', () => {
        const path1 = ['first_stamp'];
        const path2 = ['first_stamp', 'second_stamp'];

        const step1 = getStepFromPath(duplicateKladosFlow, path1);
        const step2 = getStepFromPath(duplicateKladosFlow, path2);

        // Same klados
        expect(step1!.klados.pi).toBe(step2!.klados.pi);

        // Different then specs
        expect(step1!.then).not.toEqual(step2!.then);
        expect('pass' in step1!.then).toBe(true);
        expect('done' in step2!.then).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Target Resolution Tests - Routing at branch points
  // ===========================================================================

  describe('target resolution at branch points', () => {
    it('routes to pdf path for pdf type', () => {
      const routerStep = branchingConvergeFlow['router'];
      const then = routerStep.then as ThenSpec;
      const properties = { type: 'pdf' };

      const target = resolveTarget(then, properties);

      expect(target).toBe('handle_pdf'); // Default path
    });

    it('routes to image path for image type', () => {
      const routerStep = branchingConvergeFlow['router'];
      const then = routerStep.then as ThenSpec;
      const properties = { type: 'image' };

      const target = resolveTarget(then, properties);

      expect(target).toBe('handle_image'); // Routed path
    });

    it('routes to normal path for non-priority items', () => {
      const routerStep = deepBranchingFlow['router'];
      const then = routerStep.then as ThenSpec;
      const properties = { priority: 'normal' };

      const target = resolveTarget(then, properties);

      expect(target).toBe('stamp_a'); // Default: full stamp chain
    });

    it('routes to fast track for high priority items', () => {
      const routerStep = deepBranchingFlow['router'];
      const then = routerStep.then as ThenSpec;
      const properties = { priority: 'high' };

      const target = resolveTarget(then, properties);

      expect(target).toBe('fast_track'); // Skip to fast track
    });
  });

  // ===========================================================================
  // Path Building Tests - Constructing paths through branches
  // ===========================================================================

  describe('path building through branches', () => {
    /**
     * Simulates building a path through a workflow.
     * Each step appends the target step name to the path.
     */
    function buildPath(
      flow: Record<string, FlowStep>,
      entry: string,
      routingDecisions: Record<string, string>
    ): string[] {
      const path: string[] = [entry];
      let currentStep = entry;

      while (true) {
        const step = flow[currentStep];
        if (!step) break;

        const then = step.then;
        if ('done' in then && then.done) break;

        // Get next step (either from routing decision or default)
        let nextStep: string | undefined;
        if ('pass' in then) nextStep = routingDecisions[currentStep] ?? then.pass;
        else if ('scatter' in then) nextStep = then.scatter;
        else if ('gather' in then) nextStep = then.gather;

        if (!nextStep) break;

        path.push(nextStep);
        currentStep = nextStep;
      }

      return path;
    }

    it('builds PDF path through branching converge flow', () => {
      const path = buildPath(branchingConvergeFlow, 'router', {});

      expect(path).toEqual(['router', 'handle_pdf', 'pdf_to_image', 'ocr']);
    });

    it('builds image path through branching converge flow', () => {
      const path = buildPath(branchingConvergeFlow, 'router', {
        router: 'handle_image', // Route to image path
      });

      expect(path).toEqual(['router', 'handle_image', 'ocr']);
    });

    it('builds normal path through deep branching flow', () => {
      const path = buildPath(deepBranchingFlow, 'router', {});

      expect(path).toEqual(['router', 'stamp_a', 'stamp_b', 'stamp_c']);
    });

    it('builds fast track path through deep branching flow', () => {
      const path = buildPath(deepBranchingFlow, 'router', {
        router: 'fast_track', // Route to fast track
      });

      expect(path).toEqual(['router', 'fast_track', 'stamp_c']);
    });

    it('builds complete path through duplicate klados flow', () => {
      const path = buildPath(duplicateKladosFlow, 'first_stamp', {});

      expect(path).toEqual(['first_stamp', 'second_stamp']);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty path gracefully', () => {
      const currentStepName = ([] as string[]).at(-1);
      expect(currentStepName).toBeUndefined();
    });

    it('handles single-step path', () => {
      const path = ['only_step'];
      expect(path.at(-1)).toBe('only_step');
    });

    it('path history preserved through entire execution', () => {
      // Simulate a full execution through the PDF branch
      const executionLog: Array<{ step: string; path: string[] }> = [];

      let path = ['router'];
      executionLog.push({ step: 'router', path: [...path] });

      path.push('handle_pdf');
      executionLog.push({ step: 'handle_pdf', path: [...path] });

      path.push('pdf_to_image');
      executionLog.push({ step: 'pdf_to_image', path: [...path] });

      path.push('ocr');
      executionLog.push({ step: 'ocr', path: [...path] });

      // Each step has access to its full history
      expect(executionLog[0].path).toEqual(['router']);
      expect(executionLog[1].path).toEqual(['router', 'handle_pdf']);
      expect(executionLog[2].path).toEqual(['router', 'handle_pdf', 'pdf_to_image']);
      expect(executionLog[3].path).toEqual(['router', 'handle_pdf', 'pdf_to_image', 'ocr']);

      // Current step is always the last element
      executionLog.forEach((log) => {
        expect(log.path.at(-1)).toBe(log.step);
      });
    });

    it('klados can determine branch by inspecting path', () => {
      const pdfPath = ['router', 'handle_pdf', 'pdf_to_image', 'ocr'];
      const imagePath = ['router', 'handle_image', 'ocr'];

      // OCR klados can tell which branch it came from
      const isPdfBranch = pdfPath.includes('handle_pdf');
      const isImageBranch = imagePath.includes('handle_image');

      expect(isPdfBranch).toBe(true);
      expect(isImageBranch).toBe(true);

      // Can also count predecessors
      const pdfPredecessorCount = pdfPath.length - 1; // 3 steps before OCR
      const imagePredecessorCount = imagePath.length - 1; // 2 steps before OCR

      expect(pdfPredecessorCount).toBe(3);
      expect(imagePredecessorCount).toBe(2);
    });
  });
});
