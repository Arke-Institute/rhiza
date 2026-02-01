/**
 * KladosEntity - A standalone action entity
 *
 * Kladoi are first-class entities that can be:
 * - Invoked directly via POST /kladoi/:id/invoke
 * - Composed into workflows (rhizai)
 * - Reused across multiple rhizai
 */
export interface KladosEntity {
  /** Unique identifier (Arke entity ID) */
  id: string;

  /** Entity type */
  type: 'klados';

  properties: KladosProperties;

  relationships?: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
    peer_label?: string;
    properties?: Record<string, unknown>;
  }>;
}

export interface KladosProperties {
  /** Human-readable name */
  label: string;

  /** Description of what this klados does */
  description?: string;

  /** Endpoint URL where this klados is deployed */
  endpoint: string;

  /** Permissions required on target collection */
  actions_required: string[];

  /** Input contract - what this klados accepts */
  accepts: ContractSpec;

  /** Output contract - what this klados produces */
  produces: ContractSpec;

  /** Optional JSON Schema for additional input parameters */
  input_schema?: Record<string, unknown>;

  /** Status */
  status: 'development' | 'active' | 'disabled';

  /** When endpoint was verified */
  endpoint_verified_at?: string;

  /** Timestamps */
  created_at?: string;
  updated_at?: string;
}

/**
 * ContractSpec - Input/output contract
 */
export interface ContractSpec {
  /**
   * Accepted/produced content types
   * Use ["*"] to accept/produce anything
   * Examples: ["file/pdf"], ["file/jpeg", "file/png"], ["*"]
   */
  types: string[];

  /**
   * Cardinality
   * - 'one': Single entity
   * - 'many': Multiple entities (array)
   */
  cardinality: 'one' | 'many';
}
