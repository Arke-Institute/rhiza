# Validation

## Overview

The validation module ensures rhiza and klados definitions are well-formed before execution. Validation catches configuration errors early, preventing runtime failures.

Since kladoi are now first-class entities, validation happens at two levels:
1. **Static validation** - At definition time (rhiza flow structure)
2. **Runtime validation** - At invoke time (klados compatibility, target resolution)

---

## Klados Validation (Static)

When creating or updating a klados entity.

| Rule | Description | Error Code |
|------|-------------|------------|
| Endpoint required | `endpoint` must be a valid URL | `MISSING_ENDPOINT` |
| Types explicit | `accepts.types` must be non-empty (use `["*"]` for any) | `EMPTY_ACCEPTS_TYPES` |
| Types explicit | `produces.types` must be non-empty (use `["*"]` for any) | `EMPTY_PRODUCES_TYPES` |
| Cardinality explicit | `accepts.cardinality` must be 'one' or 'many' | `INVALID_CARDINALITY` |
| Cardinality explicit | `produces.cardinality` must be 'one' or 'many' | `INVALID_CARDINALITY` |
| Actions required | `actions_required` must be non-empty array | `EMPTY_ACTIONS` |

---

## Rhiza Validation (Static)

When creating or updating a rhiza entity.

### Structure Validation

| Rule | Description | Error Code |
|------|-------------|------------|
| Entry exists | Entry must be a valid ID in `flow` | `MISSING_ENTRY` |
| Flow references entry | `flow` must include the `entry` ID | `ENTRY_NOT_IN_FLOW` |
| Valid targets | All `pass`, `scatter`, `gather` targets and route targets must be valid IDs | `INVALID_TARGET` |
| All paths terminate | Every possible path must end in `done: true` or target a rhiza | `UNTERMINATED_PATH` |
| No cycles | Flow graph must not contain cycles (detected during path traversal) | `CYCLE_DETECTED` |
| No unreachable | All IDs in flow must be reachable from entry | `UNREACHABLE_KLADOS` (warning) |

### Flow Syntax Validation

| Rule | Description | Error Code |
|------|-------------|------------|
| Valid handoff type | `then` must be: `done`, `pass`, `scatter`, or `gather` | `INVALID_HANDOFF` |
| Route rules valid | Each rule in optional `route` array must have `where` and `target` | `INVALID_ROUTE_RULE` |
| Where condition valid | `where` must be a valid `WhereCondition` (equals, and, or) | `INVALID_WHERE_CONDITION` |

---

## Runtime Validation (At Invoke Time)

When invoking a rhiza, the API validates:

### Target Resolution

All target IDs in the flow must resolve to existing klados or rhiza entities.

| Rule | Description | Error Code |
|------|-------------|------------|
| Entry exists | Entry klados entity must exist | `ENTRY_KLADOS_NOT_FOUND` |
| All targets exist | All targets referenced in flow must exist (klados or rhiza) | `TARGET_NOT_FOUND` |
| All active | All kladoi must have `status: 'active'` | `KLADOS_NOT_ACTIVE` |

### Cardinality Compatibility

| Rule | Description | Error Code |
|------|-------------|------------|
| Scatter producer | Klados using `scatter` must have `produces.cardinality: 'many'` | `PRODUCER_CARDINALITY_MISMATCH` |
| Scatter target | Target of `scatter` must have `accepts.cardinality: 'one'` | `TARGET_CARDINALITY_MISMATCH` |
| Gather target | Target of `gather` must have `accepts.cardinality: 'many'` | `TARGET_CARDINALITY_MISMATCH` |
| Pass compatible | For `pass`, cardinalities should match | `CARDINALITY_MISMATCH` (warning) |

### Type Compatibility (Warning Only)

| Rule | Description | Error Code |
|------|-------------|------------|
| Types overlap | Produced types should overlap with accepted types | `TYPE_MISMATCH` (warning) |

---

## Implementation

### `src/validation/validate-klados.ts`

```typescript
import type { KladosEntity, KladosProperties } from '../types';

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
 */
export function validateKladosProperties(
  properties: Partial<KladosProperties>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Endpoint required
  if (!properties.endpoint) {
    errors.push({
      code: 'MISSING_ENDPOINT',
      message: 'Klados must have an endpoint URL',
      field: 'endpoint',
    });
  } else {
    try {
      new URL(properties.endpoint);
    } catch {
      errors.push({
        code: 'INVALID_ENDPOINT',
        message: `Invalid endpoint URL: ${properties.endpoint}`,
        field: 'endpoint',
      });
    }
  }

  // Accepts validation
  if (!properties.accepts?.types || properties.accepts.types.length === 0) {
    errors.push({
      code: 'EMPTY_ACCEPTS_TYPES',
      message: 'accepts.types must be non-empty (use ["*"] for any)',
      field: 'accepts.types',
    });
  }

  if (
    properties.accepts?.cardinality &&
    !['one', 'many'].includes(properties.accepts.cardinality)
  ) {
    errors.push({
      code: 'INVALID_CARDINALITY',
      message: 'accepts.cardinality must be "one" or "many"',
      field: 'accepts.cardinality',
    });
  }

  // Produces validation
  if (!properties.produces?.types || properties.produces.types.length === 0) {
    errors.push({
      code: 'EMPTY_PRODUCES_TYPES',
      message: 'produces.types must be non-empty (use ["*"] for any)',
      field: 'produces.types',
    });
  }

  if (
    properties.produces?.cardinality &&
    !['one', 'many'].includes(properties.produces.cardinality)
  ) {
    errors.push({
      code: 'INVALID_CARDINALITY',
      message: 'produces.cardinality must be "one" or "many"',
      field: 'produces.cardinality',
    });
  }

  // Actions required
  if (
    !properties.actions_required ||
    properties.actions_required.length === 0
  ) {
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
```

### `src/validation/validate-rhiza.ts`

```typescript
import type { RhizaProperties, FlowStep, ThenSpec, RouteRule, WhereCondition } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  klados_id?: string;
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  klados_id?: string;
  field?: string;
}

/**
 * Validate rhiza properties (static validation)
 *
 * This validates the structure of the rhiza definition.
 * It does NOT validate that targets actually exist (that's runtime).
 */
export function validateRhizaProperties(
  properties: Partial<RhizaProperties>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Entry required
  if (!properties.entry) {
    errors.push({
      code: 'MISSING_ENTRY',
      message: 'Rhiza must have an entry klados ID',
      field: 'entry',
    });
  }

  // Flow required
  if (!properties.flow || Object.keys(properties.flow).length === 0) {
    errors.push({
      code: 'EMPTY_FLOW',
      message: 'Rhiza must have at least one flow step',
      field: 'flow',
    });
    return { valid: false, errors, warnings };
  }

  // Entry must be in flow
  if (properties.entry && !properties.flow[properties.entry]) {
    errors.push({
      code: 'ENTRY_NOT_IN_FLOW',
      message: `Entry klados '${properties.entry}' is not in flow`,
      field: 'entry',
    });
  }

  // Validate each flow step
  for (const [kladosId, step] of Object.entries(properties.flow)) {
    validateFlowStep(kladosId, step, properties.flow, errors, warnings);
  }

  // Check all paths terminate (also detects cycles)
  if (properties.entry && properties.flow[properties.entry]) {
    const terminationResult = validateAllPathsTerminate(
      properties.entry,
      properties.flow
    );
    errors.push(...terminationResult.errors);
  }

  // Check for unreachable kladoi
  if (properties.entry && properties.flow[properties.entry]) {
    const reachable = findReachableIds(properties.entry, properties.flow);
    for (const kladosId of Object.keys(properties.flow)) {
      if (!reachable.has(kladosId)) {
        warnings.push({
          code: 'UNREACHABLE_KLADOS',
          message: `Klados '${kladosId}' is not reachable from entry`,
          klados_id: kladosId,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a single flow step
 */
function validateFlowStep(
  kladosId: string,
  step: FlowStep,
  flow: Record<string, FlowStep>,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (!step.then) {
    errors.push({
      code: 'MISSING_THEN',
      message: `Flow step for '${kladosId}' is missing 'then' specification`,
      klados_id: kladosId,
    });
    return;
  }

  validateThen(kladosId, step.then, flow, errors, warnings);
}

/**
 * Validate a then spec
 */
function validateThen(
  kladosId: string,
  then: ThenSpec,
  flow: Record<string, FlowStep>,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if ('done' in then) {
    // Terminal - valid
    return;
  }

  if ('pass' in then) {
    validateTarget(kladosId, 'pass', then.pass, flow, errors);
    if (then.route) {
      validateRouteRules(kladosId, then.route, flow, errors, warnings);
    }
    return;
  }

  if ('scatter' in then) {
    validateTarget(kladosId, 'scatter', then.scatter, flow, errors);
    if (then.route) {
      validateRouteRules(kladosId, then.route, flow, errors, warnings);
    }
    return;
  }

  if ('gather' in then) {
    validateTarget(kladosId, 'gather', then.gather, flow, errors);
    if (then.route) {
      validateRouteRules(kladosId, then.route, flow, errors, warnings);
    }
    return;
  }

  errors.push({
    code: 'INVALID_HANDOFF',
    message: `Unknown handoff type in '${kladosId}': ${JSON.stringify(then)}`,
    klados_id: kladosId,
  });
}

/**
 * Validate route rules on a handoff
 */
function validateRouteRules(
  kladosId: string,
  routes: RouteRule[],
  flow: Record<string, FlowStep>,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  for (let i = 0; i < routes.length; i++) {
    const rule = routes[i];

    if (!rule.where) {
      errors.push({
        code: 'INVALID_ROUTE_RULE',
        message: `Route rule ${i} in '${kladosId}' is missing 'where' condition`,
        klados_id: kladosId,
      });
    } else {
      validateWhereCondition(kladosId, rule.where, i, errors);
    }

    if (!rule.target) {
      errors.push({
        code: 'INVALID_ROUTE_RULE',
        message: `Route rule ${i} in '${kladosId}' is missing 'target'`,
        klados_id: kladosId,
      });
    } else {
      // Target can be in flow or external (rhiza) - validate format only
      if (typeof rule.target !== 'string') {
        errors.push({
          code: 'INVALID_TARGET',
          message: `Route rule ${i} target in '${kladosId}' must be a string ID`,
          klados_id: kladosId,
        });
      }
    }
  }
}

/**
 * Validate a where condition (recursive for AND/OR)
 */
function validateWhereCondition(
  kladosId: string,
  where: WhereCondition,
  ruleIndex: number,
  errors: ValidationError[]
): void {
  if ('property' in where && 'equals' in where) {
    // WhereEquals - valid
    if (typeof where.property !== 'string') {
      errors.push({
        code: 'INVALID_WHERE_CONDITION',
        message: `Route rule ${ruleIndex} in '${kladosId}': 'property' must be a string`,
        klados_id: kladosId,
      });
    }
    return;
  }

  if ('and' in where) {
    // WhereAnd
    if (!Array.isArray(where.and) || where.and.length === 0) {
      errors.push({
        code: 'INVALID_WHERE_CONDITION',
        message: `Route rule ${ruleIndex} in '${kladosId}': 'and' must be a non-empty array`,
        klados_id: kladosId,
      });
      return;
    }
    for (const condition of where.and) {
      validateWhereCondition(kladosId, condition, ruleIndex, errors);
    }
    return;
  }

  if ('or' in where) {
    // WhereOr
    if (!Array.isArray(where.or) || where.or.length === 0) {
      errors.push({
        code: 'INVALID_WHERE_CONDITION',
        message: `Route rule ${ruleIndex} in '${kladosId}': 'or' must be a non-empty array`,
        klados_id: kladosId,
      });
      return;
    }
    for (const condition of where.or) {
      validateWhereCondition(kladosId, condition, ruleIndex, errors);
    }
    return;
  }

  errors.push({
    code: 'INVALID_WHERE_CONDITION',
    message: `Route rule ${ruleIndex} in '${kladosId}': invalid where condition format`,
    klados_id: kladosId,
  });
}

/**
 * Validate a target reference
 *
 * Note: This only validates that the target is in the flow for static validation.
 * External targets (rhiza IDs) are validated at runtime.
 */
function validateTarget(
  sourceKladosId: string,
  handoffType: string,
  target: string,
  flow: Record<string, FlowStep>,
  errors: ValidationError[]
): void {
  if (!target || typeof target !== 'string') {
    errors.push({
      code: 'INVALID_TARGET',
      message: `Invalid target in '${sourceKladosId}' ${handoffType}`,
      klados_id: sourceKladosId,
      field: `then.${handoffType}`,
    });
    return;
  }

  // Target must be in flow (for static validation)
  // At runtime, targets not in flow are resolved as rhiza IDs
  if (!flow[target]) {
    errors.push({
      code: 'INVALID_TARGET',
      message: `Target '${target}' in '${sourceKladosId}' is not in flow`,
      klados_id: sourceKladosId,
      field: `then.${handoffType}`,
    });
  }
}

/**
 * Validate all paths terminate
 *
 * Traverses all possible paths from entry and ensures each ends in:
 * - done: true (terminal)
 * - A target not in flow (assumed to be a rhiza, validated at runtime)
 *
 * Also detects cycles during traversal.
 */
function validateAllPathsTerminate(
  entry: string,
  flow: Record<string, FlowStep>
): { errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  function traverse(current: string, path: string[]): void {
    // Cycle detection
    if (path.includes(current)) {
      const cycleStart = path.indexOf(current);
      const cycle = [...path.slice(cycleStart), current];
      errors.push({
        code: 'CYCLE_DETECTED',
        message: `Cycle detected: ${cycle.join(' -> ')}`,
      });
      return;
    }

    const step = flow[current];
    if (!step || !step.then) {
      // Not in flow - assumed to be rhiza target (valid termination)
      return;
    }

    const then = step.then;
    const newPath = [...path, current];

    if ('done' in then) {
      // Terminal - valid
      return;
    }

    // Get all possible targets (including route alternatives)
    const targets = extractAllTargets(then);

    if (targets.length === 0) {
      errors.push({
        code: 'UNTERMINATED_PATH',
        message: `Path ending at '${current}' has no valid target`,
        klados_id: current,
      });
      return;
    }

    for (const target of targets) {
      if (!flow[target]) {
        // Target not in flow - assumed to be rhiza (valid termination)
        continue;
      }
      traverse(target, newPath);
    }
  }

  traverse(entry, []);
  return { errors };
}

/**
 * Extract all possible targets from a ThenSpec (including route alternatives)
 */
function extractAllTargets(then: ThenSpec): string[] {
  const targets: string[] = [];

  if ('done' in then) {
    return [];
  }

  if ('pass' in then) {
    targets.push(then.pass);
    if (then.route) {
      for (const rule of then.route) {
        if (rule.target) targets.push(rule.target);
      }
    }
  }

  if ('scatter' in then) {
    targets.push(then.scatter);
    if (then.route) {
      for (const rule of then.route) {
        if (rule.target) targets.push(rule.target);
      }
    }
  }

  if ('gather' in then) {
    targets.push(then.gather);
    if (then.route) {
      for (const rule of then.route) {
        if (rule.target) targets.push(rule.target);
      }
    }
  }

  return targets;
}

/**
 * Find all IDs reachable from entry
 */
function findReachableIds(
  entry: string,
  flow: Record<string, FlowStep>
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const step = flow[current];
    if (!step || !step.then) continue;

    const targets = extractAllTargets(step.then);
    for (const target of targets) {
      if (!reachable.has(target) && flow[target]) {
        queue.push(target);
      }
    }
  }

  return reachable;
}
```

### `src/validation/validate-runtime.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type { KladosEntity, RhizaEntity, RhizaProperties, FlowStep, ThenSpec } from '../types';

export interface RuntimeValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  kladoi: Map<string, KladosEntity>;
  rhizai: Map<string, RhizaEntity>;
}

export interface ValidationError {
  code: string;
  message: string;
  klados_id?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  klados_id?: string;
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
  client: ArkeClient,
  properties: RhizaProperties
): Promise<RuntimeValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
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
  client: ArkeClient,
  targetId: string,
  errors: ValidationError[]
): Promise<{ type: 'klados' | 'rhiza'; entity: KladosEntity | RhizaEntity } | null> {
  // Try as klados first
  try {
    const { data: klados } = await client.api.GET('/kladoi/{id}', {
      params: { path: { id: targetId } },
    });

    if (klados) {
      if (klados.properties.status !== 'active') {
        errors.push({
          code: 'KLADOS_NOT_ACTIVE',
          message: `Klados '${targetId}' is not active (status: ${klados.properties.status})`,
          klados_id: targetId,
        });
      }
      return { type: 'klados', entity: klados as KladosEntity };
    }
  } catch {
    // Not a klados, try as rhiza
  }

  // Try as rhiza
  try {
    const { data: rhiza } = await client.api.GET('/rhizai/{id}', {
      params: { path: { id: targetId } },
    });

    if (rhiza) {
      if (rhiza.properties.status !== 'active') {
        errors.push({
          code: 'RHIZA_NOT_ACTIVE',
          message: `Rhiza '${targetId}' is not active (status: ${rhiza.properties.status})`,
        });
      }
      return { type: 'rhiza', entity: rhiza as RhizaEntity };
    }
  } catch {
    // Not a rhiza either
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
  errors: ValidationError[],
  warnings: ValidationWarning[]
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
  warnings: ValidationWarning[]
): void {
  if (accepted.includes('*')) return;

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

  return false;
}
```

### `src/validation/index.ts`

```typescript
export { validateKladosProperties } from './validate-klados';
export { validateRhizaProperties } from './validate-rhiza';
export { validateRhizaRuntime } from './validate-runtime';

export type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './validate-rhiza';

export type { RuntimeValidationResult } from './validate-runtime';
```

---

## Usage Example

```typescript
import {
  validateKladosProperties,
  validateRhizaProperties,
  validateRhizaRuntime,
} from '@arke-institute/rhiza';

// Static validation (at creation time)
const kladosResult = validateKladosProperties({
  label: 'OCR Service',
  endpoint: 'https://ocr.arke.institute',
  actions_required: ['file:view', 'entity:update'],
  accepts: { types: ['file/jpeg'], cardinality: 'one' },
  produces: { types: ['text/ocr'], cardinality: 'one' },
});

if (!kladosResult.valid) {
  console.error('Klados validation errors:', kladosResult.errors);
}

// Static rhiza validation
const rhizaResult = validateRhizaProperties({
  label: 'OCR Pipeline',
  version: '1.0',
  entry: 'II01klados_ocr...',
  flow: {
    'II01klados_ocr...': { then: { pass: 'II01klados_text...' } },
    'II01klados_text...': { then: { done: true } },
  },
});

if (!rhizaResult.valid) {
  console.error('Rhiza validation errors:', rhizaResult.errors);
}

// Example with routes (conditional routing)
const routedRhizaResult = validateRhizaProperties({
  label: 'Image Pipeline',
  version: '1.0',
  entry: 'II01klados_classify...',
  flow: {
    'II01klados_classify...': {
      then: {
        pass: 'II01klados_default...',
        route: [
          {
            where: { property: 'file_type', equals: 'image/jpeg' },
            target: 'II01klados_jpeg...',
          },
          {
            where: {
              or: [
                { property: 'file_type', equals: 'image/png' },
                { property: 'file_type', equals: 'image/webp' },
              ],
            },
            target: 'II01klados_convert...',
          },
        ],
      },
    },
    'II01klados_jpeg...': { then: { done: true } },
    'II01klados_convert...': { then: { pass: 'II01klados_jpeg...' } },
    'II01klados_default...': { then: { done: true } },
  },
});

// Runtime validation (at invoke time)
const runtimeResult = await validateRhizaRuntime(client, rhizaProperties);

if (!runtimeResult.valid) {
  console.error('Runtime validation errors:', runtimeResult.errors);
} else {
  // runtimeResult.kladoi contains all loaded klados entities
  // runtimeResult.rhizai contains any rhiza targets (sub-workflows)
  console.log('Loaded kladoi:', runtimeResult.kladoi.size);
  console.log('Loaded rhizai:', runtimeResult.rhizai.size);
}
```
