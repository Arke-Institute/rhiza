/**
 * Mock Rhiza Fixtures
 *
 * Pre-configured rhiza workflows for testing:
 * - linear: Simple A → B → C chain
 * - scatterGather: Fan-out/fan-in pattern
 * - conditional: Routing based on entity properties
 * - subWorkflow: Nested rhiza invocation
 * - invalid: Various invalid configurations
 *
 * NOTE: Uses step-based flow format where:
 * - entry is a step name (string)
 * - flow keys are step names
 * - each step has { klados: EntityRef, then: ThenSpec }
 * - ThenSpec targets are step names (strings)
 */

import type { RhizaProperties, FlowStep } from '../../../types';
import { ref } from '../../../types';

/** Simple fixture type for tests */
interface MockRhiza {
  properties: RhizaProperties;
  cid: string;
}

// ============================================================================
// Linear Workflow
// ============================================================================

export const linearFlow: Record<string, FlowStep> = {
  'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
  'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { pass: 'step_c' } },
  'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
};

export const linearRhizaProperties: RhizaProperties = {
  label: 'Linear Workflow',
  description: 'Simple A → B → C chain for testing basic flow',
  version: '1.0.0',
  entry: 'step_a',
  flow: linearFlow,
  status: 'active',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

export const linearRhiza: MockRhiza = {
  properties: linearRhizaProperties,
  cid: 'cid_linear_rhiza_v1',
};

// ============================================================================
// Scatter-Gather Workflow
// ============================================================================

export const scatterGatherFlow: Record<string, FlowStep> = {
  'producer': { klados: ref('II01klados_producer', { type: 'klados' }), then: { scatter: 'worker' } },
  'worker': { klados: ref('II01klados_worker', { type: 'klados' }), then: { gather: 'aggregator' } },
  'aggregator': { klados: ref('II01klados_aggregator', { type: 'klados' }), then: { done: true } },
};

export const scatterGatherRhizaProperties: RhizaProperties = {
  label: 'Scatter-Gather Workflow',
  description: 'Fan-out to workers, fan-in to aggregator',
  version: '1.0.0',
  entry: 'producer',
  flow: scatterGatherFlow,
  status: 'active',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

export const scatterGatherRhiza: MockRhiza = {
  properties: scatterGatherRhizaProperties,
  cid: 'cid_scatter_gather_rhiza_v1',
};

// ============================================================================
// Conditional Routing Workflow
// ============================================================================

export const conditionalFlow: Record<string, FlowStep> = {
  'classifier': {
    klados: ref('II01klados_classifier', { type: 'klados' }),
    then: {
      pass: 'default_handler',
      route: [
        {
          where: { property: 'content_type', equals: 'file/pdf' },
          target: 'pdf_handler',
        },
        {
          where: {
            or: [
              { property: 'content_type', equals: 'file/jpeg' },
              { property: 'content_type', equals: 'file/png' },
            ],
          },
          target: 'image_handler',
        },
      ],
    },
  },
  'pdf_handler': { klados: ref('II01klados_pdf_handler', { type: 'klados' }), then: { done: true } },
  'image_handler': { klados: ref('II01klados_image_handler', { type: 'klados' }), then: { done: true } },
  'default_handler': { klados: ref('II01klados_default_handler', { type: 'klados' }), then: { done: true } },
};

export const conditionalRhizaProperties: RhizaProperties = {
  label: 'Conditional Workflow',
  description: 'Routes to different handlers based on content type',
  version: '1.0.0',
  entry: 'classifier',
  flow: conditionalFlow,
  status: 'active',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

export const conditionalRhiza: MockRhiza = {
  properties: conditionalRhizaProperties,
  cid: 'cid_conditional_rhiza_v1',
};

// ============================================================================
// Complex Routing (AND/OR nested)
// ============================================================================

export const complexRoutingFlow: Record<string, FlowStep> = {
  'classifier': {
    klados: ref('II01klados_classifier', { type: 'klados' }),
    then: {
      pass: 'default_handler',
      route: [
        {
          // AND condition: must be File type AND large size
          where: {
            and: [
              { property: 'type', equals: 'File' },
              { property: 'size_category', equals: 'large' },
            ],
          },
          target: 'large_file_handler',
        },
        {
          // OR condition nested in AND
          where: {
            and: [
              { property: 'type', equals: 'File' },
              {
                or: [
                  { property: 'priority', equals: 'high' },
                  { property: 'priority', equals: 'critical' },
                ],
              },
            ],
          },
          target: 'priority_handler',
        },
      ],
    },
  },
  'large_file_handler': { klados: ref('II01klados_large_file_handler', { type: 'klados' }), then: { done: true } },
  'priority_handler': { klados: ref('II01klados_priority_handler', { type: 'klados' }), then: { done: true } },
  'default_handler': { klados: ref('II01klados_default_handler', { type: 'klados' }), then: { done: true } },
};

export const complexRoutingRhizaProperties: RhizaProperties = {
  label: 'Complex Routing Workflow',
  description: 'Tests nested AND/OR routing conditions',
  version: '1.0.0',
  entry: 'classifier',
  flow: complexRoutingFlow,
  status: 'active',
};

// ============================================================================
// Duplicate Klados Workflow (same klados twice)
// ============================================================================

export const duplicateKladosFlow: Record<string, FlowStep> = {
  'first_stamp': { klados: ref('II01klados_stamp', { type: 'klados' }), then: { pass: 'second_stamp' } },
  'second_stamp': { klados: ref('II01klados_stamp', { type: 'klados' }), then: { done: true } },
};

export const duplicateKladosRhizaProperties: RhizaProperties = {
  label: 'Duplicate Klados Workflow',
  description: 'Same klados invoked twice - path disambiguates',
  version: '1.0.0',
  entry: 'first_stamp',
  flow: duplicateKladosFlow,
  status: 'active',
};

// ============================================================================
// Branching Workflow - Two branches converging to same step
// ============================================================================
// router → handle_pdf → pdf_to_image → ocr
// router → handle_image → ocr
// (both paths converge to same 'ocr' step)

export const branchingConvergeFlow: Record<string, FlowStep> = {
  'router': {
    klados: ref('II01klados_router', { type: 'klados' }),
    then: {
      pass: 'handle_pdf',
      route: [
        { where: { property: 'type', equals: 'image' }, target: 'handle_image' },
      ],
    },
  },
  'handle_pdf': { klados: ref('II01klados_pdf', { type: 'klados' }), then: { pass: 'pdf_to_image' } },
  'pdf_to_image': { klados: ref('II01klados_converter', { type: 'klados' }), then: { pass: 'ocr' } },
  'handle_image': { klados: ref('II01klados_image', { type: 'klados' }), then: { pass: 'ocr' } },
  'ocr': { klados: ref('II01klados_ocr', { type: 'klados' }), then: { done: true } },
};

export const branchingConvergeRhizaProperties: RhizaProperties = {
  label: 'Branching Converge Workflow',
  description: 'Two branches converge to same OCR step - path shows how we got there',
  version: '1.0.0',
  entry: 'router',
  flow: branchingConvergeFlow,
  status: 'active',
};

// ============================================================================
// Branching Workflow - Same klados in different branches (separate steps)
// ============================================================================
// router → handle_pdf → pdf_to_image → ocr_from_pdf (uses klados_ocr)
// router → handle_image → ocr_from_image (uses klados_ocr)
// (same klados_ocr used in two different steps)

export const branchingSameKladosFlow: Record<string, FlowStep> = {
  'router': {
    klados: ref('II01klados_router', { type: 'klados' }),
    then: {
      pass: 'handle_pdf',
      route: [
        { where: { property: 'type', equals: 'image' }, target: 'handle_image' },
      ],
    },
  },
  'handle_pdf': { klados: ref('II01klados_pdf', { type: 'klados' }), then: { pass: 'pdf_to_image' } },
  'pdf_to_image': { klados: ref('II01klados_converter', { type: 'klados' }), then: { pass: 'ocr_from_pdf' } },
  'handle_image': { klados: ref('II01klados_image', { type: 'klados' }), then: { pass: 'ocr_from_image' } },
  'ocr_from_pdf': { klados: ref('II01klados_ocr', { type: 'klados' }), then: { done: true } },
  'ocr_from_image': { klados: ref('II01klados_ocr', { type: 'klados' }), then: { done: true } },
};

export const branchingSameKladosRhizaProperties: RhizaProperties = {
  label: 'Branching Same Klados Workflow',
  description: 'Same OCR klados used in two different steps on different branches',
  version: '1.0.0',
  entry: 'router',
  flow: branchingSameKladosFlow,
  status: 'active',
};

// ============================================================================
// Deep Branching Workflow - Triple stamp chain with routing
// ============================================================================
// router → stamp_a → stamp_b → stamp_c (all use same klados_stamp)
// router → fast_track → stamp_c (skips a,b)

export const deepBranchingFlow: Record<string, FlowStep> = {
  'router': {
    klados: ref('II01klados_router', { type: 'klados' }),
    then: {
      pass: 'stamp_a',
      route: [
        { where: { property: 'priority', equals: 'high' }, target: 'fast_track' },
      ],
    },
  },
  'stamp_a': { klados: ref('II01klados_stamp', { type: 'klados' }), then: { pass: 'stamp_b' } },
  'stamp_b': { klados: ref('II01klados_stamp', { type: 'klados' }), then: { pass: 'stamp_c' } },
  'fast_track': { klados: ref('II01klados_fast', { type: 'klados' }), then: { pass: 'stamp_c' } },
  'stamp_c': { klados: ref('II01klados_stamp', { type: 'klados' }), then: { done: true } },
};

export const deepBranchingRhizaProperties: RhizaProperties = {
  label: 'Deep Branching Workflow',
  description: 'Multiple branches with same klados converging - path tracks full history',
  version: '1.0.0',
  entry: 'router',
  flow: deepBranchingFlow,
  status: 'active',
};

// ============================================================================
// Invalid Rhiza Configurations
// ============================================================================

export const invalidRhizaProperties = {
  /** Missing entry */
  missingEntry: {
    label: 'Missing Entry',
    version: '1.0.0',
    flow: {
      'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { done: true } },
    },
    status: 'active' as const,
  } as Partial<RhizaProperties>,

  /** Entry not in flow */
  entryNotInFlow: {
    label: 'Entry Not In Flow',
    version: '1.0.0',
    entry: 'nonexistent_step',
    flow: {
      'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { done: true } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Target not in flow */
  targetNotInFlow: {
    label: 'Target Not In Flow',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'nonexistent_step' } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Cycle detected */
  cycleDetected: {
    label: 'Cycle Detected',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
      'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { pass: 'step_c' } },
      'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { pass: 'step_a' } }, // Cycle!
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** No terminal (unterminated path) */
  noTerminal: {
    label: 'No Terminal',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { pass: 'step_b' } },
      'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { pass: 'step_a' } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Unreachable step */
  unreachableStep: {
    label: 'Unreachable Step',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { done: true } },
      'orphan_step': { klados: ref('II01klados_orphan', { type: 'klados' }), then: { done: true } }, // Never reached
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Missing then spec */
  missingThen: {
    label: 'Missing Then',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': { klados: ref('II01klados_a', { type: 'klados' }) } as FlowStep, // Missing then
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Missing klados */
  missingKlados: {
    label: 'Missing Klados',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': { then: { done: true } } as FlowStep, // Missing klados
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Invalid handoff type */
  invalidHandoff: {
    label: 'Invalid Handoff',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': { klados: ref('II01klados_a', { type: 'klados' }), then: { invalid: 'something' } as unknown as FlowStep['then'] },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Route rule missing where */
  routeMissingWhere: {
    label: 'Route Missing Where',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': {
        klados: ref('II01klados_a', { type: 'klados' }),
        then: {
          pass: 'step_b',
          route: [{ target: 'step_c' }] as unknown as RhizaProperties['flow'][string]['then'] extends { route?: infer R } ? R : never,
        },
      },
      'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
      'step_c': { klados: ref('II01klados_c', { type: 'klados' }), then: { done: true } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Route rule missing target */
  routeMissingTarget: {
    label: 'Route Missing Target',
    version: '1.0.0',
    entry: 'step_a',
    flow: {
      'step_a': {
        klados: ref('II01klados_a', { type: 'klados' }),
        then: {
          pass: 'step_b',
          route: [{ where: { property: 'type', equals: 'test' } }] as unknown as RhizaProperties['flow'][string]['then'] extends { route?: infer R } ? R : never,
        },
      },
      'step_b': { klados: ref('II01klados_b', { type: 'klados' }), then: { done: true } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Empty flow */
  emptyFlow: {
    label: 'Empty Flow',
    version: '1.0.0',
    entry: 'step_a',
    flow: {},
    status: 'active' as const,
  } as RhizaProperties,
};

// ============================================================================
// Pre-configured Maps
// ============================================================================

export const allMockRhizai: Record<string, MockRhiza> = {
  'II01rhiza_linear': linearRhiza,
  'II01rhiza_scatter_gather': scatterGatherRhiza,
  'II01rhiza_conditional': conditionalRhiza,
};
