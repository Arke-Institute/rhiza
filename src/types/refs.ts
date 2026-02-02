/**
 * Entity References
 *
 * EntityRef is a typed reference to a klados or rhiza entity within flow definitions.
 * Follows the established Arke EntityRef convention (see arke_v1/src/schema/refs.ts).
 *
 * Key benefits:
 * - Type hints avoid runtime discoverTargetType() API calls
 * - Labels provide display context without fetching
 * - Duck typing: any object with `pi` field is treated as EntityRef
 */

// =============================================================================
// Types
// =============================================================================

/**
 * EntityRef - A typed reference to a klados or rhiza entity
 *
 * Example usage in flow definitions:
 * ```typescript
 * flow: {
 *   'klados_a': {
 *     then: {
 *       pass: { pi: 'klados_b', type: 'klados', label: 'Processor' }
 *     }
 *   }
 * }
 * ```
 */
export interface EntityRef {
  /** The referenced entity's persistent identifier (required) */
  pi: string;

  /** Type hint: "klados" or "rhiza" - avoids runtime type discovery when present */
  type?: 'klados' | 'rhiza';

  /** Display label - avoids needing to fetch the entity for display */
  label?: string;

  /** Human-readable description of why this reference exists */
  description?: string;
}

// =============================================================================
// Type Guard
// =============================================================================

/**
 * Check if a value is an EntityRef
 *
 * Uses duck typing: any object with a `pi` string field is considered a ref.
 */
export function isEntityRef(value: unknown): value is EntityRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pi' in value &&
    typeof (value as EntityRef).pi === 'string'
  );
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Create an EntityRef with optional metadata
 *
 * @param pi - The entity ID
 * @param options - Optional type, label, description
 * @returns An EntityRef object
 *
 * @example
 * ref('klados_worker', { type: 'klados' })
 * ref('rhiza_subprocess', { type: 'rhiza', label: 'OCR Pipeline' })
 */
export function ref(
  pi: string,
  options?: { type?: 'klados' | 'rhiza'; label?: string; description?: string }
): EntityRef {
  return { pi, ...options };
}
