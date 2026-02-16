/**
 * Rhiza Validation
 *
 * Validates rhiza entity properties at creation/update time (static validation).
 * This ensures rhiza definitions are structurally correct.
 *
 * NOTE: Uses step-based flow format where:
 * - entry is a step name (string)
 * - flow keys are step names
 * - each step has { klados: EntityRef, then: ThenSpec }
 * - ThenSpec targets are step names (strings)
 */

import type { RhizaProperties, FlowStep, ThenSpec, RouteRule, WhereCondition } from '../types';
import { isEntityRef } from '../types';
import type { ValidationResult, ValidationError, ValidationWarning } from './validate-klados';

/**
 * Validate rhiza properties (static validation)
 *
 * Checks:
 * - entry: Required, must be in flow (step name)
 * - flow: Required, non-empty
 * - Each step must have klados field
 * - All targets in flow must exist (step names)
 * - All paths must terminate (done: true)
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
      message: 'Rhiza must have an entry step name',
      field: 'entry',
    });
    errors.push({
      code: 'EMPTY_FLOW',
      message: 'Rhiza must have at least one flow step',
      field: 'flow',
    });
    return { valid: false, errors, warnings };
  }

  // Entry required and must be a non-empty string (step name)
  if (!properties.entry || typeof properties.entry !== 'string') {
    errors.push({
      code: 'MISSING_ENTRY',
      message: 'Rhiza must have an entry step name',
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
  const entryStepName = properties.entry;
  if (entryStepName && typeof entryStepName === 'string' && !properties.flow[entryStepName]) {
    errors.push({
      code: 'ENTRY_NOT_IN_FLOW',
      message: `Entry step '${entryStepName}' is not in flow`,
      field: 'entry',
    });
  }

  // Validate each flow step
  for (const [stepName, step] of Object.entries(properties.flow)) {
    validateFlowStep(stepName, step, properties.flow, errors, warnings);
  }

  // Check all paths terminate (also detects cycles)
  if (entryStepName && typeof entryStepName === 'string' && properties.flow[entryStepName]) {
    const terminationResult = validateAllPathsTerminate(
      entryStepName,
      properties.flow
    );
    errors.push(...terminationResult.errors);
  }

  // Check for unreachable steps
  if (entryStepName && typeof entryStepName === 'string' && properties.flow[entryStepName]) {
    const reachable = findReachableSteps(entryStepName, properties.flow);
    for (const stepName of Object.keys(properties.flow)) {
      if (!reachable.has(stepName)) {
        warnings.push({
          code: 'UNREACHABLE_KLADOS',
          message: `Step '${stepName}' is not reachable from entry`,
          klados_id: stepName,
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
  stepName: string,
  step: FlowStep,
  flow: Record<string, FlowStep>,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Each step must have a klados field
  if (!step.klados || !isEntityRef(step.klados)) {
    errors.push({
      code: 'MISSING_KLADOS',
      message: `Flow step '${stepName}' is missing 'klados' field or has invalid format`,
      klados_id: stepName,
    });
  }

  if (!step.then) {
    errors.push({
      code: 'MISSING_THEN',
      message: `Flow step '${stepName}' is missing 'then' specification`,
      klados_id: stepName,
    });
    return;
  }

  validateThen(stepName, step.then, flow, errors, warnings);
}

/**
 * Validate a then spec
 */
function validateThen(
  stepName: string,
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
    validateTarget(stepName, 'pass', then.pass, flow, errors);
    if (then.route) {
      validateRouteRules(stepName, then.route, flow, errors, warnings);
    }
    return;
  }

  if ('scatter' in then) {
    validateTarget(stepName, 'scatter', then.scatter, flow, errors);
    if (then.route) {
      validateRouteRules(stepName, then.route, flow, errors, warnings);
    }
    return;
  }

  if ('gather' in then) {
    validateTarget(stepName, 'gather', then.gather, flow, errors);
    if (then.route) {
      validateRouteRules(stepName, then.route, flow, errors, warnings);
    }
    return;
  }

  if ('recurse' in then) {
    validateTarget(stepName, 'recurse', then.recurse, flow, errors);
    if (then.max_depth !== undefined) {
      if (typeof then.max_depth !== 'number' || then.max_depth < 1 || !Number.isInteger(then.max_depth)) {
        errors.push({
          code: 'INVALID_MAX_DEPTH',
          message: `max_depth in '${stepName}' must be a positive integer`,
          klados_id: stepName,
        });
      }
    }
    if (then.route) {
      validateRouteRules(stepName, then.route, flow, errors, warnings);
    }
    return;
  }

  errors.push({
    code: 'INVALID_HANDOFF',
    message: `Unknown handoff type in '${stepName}': ${JSON.stringify(then)}`,
    klados_id: stepName,
  });
}

/**
 * Validate route rules on a handoff
 */
function validateRouteRules(
  stepName: string,
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
        message: `Route rule ${i} in '${stepName}' is missing 'where' condition`,
        klados_id: stepName,
      });
    } else {
      validateWhereCondition(stepName, rule.where, i, errors);
    }

    if (!rule.target || typeof rule.target !== 'string') {
      errors.push({
        code: 'INVALID_ROUTE_RULE',
        message: `Route rule ${i} in '${stepName}' is missing 'target' or target is not a string`,
        klados_id: stepName,
      });
    }
  }
}

/**
 * Validate a where condition (recursive for AND/OR)
 */
function validateWhereCondition(
  stepName: string,
  where: WhereCondition,
  ruleIndex: number,
  errors: ValidationError[]
): void {
  if ('property' in where && 'equals' in where) {
    // WhereEquals - valid
    if (typeof where.property !== 'string') {
      errors.push({
        code: 'INVALID_WHERE_CONDITION',
        message: `Route rule ${ruleIndex} in '${stepName}': 'property' must be a string`,
        klados_id: stepName,
      });
    }
    return;
  }

  if ('and' in where) {
    // WhereAnd
    if (!Array.isArray(where.and) || where.and.length === 0) {
      errors.push({
        code: 'INVALID_WHERE_CONDITION',
        message: `Route rule ${ruleIndex} in '${stepName}': 'and' must be a non-empty array`,
        klados_id: stepName,
      });
      return;
    }
    for (const condition of where.and) {
      validateWhereCondition(stepName, condition, ruleIndex, errors);
    }
    return;
  }

  if ('or' in where) {
    // WhereOr
    if (!Array.isArray(where.or) || where.or.length === 0) {
      errors.push({
        code: 'INVALID_WHERE_CONDITION',
        message: `Route rule ${ruleIndex} in '${stepName}': 'or' must be a non-empty array`,
        klados_id: stepName,
      });
      return;
    }
    for (const condition of where.or) {
      validateWhereCondition(stepName, condition, ruleIndex, errors);
    }
    return;
  }

  errors.push({
    code: 'INVALID_WHERE_CONDITION',
    message: `Route rule ${ruleIndex} in '${stepName}': invalid where condition format`,
    klados_id: stepName,
  });
}

/**
 * Validate a target step name
 *
 * Target must be a string and exist in the flow.
 */
function validateTarget(
  sourceStepName: string,
  handoffType: string,
  target: string,
  flow: Record<string, FlowStep>,
  errors: ValidationError[]
): void {
  if (!target || typeof target !== 'string') {
    errors.push({
      code: 'INVALID_TARGET',
      message: `Invalid target in '${sourceStepName}' ${handoffType}: must be a step name string`,
      klados_id: sourceStepName,
      field: `then.${handoffType}`,
    });
    return;
  }

  // Target must be in flow
  if (!flow[target]) {
    errors.push({
      code: 'INVALID_TARGET',
      message: `Target step '${target}' in '${sourceStepName}' is not in flow`,
      klados_id: sourceStepName,
      field: `then.${handoffType}`,
    });
  }
}

/**
 * Validate all paths terminate
 *
 * Traverses all possible paths from entry and ensures each ends in:
 * - done: true (terminal)
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
      // Not in flow - this would be caught by target validation
      return;
    }

    const then = step.then;
    const newPath = [...path, current];

    if ('done' in then) {
      // Terminal - valid
      return;
    }

    if ('recurse' in then) {
      // Recurse is a valid termination - it's a bounded loop (max_depth)
      // We don't follow recurse edges for cycle detection
      return;
    }

    // Get all possible targets (including route alternatives)
    // Note: recurse targets are NOT included (handled above)
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
        // Target not in flow - would be caught by target validation
        continue;
      }
      traverse(target, newPath);
    }
  }

  traverse(entry, []);
  return { errors };
}

/**
 * Extract all possible target step names from a ThenSpec (including route alternatives)
 *
 * Note: "done" is a special route target that means the item is complete (no further handoff).
 * It's excluded from traversal targets since it represents termination.
 *
 * @param then - The ThenSpec to extract targets from
 * @param includeRecurse - Whether to include recurse targets (default: false)
 *   For cycle detection: false (recurse is bounded by max_depth, not a real cycle)
 *   For reachability: true (recurse targets are reachable steps)
 */
function extractAllTargets(then: ThenSpec, includeRecurse = false): string[] {
  const targets: string[] = [];

  if ('done' in then) {
    return [];
  }

  if ('pass' in then) {
    if (typeof then.pass === 'string') targets.push(then.pass);
    if (then.route) {
      for (const rule of then.route) {
        // "done" is a special route target meaning item is complete
        if (typeof rule.target === 'string' && rule.target !== 'done') {
          targets.push(rule.target);
        }
      }
    }
  }

  if ('scatter' in then) {
    if (typeof then.scatter === 'string') targets.push(then.scatter);
    if (then.route) {
      for (const rule of then.route) {
        if (typeof rule.target === 'string' && rule.target !== 'done') {
          targets.push(rule.target);
        }
      }
    }
  }

  if ('gather' in then) {
    if (typeof then.gather === 'string') targets.push(then.gather);
    if (then.route) {
      for (const rule of then.route) {
        if (typeof rule.target === 'string' && rule.target !== 'done') {
          targets.push(rule.target);
        }
      }
    }
  }

  if ('recurse' in then && includeRecurse) {
    // Only include recurse targets when explicitly requested (for reachability analysis)
    // For cycle detection, recurse is NOT included because it's bounded by max_depth
    if (typeof then.recurse === 'string') targets.push(then.recurse);
    if (then.route) {
      for (const rule of then.route) {
        if (typeof rule.target === 'string' && rule.target !== 'done') {
          targets.push(rule.target);
        }
      }
    }
  }

  return targets;
}

/**
 * Find all step names reachable from entry
 */
function findReachableSteps(
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

    // Include recurse targets for reachability analysis
    const targets = extractAllTargets(step.then, true);
    for (const target of targets) {
      if (!reachable.has(target) && flow[target]) {
        queue.push(target);
      }
    }
  }

  return reachable;
}

/**
 * Validate a partial rhiza update
 *
 * Merges the update with existing properties and validates the result.
 * This is used when updating an existing rhiza entity with partial changes.
 *
 * Only fields explicitly provided in the update (not undefined) are merged.
 * If neither entry nor flow is being updated, validation is skipped.
 *
 * @param update - The partial update to apply
 * @param existing - The existing rhiza properties
 * @returns Validation result for the merged properties
 */
export function validateRhizaUpdate(
  update: Partial<RhizaProperties>,
  existing: RhizaProperties
): ValidationResult {
  // If neither entry nor flow is being updated, skip structural validation
  if (update.entry === undefined && update.flow === undefined) {
    return { valid: true, errors: [], warnings: [] };
  }

  // Merge update with existing, using existing values as fallback
  const merged: Partial<RhizaProperties> = {
    ...existing,
    entry: update.entry ?? existing.entry,
    flow: update.flow ?? existing.flow,
  };

  // If flow is being updated, merge at flow level
  if (update.flow && existing.flow) {
    merged.flow = { ...existing.flow, ...update.flow };
  }

  return validateRhizaProperties(merged);
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
