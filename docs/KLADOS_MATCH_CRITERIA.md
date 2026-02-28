# Klados Match Criteria

## Overview

Match criteria define **when a klados applies to a given entity**. Instead of relying on semantic similarity (which is imprecise), match criteria provide deterministic, property-based discovery.

When a user or agent has an entity and wants to know "what tools can operate on this?", the discovery endpoint evaluates each klados's `match` criteria against the entity and returns those that match, ranked by specificity.

## Why This Matters

### The Problem

Previously, tool discovery relied on semantic search:
- User asks: "process this PDF"
- System searches klados descriptions for similarity
- Returns tools that *sound* relevant

This approach is unreliable because:
- A klados described as "extracts text from documents" might not actually support PDFs
- Multiple tools might have similar descriptions but different capabilities
- No guarantee the returned tool can actually operate on the entity

### The Solution

Match criteria make tool discovery **deterministic**:
- Each klados declares exactly what entities it operates on
- Discovery evaluates criteria against the actual entity properties
- Only tools that *can* operate on the entity are returned

```
Entity: { type: "file", properties: { content_type: "application/pdf" } }

PDF to JPEG:     match: type=file AND content_type=pdf     → MATCH ✓
Image Converter: match: type=file AND content_type=image/* → NO MATCH ✗
Describe:        match: { always: true }                   → MATCH ✓
```

## Adding Match Criteria to Your Klados

Add the `match` property to your `agent.json`:

```json
{
  "schema_version": "1.0",
  "label": "PDF to JPEG",
  "description": "Converts PDF pages to JPEG images",

  "match": {
    "and": [
      { "path": "type", "equals": "file" },
      { "path": "properties.content_type", "equals": "application/pdf" }
    ]
  },

  "endpoint": "https://...",
  "actions_required": ["entity:view", "entity:create"],
  ...
}
```

The registration script automatically includes `match` when creating or updating the klados.

## Match Criteria Schema

### Basic Structure

Match criteria is a recursive union type:

```typescript
type MatchCriteria =
  | { always: true }              // Matches any entity
  | { never: true }               // Never matches (disabled)
  | { and: MatchCriteria[] }      // All must match
  | { or: MatchCriteria[] }       // Any must match
  | { not: MatchCriteria }        // Inverts match
  | PropertyCondition;            // Tests a property
```

### Property Conditions

Test a single property on the entity:

```typescript
interface PropertyCondition {
  path: string;           // JSON path: "type", "properties.content_type"

  // Operators (exactly one required):
  equals?: unknown;       // Exact match
  not_equals?: unknown;   // Not equal
  in?: unknown[];         // Value is one of these
  not_in?: unknown[];     // Value is none of these
  exists?: boolean;       // Property exists (true) or absent (false)
  gt?: number;            // Greater than
  gte?: number;           // Greater than or equal
  lt?: number;            // Less than
  lte?: number;           // Less than or equal
  matches?: string;       // Regex pattern
  starts_with?: string;   // String prefix
  contains?: string;      // String contains

  // Collection operators (for maps and arrays)
  any?: MatchCriteria;    // Matches if ANY entry satisfies nested criteria
  all?: MatchCriteria;    // Matches if ALL entries satisfy nested criteria
}
```

### Collection Operators: `any` and `all`

The `any` and `all` operators iterate over map values or array elements. These are essential for matching file entities where the content type is nested inside `properties.content`:

**File entity structure:**
```json
{
  "type": "file",
  "properties": {
    "content": {
      "document.pdf": {
        "content_type": "application/pdf",
        "cid": "bafkrei...",
        "size": 250000
      }
    }
  }
}
```

**Matching PDF files:**
```json
{
  "path": "properties.content",
  "any": {
    "path": "content_type",
    "equals": "application/pdf"
  }
}
```

**Matching entities where all files are images:**
```json
{
  "path": "properties.content",
  "all": {
    "path": "content_type",
    "starts_with": "image/"
  }
}
```

### Path Resolution

Paths use dot notation to access nested properties:

| Path | Resolves to |
|------|-------------|
| `type` | `entity.type` |
| `properties.content_type` | `entity.properties.content_type` |
| `properties._kg_layer` | `entity.properties._kg_layer` |

## Examples

### File Type Matching

Match PDF files (using `any` to iterate over the content map):

```json
{
  "match": {
    "and": [
      { "path": "type", "equals": "file" },
      {
        "path": "properties.content",
        "any": {
          "path": "content_type",
          "equals": "application/pdf"
        }
      }
    ]
  }
}
```

Match multiple image types:

```json
{
  "match": {
    "and": [
      { "path": "type", "equals": "file" },
      {
        "path": "properties.content",
        "any": {
          "path": "content_type",
          "in": ["image/jpeg", "image/png", "image/gif", "image/webp"]
        }
      }
    ]
  }
}
```

### Property Existence

Match entities that have text content:

```json
{
  "match": {
    "path": "properties.text",
    "exists": true
  }
}
```

Match entities without a description (needs one generated):

```json
{
  "match": {
    "path": "properties.description",
    "exists": false
  }
}
```

### Numeric Conditions

Match base-layer KG entities only:

```json
{
  "match": {
    "and": [
      { "path": "properties._kg_layer", "equals": 0 },
      { "path": "type", "not_in": ["cluster_leader"] }
    ]
  }
}
```

Match entities with embedding dimension in range:

```json
{
  "match": {
    "and": [
      { "path": "properties.embedding_dim", "gte": 256 },
      { "path": "properties.embedding_dim", "lte": 1536 }
    ]
  }
}
```

### OR Conditions

Match entities with text OR document type:

```json
{
  "match": {
    "or": [
      { "path": "properties.text", "exists": true },
      { "path": "type", "in": ["text_chunk", "document"] }
    ]
  }
}
```

### Universal Match

Match any entity (utility kladoi, general-purpose tools):

```json
{
  "match": { "always": true }
}
```

### Disabled (Testing Only)

Never match - useful for test kladoi that shouldn't appear in discovery:

```json
{
  "match": { "never": true }
}
```

### Complex Conditions

Match PDF or Word documents that haven't been processed:

```json
{
  "match": {
    "and": [
      { "path": "type", "equals": "file" },
      { "path": "properties.content_type", "in": [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ]},
      { "not": {
        "path": "properties.processed",
        "equals": true
      }}
    ]
  }
}
```

## Specificity Score

When multiple kladoi match, they're ranked by **specificity** - how precisely the criteria matched:

| Match Type | Specificity |
|------------|-------------|
| `{ always: true }` | 0 |
| Single PropertyCondition | 1 |
| `{ and: [c1, c2] }` | Sum of children |
| `{ or: [c1, c2] }` | Max of matched children |

Example rankings for a PDF entity:

```
1. PDF to JPEG       (specificity: 2) - matches type AND content_type
2. File Processor    (specificity: 1) - matches only type
3. Describe          (specificity: 0) - always matches
```

More specific tools appear first, giving users the most relevant options.

## Rhiza (Workflow) Discovery

Rhiza don't have their own `match` criteria. Instead, they **inherit from their entry klados**.

When discovering tools for an entity:
1. The entry step's klados is looked up
2. Its `match` criteria is evaluated against the entity
3. If it matches, the rhiza appears in results

This means workflows automatically match the same entities as their starting point.

## Best Practices

### Be Specific

The more specific your match criteria, the higher you'll rank in discovery results. Instead of:

```json
{ "match": { "always": true } }
```

Prefer:

```json
{
  "match": {
    "and": [
      { "path": "type", "equals": "file" },
      { "path": "properties.content_type", "equals": "application/pdf" }
    ]
  }
}
```

### Match What You Actually Support

Only match entities your klados can actually process. If your klados errors on certain inputs, don't match them.

### Use `never: true` for Test Kladoi

Test kladoi shouldn't appear in production discovery:

```json
{ "match": { "never": true } }
```

### Consider Edge Cases

Think about what happens when properties are missing:

```json
{
  "match": {
    "and": [
      { "path": "type", "equals": "file" },
      { "path": "properties.content_type", "exists": true },
      { "path": "properties.content_type", "equals": "application/pdf" }
    ]
  }
}
```

## Discovery API

The discovery endpoint evaluates match criteria:

```
POST /collections/{collection_id}/kladoi/discover
{
  "entity_id": "01JFILE456..."
}
```

Or with inline entity data:

```json
{
  "entity": {
    "type": "file",
    "properties": {
      "content_type": "application/pdf"
    }
  }
}
```

Response:

```json
{
  "matches": [
    {
      "id": "01KLADOS_PDF_JPEG",
      "type": "klados",
      "label": "PDF to JPEG",
      "description": "Converts PDF pages to JPEG images",
      "specificity": 2
    },
    {
      "id": "01KLADOS_DESCRIBE",
      "type": "klados",
      "label": "Describe",
      "description": "Generates AI descriptions",
      "specificity": 0
    }
  ],
  "total_evaluated": 45
}
```

## See Also

- [Arke v1 KLADOS_DISCOVERY.md](https://github.com/arke-institute/arke_v1/blob/main/docs/architecture/KLADOS_DISCOVERY.md) - Full API documentation
- [KLADOS_DISCOVERY_ROADMAP.md](https://github.com/arke-institute/arke_v1/blob/main/docs/architecture/KLADOS_DISCOVERY_ROADMAP.md) - Future hybrid semantic + criteria search
