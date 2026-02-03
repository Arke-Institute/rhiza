/**
 * ID Generation Utility
 *
 * Generates unique identifiers for logs, batches, and jobs.
 */

/**
 * Generate a unique identifier
 *
 * Uses crypto.randomUUID() for standard UUID v4 generation,
 * with a fallback for environments where it's not available.
 *
 * @returns A unique identifier string (UUID v4 format)
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
