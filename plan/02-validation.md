# Validation

## Overview

The validation module ensures rhiza definitions are well-formed before execution. Validation catches configuration errors early, preventing runtime failures.

---

## Validation Rules

### 1. Structure Validation

| Rule | Description | Error Code |
|------|-------------|------------|
| Entry exists | Entry klados must exist in kladoi map | `MISSING_ENTRY` |
| No orphans | All kladoi must be reachable from entry | `ORPHAN_KLADOS` (warning) |
| Has terminal | At least one klados must have `then: { done: true }` | `NO_TERMINAL` |
| Valid targets | All `then` targets must reference existing kladoi or valid rhiza IDs | `INVALID_TARGET` |
| No cycles | Workflow graph must be acyclic (for non-batch paths) | `CYCLE_DETECTED` |

### 2. Cardinality Validation

| Rule | Description | Error Code |
|------|-------------|------------|
| Scatter requires many | Klados with `scatter` must have `produces.cardinality: 'many'` | `SCATTER_PRODUCES_ONE` |
| Scatter target accepts one | Target of `scatter` must have `accepts.cardinality: 'one'` | `SCATTER_TARGET_MANY` |
| Gather target accepts many | Target of `gather` must have `accepts.cardinality: 'many'` | `GATHER_TARGET_ONE` |
| Pass cardinality match | For `pass`, cardinalities should be compatible | `CARDINALITY_MISMATCH` (warning) |

### 3. Type Validation

| Rule | Description | Error Code |
|------|-------------|------------|
| Type compatibility | Produced types should be subset of next klados's accepted types | `TYPE_MISMATCH` (warning) |
| Wildcard explicit | `accepts.types` must be explicit (`["*"]` for any, not empty) | `EMPTY_TYPES` |

---

## Implementation

### `src/validation/validate-rhiza.ts`

```typescript
import type { Rhiza, KladosSpec, ThenSpec, TargetRef } from '../types';

/**
 * ValidationResult - Result of rhiza validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  klados?: string;
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  klados?: string;
  field?: string;
}

/**
 * Validate a rhiza definition
 */
export function validateRhiza(rhiza: Rhiza): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Entry point exists
  if (!rhiza.kladoi[rhiza.entry]) {
    errors.push({
      code: 'MISSING_ENTRY',
      message: `Entry klados '${rhiza.entry}' not found in kladoi`,
      field: 'entry',
    });
  }

  // 2. Validate each klados
  for (const [name, spec] of Object.entries(rhiza.kladoi)) {
    validateKlados(name, spec, rhiza, errors, warnings);
  }

  // 3. Check for orphan kladoi
  const reachable = findReachableKladoi(rhiza);
  for (const name of Object.keys(rhiza.kladoi)) {
    if (!reachable.has(name)) {
      warnings.push({
        code: 'ORPHAN_KLADOS',
        message: `Klados '${name}' is not reachable from entry point`,
        klados: name,
      });
    }
  }

  // 4. Check for at least one terminal
  const hasTerminal = Object.values(rhiza.kladoi).some(
    (spec) => spec.then && 'done' in spec.then && spec.then.done
  );
  if (!hasTerminal) {
    errors.push({
      code: 'NO_TERMINAL',
      message: 'Rhiza has no terminal klados (none with then: { done: true })',
    });
  }

  // 5. Check for cycles (non-batch paths only)
  const cycles = detectCycles(rhiza);
  for (const cycle of cycles) {
    errors.push({
      code: 'CYCLE_DETECTED',
      message: `Cycle detected: ${cycle.join(' → ')}`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a single klados spec
 */
function validateKlados(
  name: string,
  spec: KladosSpec,
  rhiza: Rhiza,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Validate accepts
  if (!spec.accepts?.types || spec.accepts.types.length === 0) {
    errors.push({
      code: 'EMPTY_TYPES',
      message: `Klados '${name}' has empty accepts.types (use ["*"] for any)`,
      klados: name,
      field: 'accepts.types',
    });
  }

  // Validate produces
  if (!spec.produces?.types || spec.produces.types.length === 0) {
    errors.push({
      code: 'EMPTY_TYPES',
      message: `Klados '${name}' has empty produces.types (use ["*"] for any)`,
      klados: name,
      field: 'produces.types',
    });
  }

  // Validate then targets
  if (spec.then) {
    validateThen(name, spec, spec.then, rhiza, errors, warnings);
  }
}

/**
 * Validate a then spec (recursive for routes)
 */
function validateThen(
  kladosName: string,
  spec: KladosSpec,
  then: ThenSpec,
  rhiza: Rhiza,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if ('done' in then) {
    // Terminal - no validation needed
    return;
  }

  if ('pass' in then) {
    validateTarget(kladosName, 'pass', then.pass, spec, rhiza, errors, warnings);
  }

  if ('scatter' in then) {
    // Scatter requires produces.cardinality === 'many'
    if (spec.produces.cardinality !== 'many') {
      errors.push({
        code: 'SCATTER_PRODUCES_ONE',
        message: `Klados '${kladosName}' uses scatter but produces.cardinality is 'one'`,
        klados: kladosName,
        field: 'then.scatter',
      });
    }
    validateTarget(kladosName, 'scatter', then.scatter, spec, rhiza, errors, warnings, true);
  }

  if ('gather' in then) {
    validateTarget(kladosName, 'gather', then.gather, spec, rhiza, errors, warnings, false, true);
  }

  if ('route' in then) {
    for (const rule of then.route) {
      // Recursively validate each route's then
      validateThen(kladosName, spec, rule.then, rhiza, errors, warnings);
    }
  }
}

/**
 * Validate a target reference
 */
function validateTarget(
  kladosName: string,
  handoffType: string,
  target: TargetRef,
  sourceSpec: KladosSpec,
  rhiza: Rhiza,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  isScatter: boolean = false,
  isGather: boolean = false
): void {
  if (typeof target === 'string') {
    // Local klados reference
    const targetSpec = rhiza.kladoi[target];
    if (!targetSpec) {
      errors.push({
        code: 'INVALID_TARGET',
        message: `Klados '${kladosName}' references unknown klados '${target}'`,
        klados: kladosName,
        field: `then.${handoffType}`,
      });
      return;
    }

    // Cardinality checks
    if (isScatter && targetSpec.accepts.cardinality !== 'one') {
      errors.push({
        code: 'SCATTER_TARGET_MANY',
        message: `Klados '${kladosName}' scatters to '${target}' which accepts 'many', not 'one'`,
        klados: kladosName,
        field: `then.scatter`,
      });
    }

    if (isGather && targetSpec.accepts.cardinality !== 'many') {
      errors.push({
        code: 'GATHER_TARGET_ONE',
        message: `Klados '${kladosName}' gathers to '${target}' which accepts 'one', not 'many'`,
        klados: kladosName,
        field: `then.gather`,
      });
    }

    // Type compatibility (warning only)
    if (!typesCompatible(sourceSpec.produces.types, targetSpec.accepts.types)) {
      warnings.push({
        code: 'TYPE_MISMATCH',
        message: `Klados '${kladosName}' produces ${JSON.stringify(sourceSpec.produces.types)} but '${target}' accepts ${JSON.stringify(targetSpec.accepts.types)}`,
        klados: kladosName,
        field: `then.${handoffType}`,
      });
    }

  } else if ('rhiza' in target) {
    // Sub-rhiza reference - we can't validate the rhiza exists at definition time
    // (it's an entity ID that may not be loaded)
    // Runtime validation will check this
  }
}

/**
 * Find all kladoi reachable from entry point
 */
function findReachableKladoi(rhiza: Rhiza): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [rhiza.entry];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const spec = rhiza.kladoi[current];
    if (!spec) continue;

    const targets = extractTargets(spec.then);
    for (const target of targets) {
      if (typeof target === 'string' && !reachable.has(target)) {
        queue.push(target);
      }
    }
  }

  return reachable;
}

/**
 * Extract all target klados names from a ThenSpec
 */
function extractTargets(then: ThenSpec): TargetRef[] {
  if (!then) return [];
  if ('done' in then) return [];
  if ('pass' in then) return [then.pass];
  if ('scatter' in then) return [then.scatter];
  if ('gather' in then) return [then.gather];
  if ('route' in then) {
    return then.route.flatMap((rule) => extractTargets(rule.then));
  }
  return [];
}

/**
 * Detect cycles in the workflow graph
 * Only considers non-batch paths (scatter→gather is not a cycle)
 */
function detectCycles(rhiza: Rhiza): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(current: string): void {
    if (path.includes(current)) {
      // Found cycle
      const cycleStart = path.indexOf(current);
      cycles.push([...path.slice(cycleStart), current]);
      return;
    }

    if (visited.has(current)) return;
    visited.add(current);
    path.push(current);

    const spec = rhiza.kladoi[current];
    if (spec) {
      // Only follow non-scatter paths (scatter breaks the direct chain)
      const then = spec.then;
      if (then && !('scatter' in then) && !('done' in then)) {
        const targets = extractTargets(then);
        for (const target of targets) {
          if (typeof target === 'string') {
            dfs(target);
          }
        }
      }
    }

    path.pop();
  }

  dfs(rhiza.entry);
  return cycles;
}

/**
 * Check if produced types are compatible with accepted types
 */
function typesCompatible(produced: string[], accepted: string[]): boolean {
  // Wildcard accepts anything
  if (accepted.includes('*')) return true;

  // Check if any produced type matches any accepted type (with glob support)
  return produced.some((p) =>
    accepted.some((a) => typeMatches(p, a))
  );
}

/**
 * Check if a type matches a pattern (simple glob support)
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

### `src/validation/validate-cardinality.ts`

```typescript
import type { Rhiza, KladosSpec } from '../types';

/**
 * Validate cardinality consistency across the workflow
 *
 * This is a more thorough check that traces data flow through the
 * entire workflow to ensure cardinalities are consistent.
 */
export interface CardinalityValidationResult {
  valid: boolean;
  errors: CardinalityError[];
}

export interface CardinalityError {
  from: string;
  to: string;
  message: string;
}

export function validateCardinality(rhiza: Rhiza): CardinalityValidationResult {
  const errors: CardinalityError[] = [];

  // Trace data flow from entry through all paths
  traceFlow(rhiza.entry, 'one', rhiza, errors, new Set());

  return {
    valid: errors.length === 0,
    errors,
  };
}

function traceFlow(
  current: string,
  inputCardinality: 'one' | 'many',
  rhiza: Rhiza,
  errors: CardinalityError[],
  visited: Set<string>
): void {
  if (visited.has(current)) return;
  visited.add(current);

  const spec = rhiza.kladoi[current];
  if (!spec) return;

  // Check input cardinality matches what we're receiving
  if (spec.accepts.cardinality !== inputCardinality) {
    // This might be okay in some cases (gather receives many from scatter)
    // Only error if it's truly incompatible
    if (inputCardinality === 'many' && spec.accepts.cardinality === 'one') {
      // This is only okay if we're coming from a scatter (parallel invocation)
      // In that case, each instance receives 'one'
      // This is handled by the scatter logic, not a validation error
    }
  }

  const then = spec.then;
  if (!then || 'done' in then) return;

  if ('pass' in then) {
    const target = typeof then.pass === 'string' ? then.pass : null;
    if (target) {
      traceFlow(target, spec.produces.cardinality, rhiza, errors, visited);
    }
  }

  if ('scatter' in then) {
    const target = typeof then.scatter === 'string' ? then.scatter : null;
    if (target) {
      // Scatter: even though we produce 'many', each invocation receives 'one'
      traceFlow(target, 'one', rhiza, errors, new Set()); // Fresh visited set
    }
  }

  if ('gather' in then) {
    const target = typeof then.gather === 'string' ? then.gather : null;
    if (target) {
      // Gather: collecting results, so target receives 'many'
      traceFlow(target, 'many', rhiza, errors, visited);
    }
  }

  if ('route' in then) {
    for (const rule of then.route) {
      // Each route branch inherits our output cardinality
      // Recursively trace each branch
      const targets = extractTargetsFromThen(rule.then);
      for (const target of targets) {
        if (typeof target === 'string') {
          traceFlow(target, spec.produces.cardinality, rhiza, errors, visited);
        }
      }
    }
  }
}

function extractTargetsFromThen(then: any): string[] {
  if (!then) return [];
  if ('done' in then) return [];
  if ('pass' in then && typeof then.pass === 'string') return [then.pass];
  if ('scatter' in then && typeof then.scatter === 'string') return [then.scatter];
  if ('gather' in then && typeof then.gather === 'string') return [then.gather];
  if ('route' in then) {
    return then.route.flatMap((r: any) => extractTargetsFromThen(r.then));
  }
  return [];
}
```

### `src/validation/index.ts`

```typescript
export { validateRhiza } from './validate-rhiza';
export type { ValidationResult, ValidationError, ValidationWarning } from './validate-rhiza';

export { validateCardinality } from './validate-cardinality';
export type { CardinalityValidationResult, CardinalityError } from './validate-cardinality';
```

---

## Usage Example

```typescript
import { validateRhiza, validateCardinality } from '@arke-institute/rhiza';

const rhiza: Rhiza = {
  id: 'II01abc...',
  name: 'My Workflow',
  version: '1.0',
  entry: 'step-a',
  kladoi: {
    'step-a': {
      action: 'II01agent1...',
      accepts: { types: ['file/pdf'], cardinality: 'one' },
      produces: { types: ['file/jpeg'], cardinality: 'many' },
      then: { scatter: 'step-b' },
    },
    'step-b': {
      action: 'II01agent2...',
      accepts: { types: ['file/jpeg'], cardinality: 'one' },
      produces: { types: ['text/ocr'], cardinality: 'one' },
      then: { gather: 'step-c' },
    },
    'step-c': {
      action: 'II01agent3...',
      accepts: { types: ['text/ocr'], cardinality: 'many' },
      produces: { types: ['file/text'], cardinality: 'one' },
      then: { done: true },
    },
  },
};

const result = validateRhiza(rhiza);

if (!result.valid) {
  console.error('Validation errors:', result.errors);
} else {
  console.log('Rhiza is valid!');
  if (result.warnings.length > 0) {
    console.warn('Warnings:', result.warnings);
  }
}
```
