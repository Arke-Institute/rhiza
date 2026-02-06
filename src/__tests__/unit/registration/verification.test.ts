import { describe, it, expect } from 'vitest';
import {
  buildVerificationResponse,
  createVerificationHandler,
  type VerificationConfig,
} from '../../../registration/verification';

describe('verification utilities', () => {
  describe('buildVerificationResponse', () => {
    it('returns null when no verification token', () => {
      const config: VerificationConfig = {
        agentId: 'klados_123',
      };
      const response = buildVerificationResponse(config);
      expect(response).toBeNull();
    });

    it('returns verification response with token', () => {
      const config: VerificationConfig = {
        verificationToken: 'tok_abc123',
        agentId: 'klados_123',
      };
      const response = buildVerificationResponse(config);
      expect(response).toEqual({
        verification_token: 'tok_abc123',
        klados_id: 'klados_123',
      });
    });

    it('prefers verifyAgentId over agentId', () => {
      const config: VerificationConfig = {
        verificationToken: 'tok_abc123',
        verifyAgentId: 'klados_verify',
        agentId: 'klados_main',
      };
      const response = buildVerificationResponse(config);
      expect(response).toEqual({
        verification_token: 'tok_abc123',
        klados_id: 'klados_verify',
      });
    });

    it('falls back to agentId when verifyAgentId is undefined', () => {
      const config: VerificationConfig = {
        verificationToken: 'tok_abc123',
        verifyAgentId: undefined,
        agentId: 'klados_main',
      };
      const response = buildVerificationResponse(config);
      expect(response).toEqual({
        verification_token: 'tok_abc123',
        klados_id: 'klados_main',
      });
    });
  });

  describe('createVerificationHandler', () => {
    it('returns 400 when verification not configured', () => {
      const config: VerificationConfig = {
        agentId: 'klados_123',
      };
      const handler = createVerificationHandler(config);
      const result = handler();
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'Verification not configured' });
    });

    it('returns 200 with verification response when configured', () => {
      const config: VerificationConfig = {
        verificationToken: 'tok_abc123',
        agentId: 'klados_123',
      };
      const handler = createVerificationHandler(config);
      const result = handler();
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        verification_token: 'tok_abc123',
        klados_id: 'klados_123',
      });
    });

    it('returns function that can be called multiple times', () => {
      const config: VerificationConfig = {
        verificationToken: 'tok_abc123',
        agentId: 'klados_123',
      };
      const handler = createVerificationHandler(config);

      const result1 = handler();
      const result2 = handler();

      expect(result1).toEqual(result2);
    });
  });
});
