/**
 * Klados Validation
 *
 * Validates klados entity properties at creation/update time (static validation).
 * This ensures klados definitions are well-formed before they can be activated.
 */

import type { KladosProperties } from '../types';

/**
 * ValidationResult - Result of validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  field?: string;
}

/**
 * Validate klados properties (static validation)
 *
 * Checks:
 * - endpoint: Required, must be valid URL
 * - accepts.types: Required, non-empty array
 * - accepts.cardinality: Must be 'one' or 'many'
 * - produces.types: Required, non-empty array
 * - produces.cardinality: Must be 'one' or 'many'
 * - actions_required: Required, non-empty array
 */
export function validateKladosProperties(
  properties: Partial<KladosProperties> | null | undefined
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Handle null/undefined input
  if (!properties) {
    errors.push({
      code: 'MISSING_ENDPOINT',
      message: 'Klados must have an endpoint URL',
      field: 'endpoint',
    });
    errors.push({
      code: 'EMPTY_ACCEPTS_TYPES',
      message: 'accepts.types must be non-empty (use ["*"] for any)',
      field: 'accepts.types',
    });
    errors.push({
      code: 'EMPTY_PRODUCES_TYPES',
      message: 'produces.types must be non-empty (use ["*"] for any)',
      field: 'produces.types',
    });
    errors.push({
      code: 'EMPTY_ACTIONS',
      message: 'actions_required must be non-empty',
      field: 'actions_required',
    });
    return { valid: false, errors, warnings };
  }

  // =========================================================================
  // Endpoint Validation
  // =========================================================================

  if (!properties.endpoint) {
    errors.push({
      code: 'MISSING_ENDPOINT',
      message: 'Klados must have an endpoint URL',
      field: 'endpoint',
    });
  } else {
    try {
      const url = new URL(properties.endpoint);
      // Only allow http and https protocols
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push({
          code: 'INVALID_ENDPOINT',
          message: `Invalid endpoint URL protocol: ${url.protocol}`,
          field: 'endpoint',
        });
      }
    } catch {
      errors.push({
        code: 'INVALID_ENDPOINT',
        message: `Invalid endpoint URL: ${properties.endpoint}`,
        field: 'endpoint',
      });
    }
  }

  // =========================================================================
  // Accepts Contract Validation
  // =========================================================================

  if (!properties.accepts?.types || properties.accepts.types.length === 0) {
    errors.push({
      code: 'EMPTY_ACCEPTS_TYPES',
      message: 'accepts.types must be non-empty (use ["*"] for any)',
      field: 'accepts.types',
    });
  }

  if (!properties.accepts?.cardinality) {
    errors.push({
      code: 'INVALID_CARDINALITY',
      message: 'accepts.cardinality must be "one" or "many"',
      field: 'accepts.cardinality',
    });
  } else if (!['one', 'many'].includes(properties.accepts.cardinality)) {
    errors.push({
      code: 'INVALID_CARDINALITY',
      message: `accepts.cardinality must be "one" or "many", got "${properties.accepts.cardinality}"`,
      field: 'accepts.cardinality',
    });
  }

  // =========================================================================
  // Produces Contract Validation
  // =========================================================================

  if (!properties.produces?.types || properties.produces.types.length === 0) {
    errors.push({
      code: 'EMPTY_PRODUCES_TYPES',
      message: 'produces.types must be non-empty (use ["*"] for any)',
      field: 'produces.types',
    });
  }

  if (!properties.produces?.cardinality) {
    errors.push({
      code: 'INVALID_CARDINALITY',
      message: 'produces.cardinality must be "one" or "many"',
      field: 'produces.cardinality',
    });
  } else if (!['one', 'many'].includes(properties.produces.cardinality)) {
    errors.push({
      code: 'INVALID_CARDINALITY',
      message: `produces.cardinality must be "one" or "many", got "${properties.produces.cardinality}"`,
      field: 'produces.cardinality',
    });
  }

  // =========================================================================
  // Actions Required Validation
  // =========================================================================

  if (!properties.actions_required || properties.actions_required.length === 0) {
    errors.push({
      code: 'EMPTY_ACTIONS',
      message: 'actions_required must be non-empty',
      field: 'actions_required',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
