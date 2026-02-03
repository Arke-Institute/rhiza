/**
 * Mock Log Fixtures
 *
 * Pre-configured log entries for testing:
 * - successfulLinear: Complete linear workflow execution
 * - successfulScatterGather: Complete scatter-gather execution
 * - partialError: Workflow with some failed branches
 * - allErrors: Workflow where everything failed
 */

import type { KladosLogEntry, KladosRequest } from '../../../types';

// ============================================================================
// Helper to create a minimal KladosRequest
// ============================================================================

function createRequest(overrides: Partial<KladosRequest> = {}): KladosRequest {
  return {
    job_id: `job_${Date.now()}`,
    target_entity: 'entity_target',
    target_collection: 'collection_1',
    job_collection: 'job_collection_1',
    api_base: 'https://api.arke.test',
    expires_at: '2025-12-31T23:59:59Z',
    network: 'test',
    ...overrides,
  };
}

// ============================================================================
// Successful Linear Workflow
// ============================================================================

export const successfulLinearLogs: KladosLogEntry[] = [
  {
    id: 'log_linear_1',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_linear',
    klados_id: 'II01klados_a',
    job_id: 'job_linear_1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target_entity: 'input_entity', target_collection: 'collection_1' },
    produced: { entity_ids: ['output_a'] },
    handoffs: [{
      type: 'pass',
      target: 'II01klados_b',
      target_type: 'klados',
      invocations: [{
        request: createRequest({ job_id: 'job_linear_2', target_entity: 'output_a' }),
      }],
    }],
  },
  {
    id: 'log_linear_2',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_linear',
    klados_id: 'II01klados_b',
    job_id: 'job_linear_2',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:00Z',
    received: {
      target_entity: 'output_a',
      target_collection: 'collection_1',
      from_logs: ['log_linear_1'],
      invocation: { request: createRequest({ job_id: 'job_linear_2', target_entity: 'output_a' }) },
    },
    produced: { entity_ids: ['output_b'] },
    handoffs: [{
      type: 'pass',
      target: 'II01klados_c',
      target_type: 'klados',
      invocations: [{
        request: createRequest({ job_id: 'job_linear_3', target_entity: 'output_b' }),
      }],
    }],
  },
  {
    id: 'log_linear_3',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_linear',
    klados_id: 'II01klados_c',
    job_id: 'job_linear_3',
    status: 'done',
    started_at: '2025-01-01T00:02:00Z',
    completed_at: '2025-01-01T00:03:00Z',
    received: {
      target_entity: 'output_b',
      target_collection: 'collection_1',
      from_logs: ['log_linear_2'],
      invocation: { request: createRequest({ job_id: 'job_linear_3', target_entity: 'output_b' }) },
    },
    produced: { entity_ids: ['final_output'] },
    // No handoffs - terminal (done: true)
  },
];

// ============================================================================
// Successful Scatter-Gather Workflow
// ============================================================================

export const successfulScatterGatherLogs: KladosLogEntry[] = [
  // Producer (root)
  {
    id: 'log_sg_producer',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_producer',
    job_id: 'job_sg_1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target_entity: 'input_doc', target_collection: 'collection_1' },
    produced: { entity_ids: ['page_1', 'page_2', 'page_3'] },
    handoffs: [{
      type: 'scatter',
      target: 'II01klados_worker',
      target_type: 'klados',
      batch_id: 'batch_sg_1',
      invocations: [
        { request: createRequest({ job_id: 'job_sg_w1', target_entity: 'page_1' }), batch_index: 0 },
        { request: createRequest({ job_id: 'job_sg_w2', target_entity: 'page_2' }), batch_index: 1 },
        { request: createRequest({ job_id: 'job_sg_w3', target_entity: 'page_3' }), batch_index: 2 },
      ],
    }],
  },
  // Worker 0
  {
    id: 'log_sg_worker_0',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_sg_w1',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:00Z',
    received: {
      target_entity: 'page_1',
      target_collection: 'collection_1',
      from_logs: ['log_sg_producer'],
      batch: { id: 'batch_sg_1', index: 0, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_sg_w1', target_entity: 'page_1' }), batch_index: 0 },
    },
    produced: { entity_ids: ['result_1'] },
    // Gather handoff (not last)
    handoffs: [{
      type: 'gather',
      target: 'II01klados_aggregator',
      target_type: 'klados',
      invocations: [], // Not last, so no invocation
    }],
  },
  // Worker 1
  {
    id: 'log_sg_worker_1',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_sg_w2',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:30Z',
    received: {
      target_entity: 'page_2',
      target_collection: 'collection_1',
      from_logs: ['log_sg_producer'],
      batch: { id: 'batch_sg_1', index: 1, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_sg_w2', target_entity: 'page_2' }), batch_index: 1 },
    },
    produced: { entity_ids: ['result_2'] },
    handoffs: [{
      type: 'gather',
      target: 'II01klados_aggregator',
      target_type: 'klados',
      invocations: [], // Not last
    }],
  },
  // Worker 2 (last - triggers gather)
  {
    id: 'log_sg_worker_2',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_sg_w3',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:03:00Z',
    received: {
      target_entity: 'page_3',
      target_collection: 'collection_1',
      from_logs: ['log_sg_producer'],
      batch: { id: 'batch_sg_1', index: 2, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_sg_w3', target_entity: 'page_3' }), batch_index: 2 },
    },
    produced: { entity_ids: ['result_3'] },
    handoffs: [{
      type: 'gather',
      target: 'II01klados_aggregator',
      target_type: 'klados',
      invocations: [{
        // Last worker triggers the gather
        request: createRequest({ job_id: 'job_sg_agg', target_entities: ['result_1', 'result_2', 'result_3'] }),
      }],
    }],
  },
  // Aggregator
  {
    id: 'log_sg_aggregator',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_aggregator',
    job_id: 'job_sg_agg',
    status: 'done',
    started_at: '2025-01-01T00:03:00Z',
    completed_at: '2025-01-01T00:04:00Z',
    received: {
      target_entities: ['result_1', 'result_2', 'result_3'],
      target_collection: 'collection_1',
      from_logs: ['log_sg_worker_0', 'log_sg_worker_1', 'log_sg_worker_2'],
      invocation: { request: createRequest({ job_id: 'job_sg_agg', target_entities: ['result_1', 'result_2', 'result_3'] }) },
    },
    produced: { entity_ids: ['final_document'] },
    // No handoffs - terminal
  },
];

// ============================================================================
// Partial Error (some workers failed)
// ============================================================================

export const partialErrorLogs: KladosLogEntry[] = [
  // Producer (root) - successful
  {
    id: 'log_err_producer',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_producer',
    job_id: 'job_err_1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target_entity: 'input_doc', target_collection: 'collection_1' },
    produced: { entity_ids: ['item_1', 'item_2', 'item_3'] },
    handoffs: [{
      type: 'scatter',
      target: 'II01klados_worker',
      target_type: 'klados',
      batch_id: 'batch_err_1',
      invocations: [
        { request: createRequest({ job_id: 'job_err_w1', target_entity: 'item_1' }), batch_index: 0 },
        { request: createRequest({ job_id: 'job_err_w2', target_entity: 'item_2' }), batch_index: 1 },
        { request: createRequest({ job_id: 'job_err_w3', target_entity: 'item_3' }), batch_index: 2 },
      ],
    }],
  },
  // Worker 0 - success
  {
    id: 'log_err_worker_0',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_err_w1',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:00Z',
    received: {
      target_entity: 'item_1',
      target_collection: 'collection_1',
      from_logs: ['log_err_producer'],
      batch: { id: 'batch_err_1', index: 0, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_err_w1', target_entity: 'item_1' }), batch_index: 0 },
    },
    produced: { entity_ids: ['result_1'] },
  },
  // Worker 1 - ERROR (retryable)
  {
    id: 'log_err_worker_1',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_err_w2',
    status: 'error',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:01:30Z',
    received: {
      target_entity: 'item_2',
      target_collection: 'collection_1',
      from_logs: ['log_err_producer'],
      batch: { id: 'batch_err_1', index: 1, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_err_w2', target_entity: 'item_2' }), batch_index: 1 },
    },
    error: {
      code: 'TIMEOUT',
      message: 'Processing timeout after 30s',
      retryable: true,
    },
  },
  // Worker 2 - success
  {
    id: 'log_err_worker_2',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_err_w3',
    status: 'done',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:02:00Z',
    received: {
      target_entity: 'item_3',
      target_collection: 'collection_1',
      from_logs: ['log_err_producer'],
      batch: { id: 'batch_err_1', index: 2, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_err_w3', target_entity: 'item_3' }), batch_index: 2 },
    },
    produced: { entity_ids: ['result_3'] },
  },
];

// ============================================================================
// All Errors (non-retryable)
// ============================================================================

export const allErrorsLogs: KladosLogEntry[] = [
  {
    id: 'log_fail_root',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_linear',
    klados_id: 'II01klados_a',
    job_id: 'job_fail_1',
    status: 'error',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:00:30Z',
    received: { target_entity: 'input_entity', target_collection: 'collection_1' },
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Input entity is missing required properties',
      retryable: false,
    },
  },
];

// All Error Logs - multiple errors for testing
export const allErrorLogs: KladosLogEntry[] = [
  // Root - success, scatters to 3 workers
  {
    id: 'log_allerr_root',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_producer',
    job_id: 'job_allerr_1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target_entity: 'input_doc', target_collection: 'collection_1' },
    produced: { entity_ids: ['item_1', 'item_2', 'item_3'] },
    handoffs: [{
      type: 'scatter',
      target: 'II01klados_worker',
      target_type: 'klados',
      batch_id: 'batch_allerr_1',
      invocations: [
        { request: createRequest({ job_id: 'job_allerr_w1', target_entity: 'item_1' }), batch_index: 0 },
        { request: createRequest({ job_id: 'job_allerr_w2', target_entity: 'item_2' }), batch_index: 1 },
        { request: createRequest({ job_id: 'job_allerr_w3', target_entity: 'item_3' }), batch_index: 2 },
      ],
    }],
  },
  // Worker 0 - error (retryable)
  {
    id: 'log_allerr_worker_0',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_allerr_w1',
    status: 'error',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:01:30Z',
    received: {
      target_entity: 'item_1',
      target_collection: 'collection_1',
      from_logs: ['log_allerr_root'],
      batch: { id: 'batch_allerr_1', index: 0, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_allerr_w1', target_entity: 'item_1' }), batch_index: 0 },
    },
    error: {
      code: 'TIMEOUT',
      message: 'Service temporarily unavailable',
      retryable: true,
    },
  },
  // Worker 1 - error (non-retryable)
  {
    id: 'log_allerr_worker_1',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_allerr_w2',
    status: 'error',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:01:30Z',
    received: {
      target_entity: 'item_2',
      target_collection: 'collection_1',
      from_logs: ['log_allerr_root'],
      batch: { id: 'batch_allerr_1', index: 1, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_allerr_w2', target_entity: 'item_2' }), batch_index: 1 },
    },
    error: {
      code: 'INVALID_INPUT',
      message: 'Input data is corrupt',
      retryable: false,
    },
  },
  // Worker 2 - error (retryable)
  {
    id: 'log_allerr_worker_2',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_allerr_w3',
    status: 'error',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:01:30Z',
    received: {
      target_entity: 'item_3',
      target_collection: 'collection_1',
      from_logs: ['log_allerr_root'],
      batch: { id: 'batch_allerr_1', index: 2, total: 3 },
      invocation: { request: createRequest({ job_id: 'job_allerr_w3', target_entity: 'item_3' }), batch_index: 2 },
    },
    error: {
      code: 'NETWORK_ERROR',
      message: 'Connection reset',
      retryable: true,
    },
  },
];

// ============================================================================
// Mixed Retryable/Non-retryable Errors
// ============================================================================

export const mixedErrorLogs: KladosLogEntry[] = [
  // Root - success
  {
    id: 'log_mix_root',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_producer',
    job_id: 'job_mix_1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target_entity: 'input_doc', target_collection: 'collection_1' },
    produced: { entity_ids: ['item_1', 'item_2'] },
    handoffs: [{
      type: 'scatter',
      target: 'II01klados_worker',
      target_type: 'klados',
      batch_id: 'batch_mix_1',
      invocations: [
        { request: createRequest({ job_id: 'job_mix_w1', target_entity: 'item_1' }), batch_index: 0 },
        { request: createRequest({ job_id: 'job_mix_w2', target_entity: 'item_2' }), batch_index: 1 },
      ],
    }],
  },
  // Worker 0 - retryable error
  {
    id: 'log_mix_worker_0',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_mix_w1',
    status: 'error',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:01:30Z',
    received: {
      target_entity: 'item_1',
      target_collection: 'collection_1',
      from_logs: ['log_mix_root'],
      batch: { id: 'batch_mix_1', index: 0, total: 2 },
      invocation: { request: createRequest({ job_id: 'job_mix_w1', target_entity: 'item_1' }), batch_index: 0 },
    },
    error: {
      code: 'TIMEOUT',
      message: 'Service temporarily unavailable',
      retryable: true,
    },
  },
  // Worker 1 - non-retryable error
  {
    id: 'log_mix_worker_1',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_scatter_gather',
    klados_id: 'II01klados_worker',
    job_id: 'job_mix_w2',
    status: 'error',
    started_at: '2025-01-01T00:01:00Z',
    completed_at: '2025-01-01T00:01:30Z',
    received: {
      target_entity: 'item_2',
      target_collection: 'collection_1',
      from_logs: ['log_mix_root'],
      batch: { id: 'batch_mix_1', index: 1, total: 2 },
      invocation: { request: createRequest({ job_id: 'job_mix_w2', target_entity: 'item_2' }), batch_index: 1 },
    },
    error: {
      code: 'INVALID_INPUT',
      message: 'Input data is corrupt and cannot be processed',
      retryable: false,
    },
  },
];

// ============================================================================
// Running Workflow (in progress)
// ============================================================================

export const runningWorkflowLogs: KladosLogEntry[] = [
  // Root - done
  {
    id: 'log_run_root',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_linear',
    klados_id: 'II01klados_a',
    job_id: 'job_run_1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target_entity: 'input_entity', target_collection: 'collection_1' },
    produced: { entity_ids: ['output_a'] },
    handoffs: [{
      type: 'pass',
      target: 'II01klados_b',
      target_type: 'klados',
      invocations: [{
        request: createRequest({ job_id: 'job_run_2', target_entity: 'output_a' }),
      }],
    }],
  },
  // Child - still running
  {
    id: 'log_run_child',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_linear',
    klados_id: 'II01klados_b',
    job_id: 'job_run_2',
    status: 'running',
    started_at: '2025-01-01T00:01:00Z',
    received: {
      target_entity: 'output_a',
      target_collection: 'collection_1',
      from_logs: ['log_run_root'],
      invocation: { request: createRequest({ job_id: 'job_run_2', target_entity: 'output_a' }) },
    },
  },
];

// ============================================================================
// Single Node (root is also leaf)
// ============================================================================

export const singleNodeLogs: KladosLogEntry[] = [
  {
    id: 'log_single',
    type: 'klados_log',
    rhiza_id: 'II01rhiza_single',
    klados_id: 'II01klados_only',
    job_id: 'job_single_1',
    status: 'done',
    started_at: '2025-01-01T00:00:00Z',
    completed_at: '2025-01-01T00:01:00Z',
    received: { target_entity: 'input_entity', target_collection: 'collection_1' },
    produced: { entity_ids: ['output_entity'] },
    // No handoffs - single klados workflow with done: true
  },
];
