/**
 * Worker Utilities
 *
 * High-level utilities for building klados workers.
 */

export {
  KladosJob,
  type KladosJobConfig,
  type KladosJobResult,
} from './job';

export {
  KladosErrorCode,
  type KladosErrorCodeType,
  type KladosError,
  createKladosError,
  toKladosError,
  isKladosError,
  failKlados,
  type FailKladosOptions,
} from './errors';
