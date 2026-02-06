/**
 * State file utilities
 *
 * Pure functions for managing registration state files.
 * No SDK dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Network, RegistrationState } from './types';

/**
 * Read state from JSON file.
 * Returns null if file doesn't exist.
 */
export function readState<T extends RegistrationState>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Write state to JSON file.
 * Creates parent directories if needed.
 */
export function writeState<T extends RegistrationState>(
  filePath: string,
  state: T
): void {
  const dir = path.dirname(filePath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
}

/**
 * Get state file path for network.
 *
 * @example
 * getStateFilePath('.klados-state', 'test')  // '.klados-state.json'
 * getStateFilePath('.klados-state', 'main')  // '.klados-state.prod.json'
 */
export function getStateFilePath(baseName: string, network: Network): string {
  const suffix = network === 'main' ? '.prod.json' : '.json';
  return `${baseName}${suffix}`;
}

/**
 * Generate a deterministic hash of config for change detection.
 * Uses SHA-256 of the JSON-serialized config.
 */
export function hashConfig(config: unknown): string {
  const json = JSON.stringify(config, Object.keys(config as object).sort());
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Compare two configs and return list of changed fields.
 * Only compares top-level fields with deep equality.
 */
export function diffConfig(
  oldConfig: unknown,
  newConfig: unknown
): Array<{ field: string; from: unknown; to: unknown }> {
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];

  if (
    typeof oldConfig !== 'object' ||
    oldConfig === null ||
    typeof newConfig !== 'object' ||
    newConfig === null
  ) {
    return changes;
  }

  const oldObj = oldConfig as Record<string, unknown>;
  const newObj = newConfig as Record<string, unknown>;

  // Get all keys from both objects
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    // Deep equality check via JSON serialization
    const oldJson = JSON.stringify(oldVal);
    const newJson = JSON.stringify(newVal);

    if (oldJson !== newJson) {
      changes.push({
        field: key,
        from: oldVal,
        to: newVal,
      });
    }
  }

  return changes;
}

/**
 * Check if config has changed from state.
 * Compares config hash.
 */
export function hasConfigChanged(
  config: unknown,
  state: { config_hash: string } | null
): boolean {
  if (!state) {
    return true; // No state = definitely changed (needs creation)
  }
  return hashConfig(config) !== state.config_hash;
}
