/**
 * Registration module
 *
 * Utilities for registering and managing klados and rhiza entities.
 *
 * This module provides:
 * - syncKlados/syncRhiza: Create or update registrations based on state
 * - Key management: Create, list, rotate API keys
 * - Verification helpers: Build /.well-known/arke-verification responses
 * - State utilities: Read/write state files, hash configs
 *
 * @example
 * ```typescript
 * import {
 *   syncKlados,
 *   readState,
 *   writeState,
 *   getStateFilePath,
 * } from '@arke-institute/rhiza/registration';
 *
 * const stateFile = getStateFilePath('.klados-state', 'test');
 * const state = readState(stateFile);
 *
 * const result = await syncKlados(client, config, state, {
 *   network: 'test',
 *   keyStore,
 *   onDeploy: () => execSync('wrangler deploy'),
 *   onWaitForHealth: (endpoint) => waitFor(endpoint + '/health'),
 * });
 *
 * writeState(stateFile, result.state);
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Core types
  Network,
  KeyStore,
  RegistrationState,
  KladosRegistrationState,
  RhizaRegistrationState,
  SyncResult,
  DryRunResult,
  // API key types
  ApiKeyInfo,
  ApiKeyCreateResult,
  ApiKeyRotateResult,
} from './types';

export { SECRET_NAMES } from './types';

// ============================================================================
// State Utilities (pure, no SDK)
// ============================================================================

export {
  readState,
  writeState,
  getStateFilePath,
  hashConfig,
  diffConfig,
  hasConfigChanged,
} from './state';

// ============================================================================
// Verification Helper (pure, no SDK)
// ============================================================================

export {
  buildVerificationResponse,
  createVerificationHandler,
  type VerificationConfig,
  type VerificationResponse,
  type VerificationHandlerResult,
} from './verification';

// ============================================================================
// Collection Utilities (SDK)
// ============================================================================

export { ensureCollection } from './collection';

// ============================================================================
// Klados Registration (SDK)
// ============================================================================

export type { KladosConfig, KladosSyncOptions } from './klados';

export {
  // Sync orchestrator
  syncKlados,
  // Key management
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  // Verification flow
  requestVerification,
  confirmVerification,
  activateKlados,
  runVerificationFlow,
  type VerificationTokenResult,
  type VerificationConfirmResult,
} from './klados';

// ============================================================================
// Rhiza Registration (SDK)
// ============================================================================

export type { RhizaConfig, RhizaFlow, RhizaSyncOptions } from './rhiza';

export { syncRhiza } from './rhiza';
