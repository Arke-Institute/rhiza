/**
 * Configuration Types
 *
 * Runtime configuration for rhiza operations.
 */

/** Default scatter-utility service URL */
export const SCATTER_UTILITY_URL = 'https://scatter-utility.arke.institute';

/** Default threshold for scatter utility delegation */
export const DEFAULT_SCATTER_THRESHOLD = 50;

/**
 * Configuration for scatter utility delegation (optional overrides)
 *
 * By default, scatter-utility is used automatically for scatters > 50 outputs.
 * Use this config only if you need to override the default behavior.
 */
export interface ScatterUtilityConfig {
  /** Force local dispatch instead of using scatter-utility (default: false) */
  forceLocal?: boolean;

  /** Threshold for delegation - outputs exceeding this count are delegated (default: 50) */
  threshold?: number;

  /** Override the scatter-utility URL (default: https://scatter-utility.arke.institute) */
  url?: string;
}

/**
 * Runtime configuration for rhiza workflow execution
 *
 * Note: This is distinct from RhizaConfig in registration which is for entity registration.
 */
export interface RhizaRuntimeConfig {
  /** Scatter utility delegation settings (optional - works automatically without config) */
  scatterUtility?: ScatterUtilityConfig;
}
