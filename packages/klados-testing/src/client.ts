/**
 * API client utilities for klados testing
 */

import { createArkeClient, type ArkeClient } from '@arke-institute/sdk';
import type { TestConfig } from './types.js';

// Global configuration
let globalConfig: TestConfig | null = null;
let globalClient: ArkeClient | null = null;

/**
 * Configure the test client with API credentials
 *
 * This must be called before using any other functions.
 *
 * @example
 * ```typescript
 * configureTestClient({
 *   apiBase: 'https://arke-v1.arke.institute',
 *   userKey: process.env.ARKE_USER_KEY!,
 *   network: 'test',
 * });
 * ```
 */
export function configureTestClient(config: TestConfig): void {
  globalConfig = config;
  globalClient = createArkeClient({
    baseUrl: config.apiBase,
    authToken: config.userKey,
    network: config.network,
  });
}

/**
 * Get the current test client configuration
 *
 * @throws Error if configureTestClient has not been called
 */
export function getConfig(): TestConfig {
  if (!globalConfig) {
    throw new Error(
      'Test client not configured. Call configureTestClient() first.'
    );
  }
  return globalConfig;
}

/**
 * Reset the test client configuration (useful for test teardown)
 */
export function resetTestClient(): void {
  globalConfig = null;
  globalClient = null;
}

/**
 * Get the configured ArkeClient for direct SDK access
 *
 * Use this when you need full SDK functionality beyond the convenience wrappers.
 *
 * @example
 * ```typescript
 * const client = getClient();
 *
 * // Use SDK directly
 * const { data, error } = await client.api.POST('/entities', {
 *   body: { type: 'doc', properties: {...}, collection: collectionId }
 * });
 * ```
 *
 * @throws Error if configureTestClient has not been called
 */
export function getClient(): ArkeClient {
  if (!globalClient) {
    throw new Error(
      'Test client not configured. Call configureTestClient() first.'
    );
  }
  return globalClient;
}

/**
 * Make an authenticated API request to the Arke API
 *
 * @param method - HTTP method
 * @param path - API path (e.g., '/entities/123')
 * @param body - Optional request body
 * @returns Parsed JSON response
 * @throws Error on API errors or invalid responses
 */
export async function apiRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const config = getConfig();

  const url = `${config.apiBase}${path}`;
  const headers: Record<string, string> = {
    Authorization: `ApiKey ${config.userKey}`,
    'X-Arke-Network': config.network,
  };

  // Only set Content-Type when there's a body
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data: T;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${text}`);
  }

  return data;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log a message with timestamp (useful for test debugging)
 */
export function log(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  if (data !== undefined) {
    console.log(`[${timestamp}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}
