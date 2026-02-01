/**
 * Test Fixtures Index
 *
 * Re-exports all fixtures for easy importing in tests
 */

// Mock client
export {
  createMockClient,
  type MockClientConfig,
  type MockArkeClient,
  type MockKlados,
  type MockRhiza,
  type MockEntity,
  type CreatedEntity,
  type UpdatedEntity,
  type InvokedKlados,
  type InvokedRhiza,
} from './mock-client';

// Klados fixtures
export {
  producerKlados,
  workerKlados,
  aggregatorKlados,
  passthroughKlados,
  pdfHandlerKlados,
  imageHandlerKlados,
  inactiveKlados,
  developmentKlados,
  scatterGatherKladoi,
  linearKladoi,
  conditionalKladoi,
  allMockKladoi,
  invalidKladosProperties,
  validKladosProperties,
} from './kladoi';

// Rhiza fixtures
export {
  linearFlow,
  linearRhizaProperties,
  linearRhiza,
  scatterGatherFlow,
  scatterGatherRhizaProperties,
  scatterGatherRhiza,
  conditionalFlow,
  conditionalRhizaProperties,
  conditionalRhiza,
  complexRoutingFlow,
  complexRoutingRhizaProperties,
  invalidRhizaProperties,
  allMockRhizai,
} from './rhizai';

// Log fixtures
export {
  successfulLinearLogs,
  successfulScatterGatherLogs,
  partialErrorLogs,
  allErrorsLogs,
  mixedErrorLogs,
  runningWorkflowLogs,
  singleNodeLogs,
} from './logs';
