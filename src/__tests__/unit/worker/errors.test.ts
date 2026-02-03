import { describe, it, expect } from 'vitest';
import {
  KladosErrorCode,
  createKladosError,
  toKladosError,
  isKladosError,
} from '../../../worker/errors';

describe('KladosErrorCode', () => {
  it('has expected retryable error codes', () => {
    expect(KladosErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR');
    expect(KladosErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(KladosErrorCode.TIMEOUT).toBe('TIMEOUT');
    expect(KladosErrorCode.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE');
    expect(KladosErrorCode.TEMPORARY_FAILURE).toBe('TEMPORARY_FAILURE');
  });

  it('has expected non-retryable error codes', () => {
    expect(KladosErrorCode.NOT_FOUND).toBe('NOT_FOUND');
    expect(KladosErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(KladosErrorCode.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
    expect(KladosErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(KladosErrorCode.UNSUPPORTED_TYPE).toBe('UNSUPPORTED_TYPE');
    expect(KladosErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(KladosErrorCode.PROCESSING_ERROR).toBe('PROCESSING_ERROR');
  });
});

describe('createKladosError', () => {
  describe('default retryability', () => {
    it('marks network errors as retryable', () => {
      const error = createKladosError(KladosErrorCode.NETWORK_ERROR, 'Network failed');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.message).toBe('Network failed');
      expect(error.retryable).toBe(true);
    });

    it('marks rate limited errors as retryable', () => {
      const error = createKladosError(KladosErrorCode.RATE_LIMITED, 'Too many requests');
      expect(error.retryable).toBe(true);
    });

    it('marks timeout errors as retryable', () => {
      const error = createKladosError(KladosErrorCode.TIMEOUT, 'Request timed out');
      expect(error.retryable).toBe(true);
    });

    it('marks service unavailable as retryable', () => {
      const error = createKladosError(KladosErrorCode.SERVICE_UNAVAILABLE, 'Service down');
      expect(error.retryable).toBe(true);
    });

    it('marks temporary failure as retryable', () => {
      const error = createKladosError(KladosErrorCode.TEMPORARY_FAILURE, 'Temporary issue');
      expect(error.retryable).toBe(true);
    });

    it('marks not found as non-retryable', () => {
      const error = createKladosError(KladosErrorCode.NOT_FOUND, 'Entity not found');
      expect(error.retryable).toBe(false);
    });

    it('marks validation error as non-retryable', () => {
      const error = createKladosError(KladosErrorCode.VALIDATION_ERROR, 'Invalid data');
      expect(error.retryable).toBe(false);
    });

    it('marks permission denied as non-retryable', () => {
      const error = createKladosError(KladosErrorCode.PERMISSION_DENIED, 'Access denied');
      expect(error.retryable).toBe(false);
    });

    it('marks invalid input as non-retryable', () => {
      const error = createKladosError(KladosErrorCode.INVALID_INPUT, 'Bad input');
      expect(error.retryable).toBe(false);
    });

    it('marks internal error as non-retryable', () => {
      const error = createKladosError(KladosErrorCode.INTERNAL_ERROR, 'Internal error');
      expect(error.retryable).toBe(false);
    });
  });

  describe('retryability override', () => {
    it('can override retryable to false', () => {
      const error = createKladosError(KladosErrorCode.NETWORK_ERROR, 'Fatal network error', false);
      expect(error.retryable).toBe(false);
    });

    it('can override non-retryable to true', () => {
      const error = createKladosError(KladosErrorCode.NOT_FOUND, 'May appear later', true);
      expect(error.retryable).toBe(true);
    });
  });
});

describe('toKladosError', () => {
  describe('already KladosError', () => {
    it('returns the error unchanged', () => {
      const original = createKladosError(KladosErrorCode.NETWORK_ERROR, 'Test');
      const result = toKladosError(original);
      expect(result).toBe(original);
    });
  });

  describe('Error classification', () => {
    it('classifies network errors', () => {
      const result = toKladosError(new Error('Network request failed'));
      expect(result.code).toBe('NETWORK_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('classifies fetch errors', () => {
      const result = toKladosError(new Error('fetch failed'));
      expect(result.code).toBe('NETWORK_ERROR');
    });

    it('classifies ECONNREFUSED errors', () => {
      const result = toKladosError(new Error('connect ECONNREFUSED 127.0.0.1:3000'));
      expect(result.code).toBe('NETWORK_ERROR');
    });

    it('classifies ENOTFOUND errors', () => {
      const result = toKladosError(new Error('getaddrinfo ENOTFOUND example.com'));
      expect(result.code).toBe('NETWORK_ERROR');
    });

    it('classifies timeout errors', () => {
      const result = toKladosError(new Error('Request timed out'));
      expect(result.code).toBe('TIMEOUT');
      expect(result.retryable).toBe(true);
    });

    it('classifies timed out errors', () => {
      const result = toKladosError(new Error('Operation timed out after 30s'));
      expect(result.code).toBe('TIMEOUT');
    });

    it('classifies rate limit errors', () => {
      const result = toKladosError(new Error('Rate limit exceeded'));
      expect(result.code).toBe('RATE_LIMITED');
      expect(result.retryable).toBe(true);
    });

    it('classifies 429 errors', () => {
      const result = toKladosError(new Error('HTTP 429: Too many requests'));
      expect(result.code).toBe('RATE_LIMITED');
    });

    it('classifies not found errors', () => {
      const result = toKladosError(new Error('Entity not found'));
      expect(result.code).toBe('NOT_FOUND');
      expect(result.retryable).toBe(false);
    });

    it('classifies 404 errors', () => {
      const result = toKladosError(new Error('HTTP 404: Not found'));
      expect(result.code).toBe('NOT_FOUND');
    });

    it('classifies permission errors', () => {
      const result = toKladosError(new Error('Permission denied'));
      expect(result.code).toBe('PERMISSION_DENIED');
      expect(result.retryable).toBe(false);
    });

    it('classifies forbidden errors', () => {
      const result = toKladosError(new Error('Access forbidden'));
      expect(result.code).toBe('PERMISSION_DENIED');
    });

    it('classifies 403 errors', () => {
      const result = toKladosError(new Error('HTTP 403: Forbidden'));
      expect(result.code).toBe('PERMISSION_DENIED');
    });

    it('classifies 401 errors', () => {
      const result = toKladosError(new Error('HTTP 401: Unauthorized'));
      expect(result.code).toBe('PERMISSION_DENIED');
    });

    it('classifies unauthorized errors', () => {
      const result = toKladosError(new Error('Unauthorized access'));
      expect(result.code).toBe('PERMISSION_DENIED');
    });

    it('defaults to PROCESSING_ERROR for unknown errors', () => {
      const result = toKladosError(new Error('Something went wrong'));
      expect(result.code).toBe('PROCESSING_ERROR');
      expect(result.message).toBe('Something went wrong');
      expect(result.retryable).toBe(true); // Safe default
    });
  });

  describe('non-Error inputs', () => {
    it('handles string errors', () => {
      const result = toKladosError('Something went wrong');
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Something went wrong');
      expect(result.retryable).toBe(false);
    });

    it('handles unknown types', () => {
      const result = toKladosError(12345);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Unknown error');
      expect(result.retryable).toBe(false);
    });

    it('handles null', () => {
      const result = toKladosError(null);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Unknown error');
    });

    it('handles undefined', () => {
      const result = toKladosError(undefined);
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Unknown error');
    });
  });
});

describe('isKladosError', () => {
  it('returns true for valid KladosError', () => {
    const error = createKladosError(KladosErrorCode.NETWORK_ERROR, 'Test');
    expect(isKladosError(error)).toBe(true);
  });

  it('returns true for manually constructed KladosError', () => {
    const error = {
      code: 'CUSTOM_ERROR',
      message: 'Custom message',
      retryable: false,
    };
    expect(isKladosError(error)).toBe(true);
  });

  it('returns false for regular Error', () => {
    expect(isKladosError(new Error('Test'))).toBe(false);
  });

  it('returns false for object missing code', () => {
    expect(isKladosError({ message: 'Test', retryable: true })).toBe(false);
  });

  it('returns false for object missing message', () => {
    expect(isKladosError({ code: 'TEST', retryable: true })).toBe(false);
  });

  it('returns false for object missing retryable', () => {
    expect(isKladosError({ code: 'TEST', message: 'Test' })).toBe(false);
  });

  it('returns false for object with wrong types', () => {
    expect(isKladosError({ code: 123, message: 'Test', retryable: true })).toBe(false);
    expect(isKladosError({ code: 'TEST', message: 123, retryable: true })).toBe(false);
    expect(isKladosError({ code: 'TEST', message: 'Test', retryable: 'yes' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isKladosError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isKladosError(undefined)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isKladosError('error')).toBe(false);
  });

  it('returns false for number', () => {
    expect(isKladosError(42)).toBe(false);
  });
});
