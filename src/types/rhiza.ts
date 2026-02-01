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

  /** Entry point - klados ID that starts the workflow */
  entry: string;

  /** Flow definition - what happens after each klados */
  flow: Record<string, FlowStep>;

  /** Status */
  status: 'development' | 'active' | 'disabled';

  /** Timestamps */
  created_at?: string;
  updated_at?: string;
}

/**
 * FlowStep - What happens after a klados completes
 */
export interface FlowStep {
  /** Handoff specification */
  then: ThenSpec;
}

/**
 * ThenSpec - Handoff specification
 *
 * Three core operations: pass, scatter, gather (+ done for terminal)
 * - Target can be klados ID or rhiza ID (discovered at runtime)
 * - Route conditions can be added to any operation via `route` array
 */
export type ThenSpec =
  | { done: true }                                    // Terminal - workflow ends
  | { pass: string; route?: RouteRule[] }            // 1:1 - target ID (klados or rhiza)
  | { scatter: string; route?: RouteRule[] }         // 1:N fan-out - target ID
  | { gather: string; route?: RouteRule[] };         // N:1 fan-in - target ID

/**
 * RouteRule - Conditional routing rule
 *
 * Routes are evaluated in order. First matching rule wins.
 * If no rule matches, the default target (pass/scatter/gather value) is used.
 */
export interface RouteRule {
  /** Condition to match (supports AND/OR logic) */
  where: WhereCondition;

  /** Target ID if condition matches (overrides default) */
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
  /** Value to match */
  equals: string | number | boolean;
}

export interface WhereAnd {
  /** All conditions must match */
  and: WhereCondition[];
}

export interface WhereOr {
  /** Any condition must match */
  or: WhereCondition[];
}
