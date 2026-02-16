import type { EntityRef } from './refs';

/**
 * RhizaEntity - A workflow entity
 *
 * Rhizai compose kladoi into executable workflows.
 * They define the flow (what klados invokes what next).
 */
export interface RhizaEntity {
  /** Unique identifier (Arke entity ID) */
  id: string;

  /** Entity type */
  type: 'rhiza';

  properties: RhizaProperties;

  relationships?: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
    peer_label?: string;
    properties?: Record<string, unknown>;
  }>;
}

export interface RhizaProperties {
  /** Human-readable name */
  label: string;

  /** Description of what this workflow does */
  description?: string;

  /** Semantic version */
  version: string;

  /** Entry point - step name that starts the workflow */
  entry: string;

  /** Flow definition - maps step names to their klados and handoff spec */
  flow: Record<string, FlowStep>;

  /** Status */
  status: 'development' | 'active' | 'disabled';

  /** Timestamps */
  created_at?: string;
  updated_at?: string;
}

/**
 * FlowStep - A step in the workflow
 *
 * Each step specifies which klados to invoke and what happens after it completes.
 * Step names (flow keys) can be arbitrary - the same klados can appear in multiple steps.
 */
export interface FlowStep {
  /** Which klados to invoke for this step */
  klados: EntityRef;

  /** Handoff specification - what happens after this step completes */
  then: ThenSpec;
}

/**
 * ThenSpec - Handoff specification
 *
 * Four core operations: pass, scatter, gather, recurse (+ done for terminal)
 * - Target is a step name (string) referring to another step in the flow
 * - Route conditions can override the default target based on output properties
 */
export type ThenSpec =
  | { done: true }                              // Terminal - workflow ends
  | { pass: string; route?: RouteRule[] }       // 1:1 - target step name
  | { scatter: string; route?: RouteRule[] }    // 1:N fan-out - target step name
  | { gather: string; route?: RouteRule[] }     // N:1 fan-in - target step name
  | { recurse: string; max_depth?: number; route?: RouteRule[] };  // Loop back - target step name (with depth limit)

/**
 * RouteRule - Conditional routing rule
 *
 * Routes are evaluated in order. First matching rule wins.
 * If no rule matches, the default target (pass/scatter/gather value) is used.
 */
export interface RouteRule {
  /** Condition to match (supports AND/OR logic) */
  where: WhereCondition;

  /** Target step name if condition matches (overrides default) */
  target: string;
}

/**
 * WhereCondition - Property-based matching with AND/OR logic
 *
 * Examples:
 * - Simple: { property: "type", equals: "File" }
 * - AND: { and: [{ property: "type", equals: "File" }, { property: "file_type", equals: "image/jpeg" }] }
 * - OR: { or: [{ property: "file_type", equals: "image/jpeg" }, { property: "file_type", equals: "image/png" }] }
 */
export type WhereCondition =
  | WhereEquals
  | WhereAnd
  | WhereOr;

export interface WhereEquals {
  /** Property name to check (e.g., "type", "content_type") */
  property: string;
  /** Value to match (null to check for absent/null properties) */
  equals: string | number | boolean | null;
}

export interface WhereAnd {
  /** All conditions must match */
  and: WhereCondition[];
}

export interface WhereOr {
  /** Any condition must match */
  or: WhereCondition[];
}

/**
 * OutputItem - Output entity with routing properties
 *
 * When completing a job, outputs can include properties for per-item routing.
 * The entity_id is required; additional properties are used for route matching.
 *
 * Example:
 * ```typescript
 * job.complete([
 *   { entity_id: "ent_abc", entity_class: "canonical" },
 *   { entity_id: "ent_xyz", entity_class: "mention" },
 * ]);
 * ```
 */
export interface OutputItem {
  /** Entity ID of the output */
  entity_id: string;
  /** Additional properties for routing (matched against route rules) */
  [key: string]: unknown;
}

/**
 * Output - Output from a klados job
 *
 * Can be either:
 * - A string (entity ID) - no routing properties, goes to default target
 * - An OutputItem object - includes entity_id and routing properties
 */
export type Output = string | OutputItem;
