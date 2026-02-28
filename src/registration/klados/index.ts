/**
 * Klados registration exports
 */

// Types
export type { KladosConfig, KladosSyncOptions, MatchCriteria, PropertyCondition } from './types';

// Key management
export {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
} from './keys';

// Verification
export {
  requestVerification,
  confirmVerification,
  activateKlados,
  runVerificationFlow,
  type VerificationTokenResult,
  type VerificationConfirmResult,
} from './verify';

// Sync orchestrator
export { syncKlados } from './sync';
