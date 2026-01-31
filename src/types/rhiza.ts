/**
 * Rhiza - A workflow definition
 *
 * The root structure that defines a graph of kladoi (actions)
 * with handoff rules between them.
 */
export interface Rhiza {
  /** Unique identifier (Arke entity ID) */
  id: string;

  /** Human-readable name */
  name: string;

  /** Semantic version */
  version: string;

  /** Optional description */
  description?: string;

  /** Entry point - which klados starts the workflow */
  entry: string;

  /** All kladoi in this workflow, keyed by name */
  kladoi: Record<string, KladosSpec>;
}

/**
 * KladosSpec - Specification for a single action in the workflow
 */
export interface KladosSpec {
  /** Agent ID to invoke for this klados */
  action: string;

  /** Human-readable description */
  description?: string;

  /** Input contract - what this klados accepts */
  accepts: AcceptsSpec;

  /** Output contract - what this klados produces */
  produces: ProducesSpec;

  /** What happens after this klados completes */
  then: ThenSpec;
}

/**
 * AcceptsSpec - Input contract
 */
export interface AcceptsSpec {
  /**
   * Accepted content types
   * Use ["*"] to accept anything
   * Examples: ["file/pdf"], ["file/jpeg", "file/png"], ["*"]
   */
  types: string[];

  /**
   * Input cardinality
   * - 'one': Receives a single entity
   * - 'many': Receives multiple entities (array)
   */
  cardinality: 'one' | 'many';
}

/**
 * ProducesSpec - Output contract
 */
export interface ProducesSpec {
  /**
   * Produced content types
   * Use ["*"] to indicate dynamic types
   * Examples: ["file/jpeg"], ["text/ocr"], ["*"]
   */
  types: string[];

  /**
   * Output cardinality
   * - 'one': Produces a single entity
   * - 'many': Produces multiple entities
   */
  cardinality: 'one' | 'many';
}

/**
 * ThenSpec - Handoff specification
 *
 * Defines what happens after a klados completes.
 */
export type ThenSpec =
  | { done: true } // Terminal - workflow ends here
  | { pass: TargetRef } // 1:1 - pass outputs directly to next
  | { scatter: TargetRef } // 1:N - invoke next once per output (fan-out)
  | { gather: TargetRef } // N:1 - wait for batch, then invoke (fan-in)
  | { route: RouteRule[] }; // Conditional routing

/**
 * TargetRef - Reference to next klados or sub-rhiza
 */
export type TargetRef =
  | string // Local klados name: "ocr-service"
  | { rhiza: string }; // Sub-workflow: { rhiza: "IIrhiza123..." }

/**
 * RouteRule - Conditional routing rule
 */
export interface RouteRule {
  /** Condition to match */
  where: WhereCondition;

  /** What to do if condition matches (recursive) */
  then: ThenSpec;
}

/**
 * WhereCondition - Simple property-based matching
 *
 * For now, only supports equality matching on entity properties.
 */
export interface WhereCondition {
  /** Property name to check (e.g., "type", "content_type") */
  property: string;

  /** Value to match */
  equals: string | number | boolean;
}
