/**
 * Rhiza Validation
 *
 * Validates rhiza entity properties at creation/update time (static validation).
 * This ensures rhiza definitions are structurally correct.
 */

import type { RhizaProperties, FlowStep, ThenSpec, RouteRule, WhereCondition, EntityRef } from '../types';
import { isEntityRef } from '../types';
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

  // Entry required and must be valid EntityRef
  if (!properties.entry) {
    errors.push({
      code: 'MISSING_ENTRY',
      message: 'Rhiza must have an entry klados reference',
      field: 'entry',
    });
  } else if (!isEntityRef(properties.entry)) {
    errors.push({
      code: 'INVALID_ENTRY',
      message: 'Rhiza entry must be an EntityRef with a pi field',
      field: 'entry',
    });
  } else if (!properties.entry.pi) {
    errors.push({
      code: 'MISSING_ENTRY',
      message: 'Rhiza entry reference must have a non-empty pi field',
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

  // Entry must be in flow (extract pi from EntityRef)
  const entryId = isEntityRef(properties.entry) ? properties.entry.pi : null;
  if (entryId && !properties.flow[entryId]) {
    errors.push({
      code: 'ENTRY_NOT_IN_FLOW',
      message: `Entry klados '${entryId}' is not in flow`,
      field: 'entry',
    });
  }

  // Validate each flow step
  for (const [kladosId, step] of Object.entries(properties.flow)) {
    validateFlowStep(kladosId, step, properties.flow, errors, warnings);
  }

  // Check all paths terminate (also detects cycles)
  if (entryId && properties.flow[entryId]) {
    const terminationResult = validateAllPathsTerminate(
      entryId,
      properties.flow
    );
    errors.push(...terminationResult.errors);
  }

  // Check for unreachable kladoi
  if (entryId && properties.flow[entryId]) {
    const reachable = findReachableIds(entryId, properties.flow);
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
    } else if (!isEntityRef(rule.target)) {
      errors.push({
        code: 'INVALID_TARGET',
        message: `Route rule ${i} target in '${kladosId}' must be an EntityRef with a pi field`,
        klados_id: kladosId,
      });
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
  target: EntityRef,
  flow: Record<string, FlowStep>,
  errors: ValidationError[]
): void {
  if (!target || !isEntityRef(target)) {
    errors.push({
      code: 'INVALID_TARGET',
      message: `Invalid target in '${sourceKladosId}' ${handoffType}: must be an EntityRef with a pi field`,
      klados_id: sourceKladosId,
      field: `then.${handoffType}`,
    });
    return;
  }

  const targetId = target.pi;

  // Target must be in flow (for static validation)
  // At runtime, targets not in flow are resolved as rhiza IDs
  if (!flow[targetId]) {
    errors.push({
      code: 'INVALID_TARGET',
      message: `Target '${targetId}' in '${sourceKladosId}' is not in flow`,
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
 * Returns the pi (ID) strings from EntityRefs
 */
function extractAllTargets(then: ThenSpec): string[] {
  const targets: string[] = [];

  if ('done' in then) {
    return [];
  }

  if ('pass' in then) {
    if (isEntityRef(then.pass)) targets.push(then.pass.pi);
    if (then.route) {
      for (const rule of then.route) {
        if (isEntityRef(rule.target)) targets.push(rule.target.pi);
      }
    }
  }

  if ('scatter' in then) {
    if (isEntityRef(then.scatter)) targets.push(then.scatter.pi);
    if (then.route) {
      for (const rule of then.route) {
        if (isEntityRef(rule.target)) targets.push(rule.target.pi);
      }
    }
  }

  if ('gather' in then) {
    if (isEntityRef(then.gather)) targets.push(then.gather.pi);
    if (then.route) {
      for (const rule of then.route) {
        if (isEntityRef(rule.target)) targets.push(rule.target.pi);
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
