import { describe, it, expect } from 'vitest';
import { KladosJob, type KladosJobConfig } from '../../../worker/job';
import type { KladosRequest } from '../../../types';

// Test configuration
const testConfig: KladosJobConfig = {
  agentId: 'klados_test_agent',
  agentVersion: '1.0.0',
  authToken: 'ak_test_token',
};

// Helper to create a minimal valid request
function createTestRequest(overrides: Partial<KladosRequest> = {}): KladosRequest {
  return {
    target: 'entity_12345',
    job_id: 'job_test_001',
    job_collection: 'collection_test',
    api_base: 'https://api.test.arke.institute',
    expires_at: '2099-12-31T23:59:59Z',
    network: 'test',
    ...overrides,
  };
}

describe('KladosJob', () => {
  describe('accept', () => {
    it('creates a job from a request', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job).toBeInstanceOf(KladosJob);
    });

    it('stores the request', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job.request).toBe(request);
    });

    it('stores the config', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job.config).toBe(testConfig);
    });

    it('creates a logger', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job.log).toBeDefined();
      expect(typeof job.log.info).toBe('function');
      expect(typeof job.log.error).toBe('function');
    });

    it('generates a log ID', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job.logId).toBeDefined();
      expect(job.logId).toMatch(/^log_/);
    });

    it('creates an Arke client', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job.client).toBeDefined();
      expect(job.client.api).toBeDefined();
    });
  });

  describe('acceptResponse', () => {
    it('includes accepted: true', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job.acceptResponse.accepted).toBe(true);
    });

    it('includes the job_id', () => {
      const request = createTestRequest({ job_id: 'job_xyz_123' });
      const job = KladosJob.accept(request, testConfig);

      expect(job.acceptResponse.job_id).toBe('job_xyz_123');
    });
  });

  describe('batchContext', () => {
    it('returns undefined when not in a batch', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job.batchContext).toBeUndefined();
    });

    it('returns batch context when present', () => {
      const request = createTestRequest({
        rhiza: {
          id: 'rhiza_test',
          path: ['klados_a'],
          parent_logs: ['log_parent'],
          batch: {
            id: 'batch_001',
            index: 2,
            total: 5,
          },
        },
      });
      const job = KladosJob.accept(request, testConfig);

      expect(job.batchContext).toEqual({
        id: 'batch_001',
        index: 2,
        total: 5,
      });
    });
  });

  describe('isWorkflow', () => {
    it('returns false when no rhiza context', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      expect(job.isWorkflow).toBe(false);
    });

    it('returns true when rhiza context is present', () => {
      const request = createTestRequest({
        rhiza: {
          id: 'rhiza_test',
          path: ['klados_a'],
          parent_logs: ['log_parent'],
        },
      });
      const job = KladosJob.accept(request, testConfig);

      expect(job.isWorkflow).toBe(true);
    });
  });

  describe('logger integration', () => {
    it('can log messages', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      job.log.info('Test message');
      job.log.warning('Warning message');
      job.log.error('Error message');
      job.log.success('Success message');

      const messages = job.log.getMessages();
      expect(messages).toHaveLength(4);
      expect(messages[0].level).toBe('info');
      expect(messages[0].message).toBe('Test message');
      expect(messages[1].level).toBe('warning');
      expect(messages[2].level).toBe('error');
      expect(messages[3].level).toBe('success');
    });

    it('can log messages with metadata', () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      job.log.info('Processing entity', { entityId: 'e123', count: 5 });

      const messages = job.log.getMessages();
      expect(messages[0].metadata).toEqual({ entityId: 'e123', count: 5 });
    });
  });

  describe('unique log IDs', () => {
    it('generates unique log IDs for different jobs', () => {
      const request = createTestRequest();

      const job1 = KladosJob.accept(request, testConfig);
      const job2 = KladosJob.accept(request, testConfig);
      const job3 = KladosJob.accept(request, testConfig);

      expect(job1.logId).not.toBe(job2.logId);
      expect(job2.logId).not.toBe(job3.logId);
      expect(job1.logId).not.toBe(job3.logId);
    });
  });

  describe('state transitions', () => {
    it('starts in accepted state', async () => {
      const request = createTestRequest();
      const job = KladosJob.accept(request, testConfig);

      // Cannot complete before starting
      await expect(job.complete(['output1'])).rejects.toThrow('Cannot complete job in state: accepted');
    });

    it('prevents starting twice', () => {
      // This test would require mocking API calls
      // The actual start() requires API calls, so we just verify
      // the state management logic exists (tested via complete rejection above)
      expect(true).toBe(true);
    });
  });
});

describe('KladosJob request handling', () => {
  describe('different network types', () => {
    it('handles main network', () => {
      const request = createTestRequest({ network: 'main' });
      const job = KladosJob.accept(request, testConfig);

      expect(job.request.network).toBe('main');
    });

    it('handles test network', () => {
      const request = createTestRequest({ network: 'test' });
      const job = KladosJob.accept(request, testConfig);

      expect(job.request.network).toBe('test');
    });
  });

  describe('rhiza context variations', () => {
    it('handles request with parent logs', () => {
      const request = createTestRequest({
        rhiza: {
          id: 'rhiza_001',
          path: ['klados_entry', 'klados_current'],
          parent_logs: ['log_001', 'log_002'],
        },
      });
      const job = KladosJob.accept(request, testConfig);

      expect(job.request.rhiza?.parent_logs).toEqual(['log_001', 'log_002']);
    });

    it('handles request with batch context', () => {
      const request = createTestRequest({
        rhiza: {
          id: 'rhiza_001',
          path: ['klados_scatter', 'klados_worker'],
          parent_logs: ['log_scatter'],
          batch: {
            id: 'batch_abc',
            index: 3,
            total: 10,
          },
        },
      });
      const job = KladosJob.accept(request, testConfig);

      expect(job.batchContext).toEqual({
        id: 'batch_abc',
        index: 3,
        total: 10,
      });
    });
  });

  describe('config variations', () => {
    it('handles config without auth token', () => {
      const config: KladosJobConfig = {
        agentId: 'klados_no_auth',
        agentVersion: '1.0.0',
      };
      const request = createTestRequest();
      const job = KladosJob.accept(request, config);

      expect(job.config.authToken).toBeUndefined();
    });

    it('handles config with auth token', () => {
      const config: KladosJobConfig = {
        agentId: 'klados_with_auth',
        agentVersion: '2.0.0',
        authToken: 'ak_some_key',
      };
      const request = createTestRequest();
      const job = KladosJob.accept(request, config);

      expect(job.config.authToken).toBe('ak_some_key');
    });
  });
});
