/**
 * Network-aware configuration utilities for klados workers
 *
 * Supports dual-network deployment where test and main networks
 * have different klados IDs and API keys.
 */

import type { KladosJobConfig } from './job';

/**
 * Environment variables for network-aware klados configuration.
 *
 * Workers should define their Env interface extending this,
 * or use a compatible structure.
 */
export interface NetworkEnv {
  // Required: Default values (used as fallback)
  AGENT_ID: string;
  AGENT_VERSION: string;
  ARKE_AGENT_KEY: string;

  // Optional: Network-specific overrides
  AGENT_ID_TEST?: string;
  AGENT_ID_MAIN?: string;
  ARKE_AGENT_KEY_TEST?: string;
  ARKE_AGENT_KEY_MAIN?: string;

}

/**
 * Get the klados configuration for a specific network.
 *
 * Looks for network-specific env vars first, falls back to defaults.
 * This enables a single worker deployment to serve both test and main networks.
 *
 * @example
 * ```typescript
 * import { KladosJob, getKladosConfig } from '@arke-institute/rhiza';
 *
 * app.post('/process', async (c) => {
 *   const req = await c.req.json<KladosRequest>();
 *   const config = getKladosConfig(c.env, req.network);
 *   const job = KladosJob.accept(req, config);
 *   // ...
 * });
 * ```
 *
 * @param env - Environment variables (from c.env in Cloudflare Workers)
 * @param network - Network from the request ('test' or 'main')
 * @returns KladosJobConfig with the correct agentId and authToken for the network
 */
export function getKladosConfig(
  env: NetworkEnv,
  network: 'test' | 'main'
): KladosJobConfig {
  // Select agent ID based on network
  let agentId: string;
  if (network === 'test' && env.AGENT_ID_TEST) {
    agentId = env.AGENT_ID_TEST;
  } else if (network === 'main' && env.AGENT_ID_MAIN) {
    agentId = env.AGENT_ID_MAIN;
  } else {
    agentId = env.AGENT_ID;
  }

  // Select API key based on network
  let authToken: string;
  if (network === 'test' && env.ARKE_AGENT_KEY_TEST) {
    authToken = env.ARKE_AGENT_KEY_TEST;
  } else if (network === 'main' && env.ARKE_AGENT_KEY_MAIN) {
    authToken = env.ARKE_AGENT_KEY_MAIN;
  } else {
    authToken = env.ARKE_AGENT_KEY;
  }

  return {
    agentId,
    agentVersion: env.AGENT_VERSION,
    authToken,
  };
}
