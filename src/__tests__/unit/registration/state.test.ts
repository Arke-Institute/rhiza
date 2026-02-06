import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readState,
  writeState,
  getStateFilePath,
  hashConfig,
  diffConfig,
  hasConfigChanged,
} from '../../../registration/state';
import type { KladosRegistrationState } from '../../../registration/types';

describe('state utilities', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhiza-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readState', () => {
    it('returns null for non-existent file', () => {
      const result = readState<KladosRegistrationState>(
        path.join(tempDir, 'nonexistent.json')
      );
      expect(result).toBeNull();
    });

    it('reads and parses existing state file', () => {
      const state: KladosRegistrationState = {
        schema_version: 1,
        klados_id: 'klados_123',
        collection_id: 'col_456',
        api_key_prefix: 'ak_abc1234',
        endpoint: 'https://example.com',
        config_hash: 'hash123',
        registered_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const filePath = path.join(tempDir, 'state.json');
      fs.writeFileSync(filePath, JSON.stringify(state));

      const result = readState<KladosRegistrationState>(filePath);
      expect(result).toEqual(state);
    });
  });

  describe('writeState', () => {
    it('writes state to file', () => {
      const state: KladosRegistrationState = {
        schema_version: 1,
        klados_id: 'klados_123',
        collection_id: 'col_456',
        api_key_prefix: 'ak_abc1234',
        endpoint: 'https://example.com',
        config_hash: 'hash123',
        registered_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const filePath = path.join(tempDir, 'state.json');
      writeState(filePath, state);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(state);
    });

    it('creates parent directories if needed', () => {
      const state: KladosRegistrationState = {
        schema_version: 1,
        klados_id: 'klados_123',
        collection_id: 'col_456',
        api_key_prefix: 'ak_abc1234',
        endpoint: 'https://example.com',
        config_hash: 'hash123',
        registered_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const filePath = path.join(tempDir, 'nested', 'dir', 'state.json');
      writeState(filePath, state);

      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('getStateFilePath', () => {
    it('returns .json suffix for test network', () => {
      expect(getStateFilePath('.klados-state', 'test')).toBe('.klados-state.json');
    });

    it('returns .prod.json suffix for main network', () => {
      expect(getStateFilePath('.klados-state', 'main')).toBe('.klados-state.prod.json');
    });

    it('works with rhiza state files', () => {
      expect(getStateFilePath('.rhiza-state', 'test')).toBe('.rhiza-state.json');
      expect(getStateFilePath('.rhiza-state', 'main')).toBe('.rhiza-state.prod.json');
    });
  });

  describe('hashConfig', () => {
    it('produces consistent hash for same config', () => {
      const config = { label: 'Test', endpoint: 'https://example.com' };
      const hash1 = hashConfig(config);
      const hash2 = hashConfig(config);
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different config', () => {
      const config1 = { label: 'Test', endpoint: 'https://example.com' };
      const config2 = { label: 'Test', endpoint: 'https://other.com' };
      const hash1 = hashConfig(config1);
      const hash2 = hashConfig(config2);
      expect(hash1).not.toBe(hash2);
    });

    it('hash is order-independent for object keys', () => {
      const config1 = { a: 1, b: 2 };
      const config2 = { b: 2, a: 1 };
      expect(hashConfig(config1)).toBe(hashConfig(config2));
    });

    it('returns 16-character hex string', () => {
      const hash = hashConfig({ test: 'value' });
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('diffConfig', () => {
    it('returns empty array for identical configs', () => {
      const config = { label: 'Test', endpoint: 'https://example.com' };
      const changes = diffConfig(config, config);
      expect(changes).toEqual([]);
    });

    it('detects added fields', () => {
      const oldConfig = { label: 'Test' };
      const newConfig = { label: 'Test', endpoint: 'https://example.com' };
      const changes = diffConfig(oldConfig, newConfig);
      expect(changes).toContainEqual({
        field: 'endpoint',
        from: undefined,
        to: 'https://example.com',
      });
    });

    it('detects removed fields', () => {
      const oldConfig = { label: 'Test', endpoint: 'https://example.com' };
      const newConfig = { label: 'Test' };
      const changes = diffConfig(oldConfig, newConfig);
      expect(changes).toContainEqual({
        field: 'endpoint',
        from: 'https://example.com',
        to: undefined,
      });
    });

    it('detects changed fields', () => {
      const oldConfig = { label: 'Test', endpoint: 'https://old.com' };
      const newConfig = { label: 'Test', endpoint: 'https://new.com' };
      const changes = diffConfig(oldConfig, newConfig);
      expect(changes).toContainEqual({
        field: 'endpoint',
        from: 'https://old.com',
        to: 'https://new.com',
      });
    });

    it('handles nested objects via deep equality', () => {
      const oldConfig = { accepts: { types: ['*'], cardinality: 'one' } };
      const newConfig = { accepts: { types: ['File'], cardinality: 'one' } };
      const changes = diffConfig(oldConfig, newConfig);
      expect(changes.length).toBe(1);
      expect(changes[0].field).toBe('accepts');
    });
  });

  describe('hasConfigChanged', () => {
    it('returns true for null state', () => {
      const config = { label: 'Test' };
      expect(hasConfigChanged(config, null)).toBe(true);
    });

    it('returns false when hash matches', () => {
      const config = { label: 'Test' };
      const state = { config_hash: hashConfig(config) };
      expect(hasConfigChanged(config, state)).toBe(false);
    });

    it('returns true when hash differs', () => {
      const config = { label: 'Test' };
      const state = { config_hash: 'different_hash' };
      expect(hasConfigChanged(config, state)).toBe(true);
    });
  });
});
