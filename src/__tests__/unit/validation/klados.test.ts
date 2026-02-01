/**
 * Klados Validation Tests
 *
 * Tests for validateKladosProperties() which validates klados entity properties
 * at creation/update time (static validation).
 *
 * Validation Rules:
 * - endpoint: Required, must be valid URL
 * - accepts.types: Required, non-empty array
 * - accepts.cardinality: Must be 'one' or 'many'
 * - produces.types: Required, non-empty array
 * - produces.cardinality: Must be 'one' or 'many'
 * - actions_required: Required, non-empty array
 */

import { describe, it, expect } from 'vitest';
import { validateKladosProperties } from '../../../validation';
import {
  validKladosProperties,
  invalidKladosProperties,
} from '../../fixtures';

describe('validateKladosProperties', () => {
  // =========================================================================
  // Valid Cases
  // =========================================================================

  describe('valid klados properties', () => {
    it('passes for valid klados properties', () => {
      const result = validateKladosProperties(validKladosProperties);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for klados with wildcard types ["*"]', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        accepts: { types: ['*'], cardinality: 'one' },
        produces: { types: ['*'], cardinality: 'one' },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for klados with multiple accepted types', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        accepts: { types: ['file/jpeg', 'file/png', 'file/webp'], cardinality: 'one' },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for klados with cardinality many', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        produces: { types: ['item/*'], cardinality: 'many' },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for klados with multiple actions required', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        actions_required: ['file:view', 'file:create', 'entity:update', 'collection:manage'],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes for development status klados', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        status: 'development',
      });

      expect(result.valid).toBe(true);
    });

    it('passes for disabled status klados', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        status: 'disabled',
      });

      expect(result.valid).toBe(true);
    });
  });

  // =========================================================================
  // Endpoint Validation
  // =========================================================================

  describe('endpoint validation', () => {
    it('fails when endpoint is missing', () => {
      const result = validateKladosProperties(invalidKladosProperties.missingEndpoint);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_ENDPOINT',
          field: 'endpoint',
        })
      );
    });

    it('fails when endpoint is empty string', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        endpoint: '',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'MISSING_ENDPOINT',
        })
      );
    });

    it('fails when endpoint is invalid URL', () => {
      const result = validateKladosProperties(invalidKladosProperties.invalidEndpoint);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_ENDPOINT',
          field: 'endpoint',
        })
      );
    });

    it('fails for endpoint without protocol', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        endpoint: 'example.com/invoke',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_ENDPOINT',
        })
      );
    });

    it('passes for https endpoint', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        endpoint: 'https://secure.example.com/invoke',
      });

      expect(result.valid).toBe(true);
    });

    it('passes for http endpoint (allowed for development)', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        endpoint: 'http://localhost:3000/invoke',
      });

      expect(result.valid).toBe(true);
    });
  });

  // =========================================================================
  // Accepts Contract Validation
  // =========================================================================

  describe('accepts contract validation', () => {
    it('fails when accepts.types is empty', () => {
      const result = validateKladosProperties(invalidKladosProperties.emptyAcceptsTypes);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'EMPTY_ACCEPTS_TYPES',
          field: 'accepts.types',
        })
      );
    });

    it('fails when accepts is missing', () => {
      const props = { ...validKladosProperties };
      delete (props as Record<string, unknown>).accepts;

      const result = validateKladosProperties(props);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'EMPTY_ACCEPTS_TYPES',
        })
      );
    });

    it('fails when accepts.cardinality is invalid', () => {
      const result = validateKladosProperties(invalidKladosProperties.invalidCardinality);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_CARDINALITY',
          field: 'accepts.cardinality',
        })
      );
    });

    it('fails when accepts.cardinality is missing', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        accepts: { types: ['*'] } as { types: string[]; cardinality: 'one' | 'many' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_CARDINALITY',
        })
      );
    });
  });

  // =========================================================================
  // Produces Contract Validation
  // =========================================================================

  describe('produces contract validation', () => {
    it('fails when produces.types is empty', () => {
      const result = validateKladosProperties(invalidKladosProperties.emptyProducesTypes);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'EMPTY_PRODUCES_TYPES',
          field: 'produces.types',
        })
      );
    });

    it('fails when produces is missing', () => {
      const props = { ...validKladosProperties };
      delete (props as Record<string, unknown>).produces;

      const result = validateKladosProperties(props);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'EMPTY_PRODUCES_TYPES',
        })
      );
    });

    it('fails when produces.cardinality is invalid', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        produces: { types: ['*'], cardinality: 'invalid' as 'one' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_CARDINALITY',
          field: 'produces.cardinality',
        })
      );
    });

    it('fails when produces.cardinality is missing', () => {
      const result = validateKladosProperties({
        ...validKladosProperties,
        produces: { types: ['*'] } as { types: string[]; cardinality: 'one' | 'many' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_CARDINALITY',
        })
      );
    });
  });

  // =========================================================================
  // Actions Required Validation
  // =========================================================================

  describe('actions_required validation', () => {
    it('fails when actions_required is empty', () => {
      const result = validateKladosProperties(invalidKladosProperties.emptyActionsRequired);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'EMPTY_ACTIONS',
          field: 'actions_required',
        })
      );
    });

    it('fails when actions_required is missing', () => {
      const props = { ...validKladosProperties };
      delete (props as Record<string, unknown>).actions_required;

      const result = validateKladosProperties(props);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'EMPTY_ACTIONS',
        })
      );
    });
  });

  // =========================================================================
  // Multiple Errors
  // =========================================================================

  describe('multiple errors', () => {
    it('returns all errors when multiple fields are invalid', () => {
      const result = validateKladosProperties({
        label: 'Bad Klados',
        // Missing: endpoint, accepts, produces, actions_required
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);

      const errorCodes = result.errors.map((e) => e.code);
      expect(errorCodes).toContain('MISSING_ENDPOINT');
      expect(errorCodes).toContain('EMPTY_ACCEPTS_TYPES');
      expect(errorCodes).toContain('EMPTY_PRODUCES_TYPES');
      expect(errorCodes).toContain('EMPTY_ACTIONS');
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles undefined input gracefully', () => {
      const result = validateKladosProperties(undefined as unknown as Record<string, unknown>);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles null input gracefully', () => {
      const result = validateKladosProperties(null as unknown as Record<string, unknown>);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles empty object input', () => {
      const result = validateKladosProperties({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
