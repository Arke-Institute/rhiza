/**
 * Entity References
 *
 * EntityRef is a typed reference to a klados or rhiza entity within flow definitions.
 * Follows the established Arke EntityRef convention (see arke_v1/src/schema/refs.ts).
 *
 * Key benefits:
 * - Type hints avoid runtime discoverTargetType() API calls
 * - Labels provide display context without fetching
 * - Duck typing: any object with `id` field is treated as EntityRef
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
 *       pass: { id: 'klados_b', type: 'klados', label: 'Processor' }
 *     }
 *   }
 * }
 * ```
 */
export interface EntityRef {
  /** The referenced entity's persistent identifier (required) */
  id: string;

  /** Type hint: "klados" or "rhiza" - avoids runtime type discovery when present */
  type?: 'klados' | 'rhiza';

  /** Display label - avoids needing to fetch the entity for display */
  label?: string;

  /** Human-readable description of why this reference exists */
  description?: string;
}

/**
 * Legacy EntityRef using `pi` field.
 * @deprecated Use EntityRef with `id` field instead.
 */
export interface LegacyEntityRef {
  /** @deprecated Use `id` instead */
  pi: string;
  type?: 'klados' | 'rhiza';
  label?: string;
  description?: string;
}

/** EntityRef that accepts either `id` (preferred) or `pi` (legacy) */
export type AnyEntityRef = EntityRef | LegacyEntityRef;

// =============================================================================
// Type Guard
// =============================================================================

/**
 * Check if a value is an EntityRef
 *
 * Uses duck typing: any object with an `id` or `pi` string field is considered a ref.
 * Accepts both `id` (preferred) and `pi` (legacy) for backwards compatibility.
 */
export function isEntityRef(value: unknown): value is AnyEntityRef {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  const hasId = 'id' in obj && typeof obj.id === 'string';
  const hasPi = 'pi' in obj && typeof obj.pi === 'string';
  return hasId || hasPi;
}

/**
 * Get the entity ID from an EntityRef
 *
 * Handles both `id` and `pi` field names, preferring `id` if both are present.
 *
 * @param ref - The EntityRef to extract ID from
 * @returns The entity ID string
 * @throws Error if neither `id` nor `pi` is present
 */
export function getRefId(ref: AnyEntityRef): string {
  if ('id' in ref) return ref.id;
  if ('pi' in ref) return ref.pi;
  throw new Error('EntityRef must have either id or pi field');
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Create an EntityRef with optional metadata
 *
 * @param entityId - The entity ID (persistent identifier)
 * @param options - Optional type, label, description
 * @returns An EntityRef object with `id` field
 *
 * @example
 * ref('klados_worker', { type: 'klados' })
 * ref('rhiza_subprocess', { type: 'rhiza', label: 'OCR Pipeline' })
 */
export function ref(
  entityId: string,
  options?: { type?: 'klados' | 'rhiza'; label?: string; description?: string }
): EntityRef {
  return { id: entityId, ...options };
}
