/**
 * Mock Klados Fixtures
 *
 * Pre-configured klados entities for testing various scenarios:
 * - producer: outputs many items (for scatter source)
 * - worker: processes one item, outputs one (for scatter target)
 * - aggregator: accepts many items (for gather target)
 * - passthrough: simple 1:1 processing
 * - inactive: disabled klados for error testing
 * - invalid: various invalid configurations
 */

import type { KladosProperties } from '../../../types';

/** Simple fixture type for tests */
interface MockKlados {
  properties: KladosProperties;
  cid: string;
}

// ============================================================================
// Valid Kladoi
// ============================================================================

/**
 * Producer - Produces many outputs from one input
 * Use case: PDF splitter that creates multiple page entities
 */
export const producerKlados: MockKlados = {
  properties: {
    label: 'Producer',
    description: 'Produces multiple outputs from a single input',
    endpoint: 'https://producer.test/invoke',
    actions_required: ['file:view'],
    accepts: { types: ['*'], cardinality: 'one' },
    produces: { types: ['item/*'], cardinality: 'many' },
    status: 'active',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  cid: 'cid_producer_v1',
};

/**
 * Worker - Processes one item at a time
 * Use case: OCR processor for individual pages
 */
export const workerKlados: MockKlados = {
  properties: {
    label: 'Worker',
    description: 'Processes a single item and produces a single result',
    endpoint: 'https://worker.test/invoke',
    actions_required: ['file:view', 'entity:update'],
    accepts: { types: ['item/*'], cardinality: 'one' },
    produces: { types: ['result/*'], cardinality: 'one' },
    status: 'active',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  cid: 'cid_worker_v1',
};

/**
 * Aggregator - Accepts many inputs (gather target)
 * Use case: Assembles processed pages back into document
 */
export const aggregatorKlados: MockKlados = {
  properties: {
    label: 'Aggregator',
    description: 'Combines multiple inputs into a single output',
    endpoint: 'https://aggregator.test/invoke',
    actions_required: ['file:create'],
    accepts: { types: ['result/*'], cardinality: 'many' },
    produces: { types: ['final/*'], cardinality: 'one' },
    status: 'active',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  cid: 'cid_aggregator_v1',
};

/**
 * Passthrough - Simple 1:1 processor
 * Use case: Validator, transformer, enricher
 */
export const passthroughKlados: MockKlados = {
  properties: {
    label: 'Passthrough',
    description: 'Simple 1:1 processing',
    endpoint: 'https://passthrough.test/invoke',
    actions_required: ['file:view', 'entity:update'],
    accepts: { types: ['*'], cardinality: 'one' },
    produces: { types: ['*'], cardinality: 'one' },
    status: 'active',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  cid: 'cid_passthrough_v1',
};

/**
 * PDF Handler - Processes PDF files specifically
 * Use case: Conditional routing target
 */
export const pdfHandlerKlados: MockKlados = {
  properties: {
    label: 'PDF Handler',
    description: 'Specialized handler for PDF files',
    endpoint: 'https://pdf-handler.test/invoke',
    actions_required: ['file:view', 'file:create'],
    accepts: { types: ['file/pdf'], cardinality: 'one' },
    produces: { types: ['text/extracted'], cardinality: 'one' },
    status: 'active',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  cid: 'cid_pdf_handler_v1',
};

/**
 * Image Handler - Processes image files
 * Use case: Conditional routing target
 */
export const imageHandlerKlados: MockKlados = {
  properties: {
    label: 'Image Handler',
    description: 'Specialized handler for image files',
    endpoint: 'https://image-handler.test/invoke',
    actions_required: ['file:view', 'file:create'],
    accepts: { types: ['file/jpeg', 'file/png', 'file/webp'], cardinality: 'one' },
    produces: { types: ['text/extracted'], cardinality: 'one' },
    status: 'active',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  cid: 'cid_image_handler_v1',
};

// ============================================================================
// Error Testing Kladoi
// ============================================================================

/**
 * Inactive - Disabled klados for testing status checks
 */
export const inactiveKlados: MockKlados = {
  properties: {
    label: 'Inactive Klados',
    description: 'Disabled klados for testing',
    endpoint: 'https://inactive.test/invoke',
    actions_required: ['file:view'],
    accepts: { types: ['*'], cardinality: 'one' },
    produces: { types: ['*'], cardinality: 'one' },
    status: 'disabled',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  cid: 'cid_inactive_v1',
};

/**
 * Development - Klados in development status
 */
export const developmentKlados: MockKlados = {
  properties: {
    label: 'Development Klados',
    description: 'Klados in development for testing',
    endpoint: 'https://development.test/invoke',
    actions_required: ['file:view'],
    accepts: { types: ['*'], cardinality: 'one' },
    produces: { types: ['*'], cardinality: 'one' },
    status: 'development',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  cid: 'cid_development_v1',
};

// ============================================================================
// Pre-configured Maps
// ============================================================================

/**
 * Standard kladoi map for scatter-gather tests
 */
export const scatterGatherKladoi: Record<string, MockKlados> = {
  'II01klados_producer': producerKlados,
  'II01klados_worker': workerKlados,
  'II01klados_aggregator': aggregatorKlados,
};

/**
 * Standard kladoi map for linear flow tests
 */
export const linearKladoi: Record<string, MockKlados> = {
  'II01klados_a': passthroughKlados,
  'II01klados_b': passthroughKlados,
  'II01klados_c': passthroughKlados,
};

/**
 * Standard kladoi map for conditional routing tests
 */
export const conditionalKladoi: Record<string, MockKlados> = {
  'II01klados_classifier': passthroughKlados,
  'II01klados_pdf_handler': pdfHandlerKlados,
  'II01klados_image_handler': imageHandlerKlados,
  'II01klados_default_handler': passthroughKlados,
};

/**
 * All mock kladoi combined
 */
export const allMockKladoi: Record<string, MockKlados> = {
  ...scatterGatherKladoi,
  ...linearKladoi,
  ...conditionalKladoi,
  'II01klados_inactive': inactiveKlados,
  'II01klados_development': developmentKlados,
};

// ============================================================================
// Invalid Klados Properties (for validation tests)
// ============================================================================

export const invalidKladosProperties = {
  /** Missing endpoint */
  missingEndpoint: {
    label: 'Missing Endpoint',
    actions_required: ['file:view'],
    accepts: { types: ['*'], cardinality: 'one' as const },
    produces: { types: ['*'], cardinality: 'one' as const },
    status: 'active' as const,
  },

  /** Invalid endpoint URL */
  invalidEndpoint: {
    label: 'Invalid Endpoint',
    endpoint: 'not-a-valid-url',
    actions_required: ['file:view'],
    accepts: { types: ['*'], cardinality: 'one' as const },
    produces: { types: ['*'], cardinality: 'one' as const },
    status: 'active' as const,
  },

  /** Empty accepts types */
  emptyAcceptsTypes: {
    label: 'Empty Accepts',
    endpoint: 'https://test.test/invoke',
    actions_required: ['file:view'],
    accepts: { types: [], cardinality: 'one' as const },
    produces: { types: ['*'], cardinality: 'one' as const },
    status: 'active' as const,
  },

  /** Empty produces types */
  emptyProducesTypes: {
    label: 'Empty Produces',
    endpoint: 'https://test.test/invoke',
    actions_required: ['file:view'],
    accepts: { types: ['*'], cardinality: 'one' as const },
    produces: { types: [], cardinality: 'one' as const },
    status: 'active' as const,
  },

  /** Invalid cardinality */
  invalidCardinality: {
    label: 'Invalid Cardinality',
    endpoint: 'https://test.test/invoke',
    actions_required: ['file:view'],
    accepts: { types: ['*'], cardinality: 'invalid' as unknown as 'one' },
    produces: { types: ['*'], cardinality: 'one' as const },
    status: 'active' as const,
  },

  /** Empty actions required */
  emptyActionsRequired: {
    label: 'Empty Actions',
    endpoint: 'https://test.test/invoke',
    actions_required: [],
    accepts: { types: ['*'], cardinality: 'one' as const },
    produces: { types: ['*'], cardinality: 'one' as const },
    status: 'active' as const,
  },
};

// ============================================================================
// Valid Klados Properties (for validation tests)
// ============================================================================

export const validKladosProperties: KladosProperties = {
  label: 'Valid Klados',
  description: 'A fully valid klados for testing',
  endpoint: 'https://valid.test/invoke',
  actions_required: ['file:view', 'entity:update'],
  accepts: { types: ['file/pdf'], cardinality: 'one' },
  produces: { types: ['text/extracted'], cardinality: 'one' },
  status: 'active',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};
