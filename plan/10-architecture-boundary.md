# Architecture Boundary: rhiza vs cloudflare-klados

This document defines what belongs in each project.

---

## rhiza (this library)

**Purpose**: Core types, validation, and portable utilities for the rhiza workflow protocol. Runtime-agnostic - works in Node, Cloudflare Workers, Lambda, Vercel, etc.

### Currently Implemented

| Module | Purpose |
|--------|---------|
| `types/` | All type definitions (klados, rhiza, log, batch, request, response, status) |
| `validation/` | Static and runtime validation (klados, rhiza, runtime) |
| `handoff/` | Handoff interpretation (route, scatter, gather, interpret, target) |
| `traverse/` | Log chain traversal (findLeaves, buildLogTree, etc.) |
| `resume/` | Workflow resumption utilities (canResume, resumeWorkflow) |
| `status/` | Status aggregation from logs (buildStatusFromLogs) |

### To Add

#### 1. Signature Utilities (`src/signature/`)

Portable parsing/validation (no crypto - just format handling):

```typescript
// Parse X-Arke-Signature header: "t=<timestamp>,v1=<signature>"
export interface ParsedSignature {
  timestamp: number;
  signature: string;
  version: 'v1';
}

export function parseSignatureHeader(header: string): ParsedSignature | null;

// Validate timestamp freshness
export interface TimestampValidation {
  valid: boolean;
  error?: 'too_old' | 'in_future';
}

export function validateTimestamp(
  timestamp: number,
  maxAgeSeconds?: number,    // default: 300 (5 min)
  futureTolerance?: number   // default: 60 (1 min)
): TimestampValidation;

// Build the message format for signing/verification
export function buildSignedPayload(timestamp: number, body: string): string;

// Constants
export const SIGNATURE_MAX_AGE_SECONDS = 300;
export const SIGNATURE_FUTURE_TOLERANCE_SECONDS = 60;
export const PUBLIC_KEY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
```

#### 2. Verification Types (`src/types/verification.ts`)

```typescript
// Response from /.well-known/arke-verification
export interface VerificationEndpointResponse {
  verification_token: string;
  agent_id: string;  // or klados_id
  timestamp?: number;
}

// Response from /.well-known/signing-key
export interface SigningKeyResponse {
  public_key: string;  // base64 encoded Ed25519 public key
  algorithm: 'Ed25519';
  key_id?: string;
}

// Verification token request (POST /kladoi/:id/verify with empty body)
export interface VerificationTokenResponse {
  verification_token: string;
  klados_id: string;
  endpoint: string;
  instructions: string;
  expires_at: string;
}

// Verification confirm response
export interface VerificationConfirmResponse {
  verified: boolean;
  verified_at?: string;
  error?: string;
  message?: string;
}
```

#### 3. ArkeClient Interface (`src/client/`)

Abstract interface for API interactions (runtime-specific implementations can extend):

```typescript
export interface ArkeClient {
  // Entity operations
  getEntity<T>(id: string): Promise<T | null>;
  createEntity<T>(entity: Partial<T>): Promise<T>;
  updateEntity<T>(id: string, update: Partial<T>, expectTip?: string): Promise<T>;

  // Batch operations
  createBatch<T>(entities: Partial<T>[]): Promise<T[]>;

  // Klados/Rhiza invocation
  invokeKlados(kladosId: string, request: KladosInvokeRequest): Promise<InvokeResponse>;
  invokeRhiza(rhizaId: string, request: RhizaInvokeRequest): Promise<InvokeResponse>;

  // Query operations
  queryEntities<T>(query: EntityQuery): Promise<T[]>;
}

// The mock client in __tests__/fixtures/mock-client.ts already follows this pattern
```

#### 4. Entity Builders (`src/builders/`)

Helpers for constructing valid entity structures:

```typescript
// Build a klados entity for creation
export function buildKladosEntity(props: KladosBuilderInput): KladosEntity;

// Build a rhiza entity for creation
export function buildRhizaEntity(props: RhizaBuilderInput): RhizaEntity;

// Build a log entity
export function buildLogEntity(props: LogBuilderInput): KladosLogEntry;

// Build a batch entity
export function buildBatchEntity(props: BatchBuilderInput): ScatterBatchEntity;
```

### NOT in rhiza

- Actual HTTP client implementation
- Ed25519 crypto operations (signing/verifying)
- Cloudflare Worker specifics (Hono, Durable Objects, wrangler)
- Registration scripts
- Environment variable handling

---

## cloudflare-klados (separate project)

**Purpose**: Runtime implementation for Cloudflare Workers. Implements a klados endpoint that can participate in rhiza workflows.

### Structure

```
cloudflare-klados/
├── src/
│   ├── router.ts          # Hono router with standard routes
│   ├── verify.ts          # Ed25519 signature verification
│   ├── process.ts         # /process endpoint handler
│   ├── well-known.ts      # /.well-known/* handlers
│   ├── state/
│   │   ├── batch-do.ts    # Durable Object for batch state
│   │   └── log-do.ts      # Durable Object for logs (optional)
│   └── utils/
│       └── public-key.ts  # Fetch + cache Arke public key
├── register/
│   └── register.ts        # Registration + verification automation
├── wrangler.jsonc         # Worker configuration
└── package.json           # Depends on @arke-institute/rhiza
```

### Dependencies

```json
{
  "dependencies": {
    "@arke-institute/rhiza": "^1.0.0",
    "hono": "^4.0.0",
    "@noble/ed25519": "^2.0.0"
  }
}
```

### Routes

| Route | Purpose |
|-------|---------|
| `GET /.well-known/arke-verification` | Endpoint verification |
| `POST /process` | Main job processing (with signature verification) |
| `GET /health` | Health check |

### Key Implementation

```typescript
// router.ts
import { parseSignatureHeader, validateTimestamp, buildSignedPayload } from '@arke-institute/rhiza';

app.post('/process', async (c) => {
  const body = await c.req.text();
  const signatureHeader = c.req.header('X-Arke-Signature');

  // Use rhiza utilities for parsing
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return c.json({ accepted: false, error: 'Invalid signature format' }, 401);
  }

  // Use rhiza utilities for timestamp validation
  const timestampResult = validateTimestamp(parsed.timestamp);
  if (!timestampResult.valid) {
    return c.json({ accepted: false, error: timestampResult.error }, 401);
  }

  // Crypto verification (cloudflare-klados responsibility)
  const signedPayload = buildSignedPayload(parsed.timestamp, body);
  const publicKey = await getArkePublicKey(c.env);
  const valid = await ed25519.verify(parsed.signature, signedPayload, publicKey);

  // Continue processing...
});
```

### Durable Objects

For scatter/gather, use SQL-backed DOs per your preference:

```typescript
// batch-do.ts
export class BatchDurableObject {
  private sql: SqlStorage;

  constructor(state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS slots (
        idx INTEGER PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        output_ids TEXT,
        error TEXT
      )
    `);
  }

  async completeSlot(index: number, outputIds: string[]): Promise<boolean> {
    // Atomic slot update
  }
}
```

---

## Boundary Summary

| Concern | rhiza | cloudflare-klados |
|---------|-------|-------------------|
| Types & interfaces | ✓ | imports from rhiza |
| Validation logic | ✓ | uses rhiza validation |
| Handoff interpretation | ✓ | uses rhiza handoff |
| Signature parsing | ✓ | uses rhiza signature |
| Ed25519 crypto | ✗ | ✓ |
| HTTP routing | ✗ | ✓ (Hono) |
| Durable Objects | ✗ | ✓ |
| Wrangler config | ✗ | ✓ |
| Registration automation | ✗ | ✓ |

---

## Next Steps

1. **rhiza cleanup**:
   - Update `src/index.ts` to export handoff, resume, status
   - Add signature utilities (`src/signature/`)
   - Add verification types (`src/types/verification.ts`)
   - Add ArkeClient interface (`src/client/`)
   - Remove non-existent `utils` export

2. **cloudflare-klados**:
   - Create new repo (Arke-Institute/cloudflare-klados)
   - Set up Hono router
   - Implement signature verification
   - Implement process handler
   - Add Durable Objects for state
   - Create registration scripts
