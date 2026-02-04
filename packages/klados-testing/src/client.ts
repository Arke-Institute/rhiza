/**
 * API client utilities for klados testing
 */

import type { TestConfig } from './types';

// Global configuration
let globalConfig: TestConfig | null = null;

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
    'Content-Type': 'application/json',
    'X-Arke-Network': config.network,
  };

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
