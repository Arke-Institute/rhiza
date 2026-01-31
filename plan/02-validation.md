# Validation

## Overview

The validation module ensures rhiza and klados definitions are well-formed before execution. Validation catches configuration errors early, preventing runtime failures.

Since kladoi are now first-class entities, validation happens at two levels:
1. **Static validation** - At definition time (rhiza flow structure)
2. **Runtime validation** - At invoke time (klados compatibility)

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
| Entry exists | Entry must be a valid klados ID in `flow` | `MISSING_ENTRY` |
| Flow references entry | `flow` must include the `entry` klados | `ENTRY_NOT_IN_FLOW` |
| Valid targets | All `then` targets must be valid klados IDs or rhiza IDs | `INVALID_TARGET` |
| Has terminal | At least one flow step must have `then: { done: true }` | `NO_TERMINAL` |
| No unreachable | All kladoi in flow must be reachable from entry | `UNREACHABLE_KLADOS` (warning) |
| No cycles | Flow graph must be acyclic (for non-batch paths) | `CYCLE_DETECTED` |

### Flow Syntax Validation

| Rule | Description | Error Code |
|------|-------------|------------|
| Valid handoff type | `then` must be: done, pass, scatter, gather, route, or rhiza | `INVALID_HANDOFF` |
| Route has rules | `route` must have at least one rule | `EMPTY_ROUTE` |
| Route rules valid | Each rule must have `where` and `then` | `INVALID_ROUTE_RULE` |

---

## Runtime Validation (At Invoke Time)

When invoking a rhiza, the API validates:

### Klados Existence

All klados IDs in the flow must exist and be accessible.

| Rule | Description | Error Code |
|------|-------------|------------|
| Entry exists | Entry klados entity must exist | `ENTRY_KLADOS_NOT_FOUND` |
| All exist | All kladoi referenced in flow must exist | `KLADOS_NOT_FOUND` |
| All active | All kladoi must have `status: 'active'` | `KLADOS_NOT_ACTIVE` |

### Cardinality Compatibility

| Rule | Description | Error Code |
|------|-------------|------------|
| Scatter produces many | Klados before `scatter` must have `produces.cardinality: 'many'` | `SCATTER_PRODUCES_ONE` |
| Scatter target accepts one | Target of `scatter` must have `accepts.cardinality: 'one'` | `SCATTER_TARGET_MANY` |
| Gather target accepts many | Target of `gather` must have `accepts.cardinality: 'many'` | `GATHER_TARGET_ONE` |
| Pass compatible | For `pass`, cardinalities should match (warning) | `CARDINALITY_MISMATCH` |

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
import type { RhizaEntity, RhizaProperties, FlowStep, ThenSpec } from '../types';

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
 * It does NOT validate that kladoi actually exist (that's runtime).
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

  // Check for at least one terminal
  const hasTerminal = Object.values(properties.flow).some(
    (step) => step.then && 'done' in step.then && step.then.done
  );
  if (!hasTerminal) {
    errors.push({
      code: 'NO_TERMINAL',
      message: 'Rhiza must have at least one terminal step (then: { done: true })',
    });
  }

  // Check for unreachable kladoi
  if (properties.entry && properties.flow[properties.entry]) {
    const reachable = findReachableKladoi(properties.entry, properties.flow);
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

  // Check for cycles
  if (properties.entry) {
    const cycles = detectCycles(properties.entry, properties.flow);
    for (const cycle of cycles) {
      errors.push({
        code: 'CYCLE_DETECTED',
        message: `Cycle detected: ${cycle.join(' → ')}`,
      });
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
 * Validate a then spec (recursive for routes)
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
    return;
  }

  if ('scatter' in then) {
    validateTarget(kladosId, 'scatter', then.scatter, flow, errors);
    return;
  }

  if ('gather' in then) {
    validateTarget(kladosId, 'gather', then.gather, flow, errors);
    return;
  }

  if ('rhiza' in then) {
    // Sub-rhiza reference - valid ID format check only
    if (!then.rhiza || typeof then.rhiza !== 'string') {
      errors.push({
        code: 'INVALID_RHIZA_REF',
        message: `Invalid rhiza reference in '${kladosId}'`,
        klados_id: kladosId,
      });
    }
    return;
  }

  if ('route' in then) {
    if (!then.route || then.route.length === 0) {
      errors.push({
        code: 'EMPTY_ROUTE',
        message: `Route in '${kladosId}' has no rules`,
        klados_id: kladosId,
      });
      return;
    }

    for (const rule of then.route) {
      if (!rule.where || !rule.then) {
        errors.push({
          code: 'INVALID_ROUTE_RULE',
          message: `Route rule in '${kladosId}' is missing 'where' or 'then'`,
          klados_id: kladosId,
        });
        continue;
      }
      // Recursively validate the rule's then
      validateThen(kladosId, rule.then, flow, errors, warnings);
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
 * Validate a target reference
 *
 * Note: This only validates that the target is in the flow.
 * It does NOT validate that the klados entity actually exists.
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

  // Target must be in flow (it's a klados ID)
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
 * Find all kladoi reachable from entry
 */
function findReachableKladoi(
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
    if (!step) continue;

    const targets = extractTargets(step.then);
    for (const target of targets) {
      if (!reachable.has(target)) {
        queue.push(target);
      }
    }
  }

  return reachable;
}

/**
 * Extract all target klados IDs from a ThenSpec
 */
function extractTargets(then: ThenSpec): string[] {
  if (!then) return [];
  if ('done' in then) return [];
  if ('pass' in then) return [then.pass];
  if ('scatter' in then) return [then.scatter];
  if ('gather' in then) return [then.gather];
  if ('rhiza' in then) return []; // Sub-rhiza, not a local target
  if ('route' in then) {
    return then.route.flatMap((rule) => extractTargets(rule.then));
  }
  return [];
}

/**
 * Detect cycles in the flow graph
 * Only considers non-scatter paths (scatter→gather is not a cycle)
 */
function detectCycles(
  entry: string,
  flow: Record<string, FlowStep>
): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(current: string): void {
    if (path.includes(current)) {
      const cycleStart = path.indexOf(current);
      cycles.push([...path.slice(cycleStart), current]);
      return;
    }

    if (visited.has(current)) return;
    visited.add(current);
    path.push(current);

    const step = flow[current];
    if (step?.then && !('scatter' in step.then) && !('done' in step.then)) {
      const targets = extractTargets(step.then);
      for (const target of targets) {
        dfs(target);
      }
    }

    path.pop();
  }

  dfs(entry);
  return cycles;
}
```

### `src/validation/validate-runtime.ts`

```typescript
import type { ArkeClient } from '@arke-institute/sdk';
import type { KladosEntity, RhizaProperties, FlowStep, ThenSpec } from '../types';

export interface RuntimeValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  kladoi: Map<string, KladosEntity>;
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
 * This loads all kladoi and validates:
 * 1. All kladoi exist and are active
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

  // Collect all klados IDs from flow
  const kladosIds = new Set<string>(Object.keys(properties.flow));

  // Load all kladoi
  for (const kladosId of kladosIds) {
    try {
      const { data: klados } = await client.api.GET('/kladoi/{id}', {
        params: { path: { id: kladosId } },
      });

      if (!klados) {
        errors.push({
          code: 'KLADOS_NOT_FOUND',
          message: `Klados '${kladosId}' not found`,
          klados_id: kladosId,
        });
        continue;
      }

      if (klados.properties.status !== 'active') {
        errors.push({
          code: 'KLADOS_NOT_ACTIVE',
          message: `Klados '${kladosId}' is not active (status: ${klados.properties.status})`,
          klados_id: kladosId,
        });
      }

      kladoi.set(kladosId, klados as KladosEntity);
    } catch (e) {
      errors.push({
        code: 'KLADOS_NOT_FOUND',
        message: `Failed to load klados '${kladosId}': ${e instanceof Error ? e.message : 'Unknown error'}`,
        klados_id: kladosId,
      });
    }
  }

  // Skip cardinality/type validation if we're missing kladoi
  if (errors.length > 0) {
    return { valid: false, errors, warnings, kladoi };
  }

  // Validate cardinality compatibility
  for (const [kladosId, step] of Object.entries(properties.flow)) {
    validateCardinalityRuntime(kladosId, step.then, kladoi, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    kladoi,
  };
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
  if (!then || 'done' in then || 'rhiza' in then) {
    return;
  }

  const sourceKlados = kladoi.get(kladosId);
  if (!sourceKlados) return;

  const sourceProduces = sourceKlados.properties.produces;

  if ('scatter' in then) {
    // Scatter requires produces.cardinality === 'many'
    if (sourceProduces.cardinality !== 'many') {
      errors.push({
        code: 'SCATTER_PRODUCES_ONE',
        message: `Klados '${kladosId}' uses scatter but produces.cardinality is 'one'`,
        klados_id: kladosId,
      });
    }

    // Scatter target must accept 'one'
    const targetKlados = kladoi.get(then.scatter);
    if (targetKlados && targetKlados.properties.accepts.cardinality !== 'one') {
      errors.push({
        code: 'SCATTER_TARGET_MANY',
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
    // Gather target must accept 'many'
    const targetKlados = kladoi.get(then.gather);
    if (targetKlados && targetKlados.properties.accepts.cardinality !== 'many') {
      errors.push({
        code: 'GATHER_TARGET_ONE',
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

  if ('route' in then) {
    for (const rule of then.route) {
      validateCardinalityRuntime(kladosId, rule.then, kladoi, errors, warnings);
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

// Runtime validation (at invoke time)
const runtimeResult = await validateRhizaRuntime(client, rhizaProperties);

if (!runtimeResult.valid) {
  console.error('Runtime validation errors:', runtimeResult.errors);
} else {
  // runtimeResult.kladoi contains all loaded klados entities
  console.log('Loaded kladoi:', runtimeResult.kladoi.size);
}
```
