/**
 * Runtime Validation
 *
 * Validates a rhiza at invoke time by loading all targets and checking:
 * - All targets exist (as klados or rhiza) and are active
 * - Cardinality compatibility
 * - Type compatibility (warnings)
 */

import type { KladosEntity, RhizaEntity, RhizaProperties, ThenSpec } from '../types';
import type { ValidationError, ValidationWarning } from './validate-klados';
import type { MockArkeClient } from '../__tests__/fixtures/mock-client';

export interface RuntimeValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  kladoi: Map<string, KladosEntity>;
  rhizai: Map<string, RhizaEntity>;
}

/**
 * Validate a rhiza at runtime
 *
 * This loads all targets and validates:
 * 1. All targets exist (as klados or rhiza) and are active
 * 2. Cardinality compatibility
 * 3. Type compatibility (warnings)
 */
export async function validateRhizaRuntime(
  client: MockArkeClient,
  properties: RhizaProperties
): Promise<RuntimeValidationResult> {
  const errors: (ValidationError & { klados_id?: string })[] = [];
  const warnings: (ValidationWarning & { klados_id?: string })[] = [];
  const kladoi = new Map<string, KladosEntity>();
  const rhizai = new Map<string, RhizaEntity>();

  // Collect all target IDs from flow
  const targetIds = new Set<string>(Object.keys(properties.flow));

  // Also collect route targets
  for (const step of Object.values(properties.flow)) {
    const routeTargets = extractRouteTargets(step.then);
    for (const target of routeTargets) {
      targetIds.add(target);
    }
  }

  // Load all targets (try as klados first, then as rhiza)
  for (const targetId of targetIds) {
    const resolved = await resolveTarget(client, targetId, errors);
    if (resolved?.type === 'klados') {
      kladoi.set(targetId, resolved.entity as KladosEntity);
    } else if (resolved?.type === 'rhiza') {
      rhizai.set(targetId, resolved.entity as RhizaEntity);
    }
  }

  // Skip cardinality/type validation if we're missing targets
  if (errors.length > 0) {
    return { valid: false, errors, warnings, kladoi, rhizai };
  }

  // Validate cardinality compatibility (only for klados targets)
  for (const [kladosId, step] of Object.entries(properties.flow)) {
    validateCardinalityRuntime(kladosId, step.then, kladoi, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    kladoi,
    rhizai,
  };
}

/**
 * Resolve a target ID to klados or rhiza
 */
async function resolveTarget(
  client: MockArkeClient,
  targetId: string,
  errors: (ValidationError & { klados_id?: string })[]
): Promise<{ type: 'klados' | 'rhiza'; entity: KladosEntity | RhizaEntity } | null> {
  // Try as klados first
  const kladosResult = await client.api.GET('/kladoi/{id}', {
    params: { path: { id: targetId } },
  });

  if (!kladosResult.error && kladosResult.data) {
    const klados = kladosResult.data as KladosEntity;
    if (klados.properties.status !== 'active') {
      errors.push({
        code: 'KLADOS_NOT_ACTIVE',
        message: `Klados '${targetId}' is not active (status: ${klados.properties.status})`,
        klados_id: targetId,
      });
    }
    return { type: 'klados', entity: klados };
  }

  // Try as rhiza
  const rhizaResult = await client.api.GET('/rhizai/{id}', {
    params: { path: { id: targetId } },
  });

  if (!rhizaResult.error && rhizaResult.data) {
    const rhiza = rhizaResult.data as RhizaEntity;
    if (rhiza.properties.status !== 'active') {
      errors.push({
        code: 'RHIZA_NOT_ACTIVE',
        message: `Rhiza '${targetId}' is not active (status: ${rhiza.properties.status})`,
      });
    }
    return { type: 'rhiza', entity: rhiza };
  }

  errors.push({
    code: 'TARGET_NOT_FOUND',
    message: `Target '${targetId}' not found as klados or rhiza`,
  });
  return null;
}

/**
 * Extract route targets from a ThenSpec
 */
function extractRouteTargets(then: ThenSpec): string[] {
  if ('done' in then) return [];

  const targets: string[] = [];

  if ('pass' in then && then.route) {
    targets.push(...then.route.map((r) => r.target));
  }
  if ('scatter' in then && then.route) {
    targets.push(...then.route.map((r) => r.target));
  }
  if ('gather' in then && then.route) {
    targets.push(...then.route.map((r) => r.target));
  }

  return targets;
}

/**
 * Validate cardinality at runtime
 */
function validateCardinalityRuntime(
  kladosId: string,
  then: ThenSpec,
  kladoi: Map<string, KladosEntity>,
  errors: (ValidationError & { klados_id?: string })[],
  warnings: (ValidationWarning & { klados_id?: string })[]
): void {
  if ('done' in then) {
    return;
  }

  const sourceKlados = kladoi.get(kladosId);
  if (!sourceKlados) return;

  const sourceProduces = sourceKlados.properties.produces;

  if ('scatter' in then) {
    // Scatter requires produces.cardinality === 'many'
    if (sourceProduces.cardinality !== 'many') {
      errors.push({
        code: 'PRODUCER_CARDINALITY_MISMATCH',
        message: `Klados '${kladosId}' uses scatter but produces.cardinality is 'one'`,
        klados_id: kladosId,
      });
    }

    // Scatter target must accept 'one' (if it's a klados)
    const targetKlados = kladoi.get(then.scatter);
    if (targetKlados && targetKlados.properties.accepts.cardinality !== 'one') {
      errors.push({
        code: 'TARGET_CARDINALITY_MISMATCH',
        message: `Scatter target '${then.scatter}' accepts 'many', should accept 'one'`,
        klados_id: kladosId,
      });
    }

    // Check type compatibility (warning)
    if (targetKlados) {
      checkTypeCompatibility(
        kladosId,
        sourceProduces.types,
        targetKlados.properties.accepts.types,
        warnings
      );
    }
  }

  if ('gather' in then) {
    // Gather target must accept 'many' (if it's a klados)
    const targetKlados = kladoi.get(then.gather);
    if (targetKlados && targetKlados.properties.accepts.cardinality !== 'many') {
      errors.push({
        code: 'TARGET_CARDINALITY_MISMATCH',
        message: `Gather target '${then.gather}' accepts 'one', should accept 'many'`,
        klados_id: kladosId,
      });
    }
  }

  if ('pass' in then) {
    const targetKlados = kladoi.get(then.pass);
    if (targetKlados) {
      // Cardinality mismatch warning
      if (sourceProduces.cardinality !== targetKlados.properties.accepts.cardinality) {
        warnings.push({
          code: 'CARDINALITY_MISMATCH',
          message: `Klados '${kladosId}' produces '${sourceProduces.cardinality}' but '${then.pass}' accepts '${targetKlados.properties.accepts.cardinality}'`,
          klados_id: kladosId,
        });
      }

      // Type compatibility (warning)
      checkTypeCompatibility(
        kladosId,
        sourceProduces.types,
        targetKlados.properties.accepts.types,
        warnings
      );
    }
  }
}

/**
 * Check type compatibility (warning only)
 */
function checkTypeCompatibility(
  kladosId: string,
  produced: string[],
  accepted: string[],
  warnings: (ValidationWarning & { klados_id?: string })[]
): void {
  if (accepted.includes('*')) return;
  if (produced.includes('*')) return;

  const compatible = produced.some((p) =>
    accepted.some((a) => typeMatches(p, a))
  );

  if (!compatible) {
    warnings.push({
      code: 'TYPE_MISMATCH',
      message: `Klados '${kladosId}' produces ${JSON.stringify(produced)} but target accepts ${JSON.stringify(accepted)}`,
      klados_id: kladosId,
    });
  }
}

/**
 * Check if a type matches a pattern
 */
function typeMatches(type: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === type) return true;

  // Simple glob: "file/*" matches "file/pdf"
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1);
    return type.startsWith(prefix);
  }

  // Check the other direction too (produced pattern matches accepted type)
  if (type.endsWith('/*')) {
    const prefix = type.slice(0, -1);
    return pattern.startsWith(prefix);
  }

  return false;
}
