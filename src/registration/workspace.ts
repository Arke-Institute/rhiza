/**
 * Workspace collection utilities
 *
 * Provides shared collection management across multiple kladoi/rhizai in a workspace.
 * This enables registering multiple workers to the same collection without manual coordination.
 *
 * @example
 * ```typescript
 * // In register script:
 * const workspace = findWorkspaceConfig();
 * if (workspace) {
 *   const { collectionId } = await resolveWorkspaceCollection(client, network, workspace.path);
 *   // Use collectionId in syncKlados options
 * }
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ArkeClient } from '@arke-institute/sdk';
import type { Network } from './types';
import { ensureCollection } from './collection';

// ============================================================================
// Types
// ============================================================================

/** Configuration for a single network in the workspace */
export interface WorkspaceNetworkConfig {
  /** Collection ID (null if not yet created) */
  collection_id: string | null;
  /** Label for the collection when creating */
  collection_label: string;
}

/** Workspace configuration file structure */
export interface WorkspaceConfig {
  /** Schema version for future migrations */
  schema_version?: 1;
  /** Test network configuration */
  test: WorkspaceNetworkConfig;
  /** Main network configuration */
  main: WorkspaceNetworkConfig;
}

/** Result from findWorkspaceConfig */
export interface WorkspaceConfigResult {
  /** The parsed config */
  config: WorkspaceConfig;
  /** Absolute path to the config file */
  path: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default filename for workspace config */
export const WORKSPACE_CONFIG_FILENAME = '.arke-workspace.json';

/** Default collection roles for workspace collections */
const DEFAULT_WORKSPACE_ROLES = {
  public: ['*:view', '*:invoke'],
  viewer: ['*:view'],
  editor: ['*:view', '*:update', '*:create', '*:invoke'],
  owner: [
    '*:view',
    '*:update',
    '*:create',
    '*:manage',
    '*:invoke',
    'collection:update',
    'collection:manage',
  ],
};

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read workspace config from a file.
 * Returns null if file doesn't exist.
 */
export function readWorkspaceConfig(filePath: string): WorkspaceConfig | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as WorkspaceConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Write workspace config to a file.
 */
export function writeWorkspaceConfig(filePath: string, config: WorkspaceConfig): void {
  const dir = path.dirname(filePath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Find workspace config by searching up the directory tree.
 *
 * Starts from the given directory (default: cwd) and walks up
 * looking for .arke-workspace.json until it finds one or hits root.
 *
 * @param startDir - Directory to start searching from (default: process.cwd())
 * @param filename - Config filename to search for (default: .arke-workspace.json)
 * @returns Config and path if found, null otherwise
 */
export function findWorkspaceConfig(
  startDir: string = process.cwd(),
  filename: string = WORKSPACE_CONFIG_FILENAME
): WorkspaceConfigResult | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const configPath = path.join(currentDir, filename);
    const config = readWorkspaceConfig(configPath);

    if (config) {
      return { config, path: configPath };
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // We've hit the root
      break;
    }
    currentDir = parentDir;
  }

  // Check root directory as well
  const rootConfigPath = path.join(root, filename);
  const rootConfig = readWorkspaceConfig(rootConfigPath);
  if (rootConfig) {
    return { config: rootConfig, path: rootConfigPath };
  }

  return null;
}

// ============================================================================
// Collection Resolution
// ============================================================================

/**
 * Resolve workspace collection for a network.
 *
 * If the workspace config has a collection_id for this network, verifies it exists.
 * If collection_id is null, creates a new collection and updates the config file.
 *
 * @param client - Authenticated Arke client
 * @param network - Network to resolve collection for
 * @param workspaceConfigPath - Path to workspace config file
 * @returns Collection ID and whether it was created
 */
export async function resolveWorkspaceCollection(
  client: ArkeClient,
  network: Network,
  workspaceConfigPath: string
): Promise<{ collectionId: string; created: boolean }> {
  const config = readWorkspaceConfig(workspaceConfigPath);

  if (!config) {
    throw new Error(`Workspace config not found at ${workspaceConfigPath}`);
  }

  const networkConfig = config[network];
  if (!networkConfig) {
    throw new Error(`No configuration for network '${network}' in workspace config`);
  }

  // If we have a collection ID, use ensureCollection to verify it exists
  if (networkConfig.collection_id) {
    const result = await ensureCollection(
      client,
      networkConfig.collection_label,
      networkConfig.collection_id
    );
    return { collectionId: result.id, created: false };
  }

  // No collection ID yet - create a new collection
  const { data: created, error } = await client.api.POST('/collections', {
    body: {
      label: networkConfig.collection_label,
      description: `Workspace collection for ${networkConfig.collection_label}`,
      roles: DEFAULT_WORKSPACE_ROLES,
    },
  });

  if (error || !created) {
    throw new Error(`Failed to create workspace collection: ${error?.error || 'Unknown error'}`);
  }

  const collectionId = (created as { id: string }).id;

  // Update the config file with the new collection ID
  const updatedConfig: WorkspaceConfig = {
    ...config,
    schema_version: 1,
    [network]: {
      ...networkConfig,
      collection_id: collectionId,
    },
  };

  writeWorkspaceConfig(workspaceConfigPath, updatedConfig);
  console.log(`  Created workspace collection: ${collectionId}`);
  console.log(`  Updated ${workspaceConfigPath}`);

  return { collectionId, created: true };
}

/**
 * Create a default workspace config.
 *
 * Useful for initializing a new workspace.
 *
 * @param label - Base label for collections (e.g., "My Project Kladoi")
 */
export function createDefaultWorkspaceConfig(label: string): WorkspaceConfig {
  return {
    schema_version: 1,
    test: {
      collection_id: null,
      collection_label: `${label} (Test)`,
    },
    main: {
      collection_id: null,
      collection_label: label,
    },
  };
}

// ============================================================================
// Collection Migration
// ============================================================================

/**
 * Migrate a klados to a different collection.
 *
 * Updates the klados entity to belong to the new collection.
 * Use this with --migrate-collection flag to move existing kladoi
 * into the workspace collection.
 *
 * @param client - Authenticated Arke client
 * @param kladosId - ID of the klados to migrate
 * @param newCollectionId - Target collection ID
 * @returns Whether the migration was performed
 */
export async function migrateKladosToCollection(
  client: ArkeClient,
  kladosId: string,
  currentCollectionId: string,
  newCollectionId: string
): Promise<{ migrated: boolean }> {
  // Skip if already in the target collection
  if (currentCollectionId === newCollectionId) {
    return { migrated: false };
  }

  // Get current tip for CAS
  const { data: tipData, error: tipError } = await client.api.GET(
    '/entities/{id}/tip',
    {
      params: { path: { id: kladosId } },
    }
  );

  if (tipError || !tipData) {
    throw new Error(`Failed to get entity tip: ${tipError?.error || 'Unknown error'}`);
  }

  // Update klados with new collection
  const { error: updateError } = await client.api.PUT('/kladoi/{id}', {
    params: { path: { id: kladosId } },
    body: {
      expect_tip: tipData.cid,
      collection: newCollectionId,
    },
  });

  if (updateError) {
    throw new Error(`Failed to migrate klados to collection: ${updateError.error || 'Unknown error'}`);
  }

  console.log(`  Migrated klados ${kladosId} to collection ${newCollectionId}`);
  return { migrated: true };
}
