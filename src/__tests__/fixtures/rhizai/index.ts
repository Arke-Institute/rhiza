/**
 * Mock Rhiza Fixtures
 *
 * Pre-configured rhiza workflows for testing:
 * - linear: Simple A → B → C chain
 * - scatterGather: Fan-out/fan-in pattern
 * - conditional: Routing based on entity properties
 * - subWorkflow: Nested rhiza invocation
 * - invalid: Various invalid configurations
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
  'II01klados_a': { then: { pass: ref('II01klados_b', { type: 'klados' }) } },
  'II01klados_b': { then: { pass: ref('II01klados_c', { type: 'klados' }) } },
  'II01klados_c': { then: { done: true } },
};

export const linearRhizaProperties: RhizaProperties = {
  label: 'Linear Workflow',
  description: 'Simple A → B → C chain for testing basic flow',
  version: '1.0.0',
  entry: ref('II01klados_a', { type: 'klados' }),
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
  'II01klados_producer': { then: { scatter: ref('II01klados_worker', { type: 'klados' }) } },
  'II01klados_worker': { then: { gather: ref('II01klados_aggregator', { type: 'klados' }) } },
  'II01klados_aggregator': { then: { done: true } },
};

export const scatterGatherRhizaProperties: RhizaProperties = {
  label: 'Scatter-Gather Workflow',
  description: 'Fan-out to workers, fan-in to aggregator',
  version: '1.0.0',
  entry: ref('II01klados_producer', { type: 'klados' }),
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
  'II01klados_classifier': {
    then: {
      pass: ref('II01klados_default_handler', { type: 'klados' }),
      route: [
        {
          where: { property: 'content_type', equals: 'file/pdf' },
          target: ref('II01klados_pdf_handler', { type: 'klados' }),
        },
        {
          where: {
            or: [
              { property: 'content_type', equals: 'file/jpeg' },
              { property: 'content_type', equals: 'file/png' },
            ],
          },
          target: ref('II01klados_image_handler', { type: 'klados' }),
        },
      ],
    },
  },
  'II01klados_pdf_handler': { then: { done: true } },
  'II01klados_image_handler': { then: { done: true } },
  'II01klados_default_handler': { then: { done: true } },
};

export const conditionalRhizaProperties: RhizaProperties = {
  label: 'Conditional Workflow',
  description: 'Routes to different handlers based on content type',
  version: '1.0.0',
  entry: ref('II01klados_classifier', { type: 'klados' }),
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
  'II01klados_classifier': {
    then: {
      pass: ref('II01klados_default_handler', { type: 'klados' }),
      route: [
        {
          // AND condition: must be File type AND large size
          where: {
            and: [
              { property: 'type', equals: 'File' },
              { property: 'size_category', equals: 'large' },
            ],
          },
          target: ref('II01klados_large_file_handler', { type: 'klados' }),
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
          target: ref('II01klados_priority_handler', { type: 'klados' }),
        },
      ],
    },
  },
  'II01klados_large_file_handler': { then: { done: true } },
  'II01klados_priority_handler': { then: { done: true } },
  'II01klados_default_handler': { then: { done: true } },
};

export const complexRoutingRhizaProperties: RhizaProperties = {
  label: 'Complex Routing Workflow',
  description: 'Tests nested AND/OR routing conditions',
  version: '1.0.0',
  entry: ref('II01klados_classifier', { type: 'klados' }),
  flow: complexRoutingFlow,
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
      'II01klados_a': { then: { done: true } },
    },
    status: 'active' as const,
  } as Partial<RhizaProperties>,

  /** Entry not in flow */
  entryNotInFlow: {
    label: 'Entry Not In Flow',
    version: '1.0.0',
    entry: ref('II01klados_nonexistent', { type: 'klados' }),
    flow: {
      'II01klados_a': { then: { done: true } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Target not in flow */
  targetNotInFlow: {
    label: 'Target Not In Flow',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
    flow: {
      'II01klados_a': { then: { pass: ref('II01klados_nonexistent', { type: 'klados' }) } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Cycle detected */
  cycleDetected: {
    label: 'Cycle Detected',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
    flow: {
      'II01klados_a': { then: { pass: ref('II01klados_b', { type: 'klados' }) } },
      'II01klados_b': { then: { pass: ref('II01klados_c', { type: 'klados' }) } },
      'II01klados_c': { then: { pass: ref('II01klados_a', { type: 'klados' }) } }, // Cycle!
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** No terminal (unterminated path) */
  noTerminal: {
    label: 'No Terminal',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
    flow: {
      'II01klados_a': { then: { pass: ref('II01klados_b', { type: 'klados' }) } },
      'II01klados_b': { then: { pass: ref('II01klados_a', { type: 'klados' }) } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Unreachable klados */
  unreachableKlados: {
    label: 'Unreachable Klados',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
    flow: {
      'II01klados_a': { then: { done: true } },
      'II01klados_orphan': { then: { done: true } }, // Never reached
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Missing then spec */
  missingThen: {
    label: 'Missing Then',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
    flow: {
      'II01klados_a': {} as FlowStep, // Missing then
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Invalid handoff type */
  invalidHandoff: {
    label: 'Invalid Handoff',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
    flow: {
      'II01klados_a': { then: { invalid: 'something' } as unknown as FlowStep['then'] },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Route rule missing where */
  routeMissingWhere: {
    label: 'Route Missing Where',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
    flow: {
      'II01klados_a': {
        then: {
          pass: ref('II01klados_b', { type: 'klados' }),
          route: [{ target: ref('II01klados_c', { type: 'klados' }) }] as unknown as RhizaProperties['flow'][string]['then'] extends { route?: infer R } ? R : never,
        },
      },
      'II01klados_b': { then: { done: true } },
      'II01klados_c': { then: { done: true } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Route rule missing target */
  routeMissingTarget: {
    label: 'Route Missing Target',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
    flow: {
      'II01klados_a': {
        then: {
          pass: ref('II01klados_b', { type: 'klados' }),
          route: [{ where: { property: 'type', equals: 'test' } }] as unknown as RhizaProperties['flow'][string]['then'] extends { route?: infer R } ? R : never,
        },
      },
      'II01klados_b': { then: { done: true } },
    },
    status: 'active' as const,
  } as RhizaProperties,

  /** Empty flow */
  emptyFlow: {
    label: 'Empty Flow',
    version: '1.0.0',
    entry: ref('II01klados_a', { type: 'klados' }),
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
