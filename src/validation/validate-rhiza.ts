/**
 * Rhiza Validation
 *
 * Validates rhiza entity properties at creation/update time (static validation).
 * This ensures rhiza definitions are structurally correct.
 */

import type { RhizaProperties, FlowStep, ThenSpec, RouteRule, WhereCondition } from '../types';
import type { ValidationResult, ValidationError, ValidationWarning } from './validate-klados';

/**
 * Validate rhiza properties (static validation)
 *
 * Checks:
 * - entry: Required, must be in flow
 * - flow: Required, non-empty
 * - All targets in flow must exist
 * - All paths must terminate (done: true or external rhiza)
 * - No cycles allowed
 * - Route rules must have where and target
 */
export function validateRhizaProperties(
  properties: Partial<RhizaProperties> | null | undefined
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Handle null/undefined input
  if (!properties) {
    errors.push({
      code: 'MISSING_ENTRY',
      message: 'Rhiza must have an entry klados ID',
      field: 'entry',
    });
    errors.push({
      code: 'EMPTY_FLOW',
      message: 'Rhiza must have at least one flow step',
      field: 'flow',
    });
    return { valid: false, errors, warnings };
  }

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
  _flow: Record<string, FlowStep>,
  errors: ValidationError[],
  _warnings: ValidationWarning[]
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

// Extend ValidationWarning to include klados_id
declare module './validate-klados' {
  interface ValidationWarning {
    klados_id?: string;
  }
  interface ValidationError {
    klados_id?: string;
  }
}
