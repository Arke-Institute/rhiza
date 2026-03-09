/**
 * Tests for network-aware configuration utility
 */

import { describe, it, expect } from 'vitest';
import { getKladosConfig, type NetworkEnv } from '../../../worker/config';

describe('getKladosConfig', () => {
  describe('with network-specific env vars', () => {
    const fullEnv: NetworkEnv = {
      AGENT_ID: 'default-id',
      AGENT_ID_TEST: 'test-id',
      AGENT_ID_MAIN: 'main-id',
      AGENT_VERSION: '1.0.0',
      ARKE_AGENT_KEY: 'ak_default',
      ARKE_AGENT_KEY_TEST: 'ak_test',
      ARKE_AGENT_KEY_MAIN: 'ak_main',
    };

    it('returns test config when network is test', () => {
      const config = getKladosConfig(fullEnv, 'test');

      expect(config.agentId).toBe('test-id');
      expect(config.authToken).toBe('ak_test');
      expect(config.agentVersion).toBe('1.0.0');
    });

    it('returns main config when network is main', () => {
      const config = getKladosConfig(fullEnv, 'main');

      expect(config.agentId).toBe('main-id');
      expect(config.authToken).toBe('ak_main');
      expect(config.agentVersion).toBe('1.0.0');
    });
  });

  describe('with only default env vars', () => {
    const minimalEnv: NetworkEnv = {
      AGENT_ID: 'default-id',
      AGENT_VERSION: '2.0.0',
      ARKE_AGENT_KEY: 'ak_default',
    };

    it('falls back to default for test network', () => {
      const config = getKladosConfig(minimalEnv, 'test');

      expect(config.agentId).toBe('default-id');
      expect(config.authToken).toBe('ak_default');
      expect(config.agentVersion).toBe('2.0.0');
    });

    it('falls back to default for main network', () => {
      const config = getKladosConfig(minimalEnv, 'main');

      expect(config.agentId).toBe('default-id');
      expect(config.authToken).toBe('ak_default');
      expect(config.agentVersion).toBe('2.0.0');
    });
  });

  describe('with partial network-specific env vars', () => {
    it('uses test ID but falls back to default key', () => {
      const env: NetworkEnv = {
        AGENT_ID: 'default-id',
        AGENT_ID_TEST: 'test-id',
        AGENT_VERSION: '1.0.0',
        ARKE_AGENT_KEY: 'ak_default',
        // No ARKE_AGENT_KEY_TEST
      };

      const config = getKladosConfig(env, 'test');

      expect(config.agentId).toBe('test-id');
      expect(config.authToken).toBe('ak_default');
    });

    it('uses main key but falls back to default ID', () => {
      const env: NetworkEnv = {
        AGENT_ID: 'default-id',
        // No AGENT_ID_MAIN
        AGENT_VERSION: '1.0.0',
        ARKE_AGENT_KEY: 'ak_default',
        ARKE_AGENT_KEY_MAIN: 'ak_main',
      };

      const config = getKladosConfig(env, 'main');

      expect(config.agentId).toBe('default-id');
      expect(config.authToken).toBe('ak_main');
    });
  });

  describe('with additional env vars', () => {
    it('ignores unrelated env vars', () => {
      const env = {
        AGENT_ID: 'test-id',
        AGENT_VERSION: '1.0.0',
        ARKE_AGENT_KEY: 'ak_test',
        GEMINI_API_KEY: 'gemini_key',
        SOME_OTHER_VAR: 'value',
      } as NetworkEnv;

      const config = getKladosConfig(env, 'test');

      expect(config.agentId).toBe('test-id');
      expect(config.authToken).toBe('ak_test');
      expect(config.agentVersion).toBe('1.0.0');
      // Should only have the three expected properties
      expect(Object.keys(config)).toEqual(['agentId', 'agentVersion', 'authToken']);
    });
  });
});
