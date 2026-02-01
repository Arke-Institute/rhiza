# Agent/Klados Verification System

This document describes the two verification systems used by Arke to secure agent and klados communications:

1. **Endpoint Ownership Verification** - Proves the developer controls the endpoint URL
2. **Request Signature Verification** - Proves incoming requests originate from Arke

> **Note:** The klados system (part of the rhiza workflow protocol) uses the same verification infrastructure as agents. The routes change from `/agents` to `/kladoi`, but the verification mechanics are identical. See `plan/06-api-changes.md` for klados-specific details.

---

## 1. Endpoint Ownership Verification

This verification proves that the person registering an agent actually controls the endpoint URL. It prevents impersonation attacks where someone could register an agent pointing to a URL they don't control.

### Overview

The verification follows a challenge-response pattern similar to DNS TXT record verification or ACME challenges:

```
┌─────────────────┐                ┌─────────────────┐                ┌─────────────────┐
│  Agent Owner    │                │   Arke API      │                │  Agent Endpoint │
│  (registration  │                │                 │                │  (worker)       │
│   script)       │                │                 │                │                 │
└────────┬────────┘                └────────┬────────┘                └────────┬────────┘
         │                                  │                                  │
         │ 1. POST /agents                  │                                  │
         │    (creates agent, status:       │                                  │
         │     development)                 │                                  │
         │─────────────────────────────────>│                                  │
         │                                  │                                  │
         │ 2. POST /agents/:id/verify       │                                  │
         │    (no body = request token)     │                                  │
         │─────────────────────────────────>│                                  │
         │                                  │                                  │
         │ <token, instructions, expires>   │                                  │
         │<─────────────────────────────────│                                  │
         │                                  │                                  │
         │ 3. Push ARKE_VERIFY_TOKEN and    │                                  │
         │    ARKE_VERIFY_AGENT_ID as       │                                  │
         │    worker secrets                │                                  │
         │─────────────────────────────────────────────────────────────────────>│
         │                                  │                                  │
         │ 4. POST /agents/:id/verify       │                                  │
         │    { confirm: true }             │                                  │
         │─────────────────────────────────>│                                  │
         │                                  │                                  │
         │                                  │ 5. GET /.well-known/arke-verification
         │                                  │─────────────────────────────────>│
         │                                  │                                  │
         │                                  │ { verification_token, agent_id }  │
         │                                  │<─────────────────────────────────│
         │                                  │                                  │
         │                                  │ 6. Validate token + agent_id     │
         │                                  │    match stored values           │
         │                                  │                                  │
         │   { verified: true,              │                                  │
         │     verified_at: "..." }         │                                  │
         │<─────────────────────────────────│                                  │
         │                                  │                                  │
         │ 7. Update agent status to        │                                  │
         │    'active'                      │                                  │
         │─────────────────────────────────>│                                  │
         │                                  │                                  │
```

### Detailed Flow

#### Step 1: Create Agent (Status: Development)

```http
POST /agents
Content-Type: application/json
Authorization: ApiKey <user_api_key>

{
  "label": "My Agent",
  "endpoint": "https://my-agent.workers.dev",
  "actions_required": ["entity:view", "file:create"],
  "collection": "<agent_home_collection_id>"
}
```

New agents start in `development` status and cannot be invoked until verified and activated.

#### Step 2: Request Verification Token

```http
POST /agents/<agent_id>/verify
Content-Type: application/json
Authorization: ApiKey <user_api_key>

{}
```

Response:
```json
{
  "verification_token": "vt_a1b2c3...",
  "agent_id": "II...",
  "endpoint": "https://my-agent.workers.dev",
  "instructions": "Deploy a GET endpoint at https://my-agent.workers.dev/.well-known/arke-verification that returns JSON: {...}",
  "expires_at": "2025-01-15T12:00:00.000Z"
}
```

**Token details:**
- Prefix: `vt_` (verification token)
- Length: 32 random bytes, hex-encoded (67 chars total)
- TTL: 1 hour
- Storage: D1 database table `agent_verification_tokens`

#### Step 3: Deploy Verification Endpoint

The agent must serve a `/.well-known/arke-verification` endpoint that returns:

```json
{
  "verification_token": "vt_a1b2c3...",
  "agent_id": "II..."
}
```

**agent-core implementation** (`router.ts:220-237`):
```typescript
app.get('/.well-known/arke-verification', (c) => {
  const token = c.env.ARKE_VERIFY_TOKEN;
  const agentId = c.env.ARKE_VERIFY_AGENT_ID || c.env.AGENT_ID;

  if (!token) {
    return c.json({ error: 'Verification not configured' }, 404);
  }

  return c.json({
    verification_token: token,
    agent_id: agentId,
    timestamp: Date.now(),
  });
});
```

For Cloudflare Workers, the secrets are pushed using wrangler:
```bash
echo "$TOKEN" | wrangler secret put ARKE_VERIFY_TOKEN --env test
echo "$AGENT_ID" | wrangler secret put ARKE_VERIFY_AGENT_ID --env test
```

#### Step 4: Confirm Verification

```http
POST /agents/<agent_id>/verify
Content-Type: application/json
Authorization: ApiKey <user_api_key>

{
  "confirm": true
}
```

Arke then:
1. Retrieves the stored token from D1
2. Fetches `{endpoint}/.well-known/arke-verification` (10s timeout)
3. Validates:
   - Token matches exactly
   - Agent ID matches exactly
   - Response is valid JSON
4. On success, updates agent with `endpoint_verified_at` timestamp
5. Deletes the verification token from D1

**Possible failure responses:**
```json
{ "verified": false, "error": "no_token", "message": "..." }
{ "verified": false, "error": "token_expired", "message": "..." }
{ "verified": false, "error": "fetch_failed", "message": "..." }
{ "verified": false, "error": "invalid_response", "message": "..." }
{ "verified": false, "error": "token_mismatch", "message": "..." }
{ "verified": false, "error": "agent_id_mismatch", "message": "..." }
```

#### Step 5: Activate Agent

Only verified agents can be activated:

```http
PUT /agents/<agent_id>
Content-Type: application/json
Authorization: ApiKey <user_api_key>

{
  "expect_tip": "<current_cid>",
  "status": "active"
}
```

### Re-Verification on Endpoint Change

When an agent's endpoint URL changes:
1. `endpoint_verified_at` is cleared (set to null)
2. Status is reset to `development` (if currently `active`)
3. The full verification flow must be repeated

This prevents an attacker from:
1. Registering an agent with their own endpoint
2. Verifying it
3. Changing the endpoint to a victim's URL

### Registration Script Flow

The `register.ts` script in agent-core automates the entire flow:

```typescript
// 1. Create agent (or update existing)
const { id: agentId } = await createAgent(...);

// 2. Request verification token
const verifyResponse = await requestVerificationToken(apiUrl, userKey, network, agentId);

// 3. Push verification secrets to worker
await pushVerifySecretsToWrangler(cwd, network, verifyResponse.verification_token, agentId);

// 4. Wait for worker deployment
await waitForDeployment(agentConfig.endpoint);

// 5. Confirm verification
const verifyResult = await confirmVerification(apiUrl, userKey, network, agentId);

// 6. Activate agent
await activateAgent(apiUrl, userKey, network, agentId, cid);

// 7. Create API key for agent
const keyResult = await createAgentKey(apiUrl, userKey, network, agentId, label);

// 8. Push agent API key to worker secrets
await pushToWranglerSecret(cwd, network, keyResult.key);

// 9. Cleanup verification secrets
await deleteVerifySecretsFromWrangler(cwd, network);
```

---

## 2. Request Signature Verification

This verification proves that requests to an agent's `/process` endpoint actually come from Arke, not from an attacker who discovered the agent's URL.

### Overview

Arke signs all outbound requests to agent endpoints using Ed25519. Agents verify these signatures using Arke's public key.

```
┌─────────────────┐                ┌─────────────────┐                ┌─────────────────┐
│     User        │                │   Arke API      │                │  Agent Endpoint │
│                 │                │                 │                │                 │
└────────┬────────┘                └────────┬────────┘                └────────┬────────┘
         │                                  │                                  │
         │ POST /agents/:id/invoke          │                                  │
         │─────────────────────────────────>│                                  │
         │                                  │                                  │
         │                                  │ 1. Build job request payload     │
         │                                  │ 2. Sign: "{timestamp}.{payload}" │
         │                                  │    with Ed25519 private key      │
         │                                  │                                  │
         │                                  │ POST /process                    │
         │                                  │ X-Arke-Signature: t=...,v1=...   │
         │                                  │ X-Arke-Request-Id: req_...       │
         │                                  │─────────────────────────────────>│
         │                                  │                                  │
         │                                  │               1. GET /.well-known/signing-key
         │                                  │               2. Verify signature
         │                                  │               3. Check timestamp freshness
         │                                  │                                  │
         │                                  │ { accepted: true, job_id: "..." }│
         │                                  │<─────────────────────────────────│
         │                                  │                                  │
         │ { status: "started",             │                                  │
         │   job_id: "...",                 │                                  │
         │   job_collection: "..." }        │                                  │
         │<─────────────────────────────────│                                  │
```

### Signature Format

**Header:** `X-Arke-Signature: t=<unix_timestamp>,v1=<base64_signature>`

**Signed payload:** `{timestamp}.{JSON_body}`

**Algorithm:** Ed25519 (using @noble/ed25519)

### Arke Side: Signing Requests

**Location:** `arke_v1/src/core/signing.ts`

```typescript
export async function signRequest(
  payload: object,
  privateKey: Uint8Array
): Promise<SignedRequest> {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const requestId = `req_${generateId()}`;

  // Create the signed payload: timestamp.body
  const signedPayload = `${timestamp}.${body}`;
  const signedPayloadBytes = new TextEncoder().encode(signedPayload);

  // Sign with Ed25519
  const signature = await ed25519.signAsync(signedPayloadBytes, privateKey);
  const signatureBase64 = encodeBase64(signature);

  return {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Arke/1.0',
      'X-Arke-Signature': `t=${timestamp},v1=${signatureBase64}`,
      'X-Arke-Request-Id': requestId,
    },
    body,
  };
}
```

### Public Key Endpoint

Arke exposes its public key at `/.well-known/signing-key`:

```http
GET https://arke-v1.arke.institute/.well-known/signing-key
```

Response:
```json
{
  "public_key": "<base64_encoded_ed25519_public_key>",
  "algorithm": "Ed25519",
  "key_id": "<key_identifier>"
}
```

### Agent Side: Verifying Signatures

**Location:** `agents/templates/agent-core/src/verify.ts`

```typescript
export async function verifyArkeSignature(
  body: string,
  signatureHeader: string,
  apiBase: string
): Promise<VerifyResult> {
  // 1. Parse header: t=<timestamp>,v1=<signature>
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, error: 'Invalid signature header format' };
  }

  // 2. Check timestamp freshness (5 min max age, 1 min future tolerance)
  const now = Math.floor(Date.now() / 1000);
  if (timestamp < now - 300) {
    return { valid: false, error: 'Signature timestamp too old' };
  }
  if (timestamp > now + 60) {
    return { valid: false, error: 'Signature timestamp in future' };
  }

  // 3. Fetch public key from Arke (cached for 1 hour)
  const publicKey = await getArkePublicKey(apiBase);

  // 4. Reconstruct signed message and verify
  const message = `${timestamp}.${body}`;
  const valid = await ed.verifyAsync(signatureBytes, messageBytes, publicKey);

  return { valid };
}
```

### Public Key Caching

The agent caches Arke's public key for 1 hour to avoid fetching it on every request:

```typescript
let cachedKey: { key: Uint8Array; fetchedAt: number } | null = null;
const KEY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getArkePublicKey(apiBase: string): Promise<Uint8Array> {
  if (cachedKey && Date.now() - cachedKey.fetchedAt < KEY_CACHE_TTL) {
    return cachedKey.key;
  }

  const response = await fetch(`${apiBase}/.well-known/signing-key`);
  const data = await response.json();
  const keyBytes = base64ToBytes(data.public_key);

  cachedKey = { key: keyBytes, fetchedAt: Date.now() };
  return keyBytes;
}
```

### Router Integration

The agent-core router automatically verifies signatures on `/process` requests:

**Location:** `agents/templates/agent-core/src/router.ts`

```typescript
app.post('/process', async (c) => {
  // 1. Read raw body for signature verification
  const body = await c.req.text();
  const signatureHeader = c.req.header('X-Arke-Signature');

  // 2. Verify signature
  if (!signatureHeader) {
    return c.json({ accepted: false, error: 'Missing signature header' }, 401);
  }

  const jobRequest = JSON.parse(body);

  const verifyResult = await verifyArkeSignature(
    body,
    signatureHeader,
    jobRequest.api_base  // Use api_base from the request to fetch public key
  );

  if (!verifyResult.valid) {
    return c.json({ accepted: false, error: verifyResult.error }, 401);
  }

  // 3. Continue processing...
});
```

### Timestamp Validation

| Check | Value | Purpose |
|-------|-------|---------|
| Max age | 5 minutes | Prevent replay attacks with old signatures |
| Future tolerance | 1 minute | Allow for clock skew between Arke and agent |

### Security Properties

1. **Authentication**: Only Arke can produce valid signatures
2. **Integrity**: Any modification to the request body invalidates the signature
3. **Freshness**: Timestamp prevents replay attacks
4. **Non-repudiation**: Arke cannot deny sending a signed request

---

## Summary

| Verification | Purpose | When | How |
|--------------|---------|------|-----|
| **Endpoint Ownership** | Prove you control the URL | Registration & endpoint changes | Challenge-response via `/.well-known/arke-verification` |
| **Request Signature** | Prove request is from Arke | Every `/process` call | Ed25519 signature in `X-Arke-Signature` header |

Both verifications work together to ensure:
- Only legitimate agent developers can register agents
- Only Arke can invoke agents
- Agents cannot be impersonated or hijacked

---

## Related Files

### Arke API
- `arke_v1/src/routes/agents.ts` - Verification endpoints and agent invocation
- `arke_v1/src/profiles/agent/operations.ts` - Agent CRUD and `invokeAgentEndpoint`
- `arke_v1/src/core/signing.ts` - Ed25519 signing implementation
- `arke_v1/src/index.ts` - `/.well-known/signing-key` endpoint

### Agent Core
- `agents/templates/agent-core/src/register/register.ts` - Registration automation
- `agents/templates/agent-core/src/router.ts` - Standard agent router with verification
- `agents/templates/agent-core/src/verify.ts` - Signature verification implementation
