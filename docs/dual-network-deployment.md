# Dual-Network Deployment Guide

This guide explains how to configure klados workers to handle invocations from both test and main networks using a single Cloudflare Worker deployment.

## Problem

When a klados is registered on both test and main networks:
- Each network creates a **separate klados entity** with a unique ID
- Each klados entity has its **own API key** for authentication
- A single worker deployment receives requests from both networks

Without proper configuration, the worker uses hardcoded credentials that only work for one network, causing failures when invoked from the other.

**Example:**
- Test klados: `IIKHM05BX9NKE0S24TZCDKWFDF` with key `ak_c7f4b...`
- Main klados: `01KJ60TTR9BACEJHH5WGW2H10C` with key `ak_7cbd6...`

When the main network invokes the klados, the request includes `network: "main"`, but if the worker is configured with the test credentials, it will fail to authenticate.

## Solution

Use `getKladosConfig()` from `@arke-institute/rhiza` to automatically select the correct credentials based on `request.network`.

## Migration Steps

### 1. Update rhiza dependency

```bash
npm install @arke-institute/rhiza@^0.7.10
```

### 2. Update `src/types.ts`

Add network-specific environment variables and an index signature:

```typescript
export interface Env {
  // Default agent config (required)
  AGENT_ID: string;
  AGENT_VERSION: string;
  ARKE_AGENT_KEY: string;

  // Network-specific overrides (optional)
  AGENT_ID_TEST?: string;
  AGENT_ID_MAIN?: string;
  ARKE_AGENT_KEY_TEST?: string;
  ARKE_AGENT_KEY_MAIN?: string;

  // Other worker-specific vars...
  VERIFICATION_TOKEN?: string;
  ARKE_VERIFY_AGENT_ID?: string;

  // Index signature for NetworkEnv compatibility
  [key: string]: unknown;
}
```

### 3. Update `src/index.ts`

Replace manual credential selection with `getKladosConfig`:

**Before:**
```typescript
import { KladosJob, type KladosRequest } from '@arke-institute/rhiza';

app.post('/process', async (c) => {
  const req = await c.req.json<KladosRequest>();

  const job = KladosJob.accept(req, {
    agentId: c.env.AGENT_ID,
    agentVersion: c.env.AGENT_VERSION,
    authToken: c.env.ARKE_AGENT_KEY,
  });
  // ...
});
```

**After:**
```typescript
import { KladosJob, getKladosConfig, type KladosRequest } from '@arke-institute/rhiza';

app.post('/process', async (c) => {
  const req = await c.req.json<KladosRequest>();

  // Automatically selects correct credentials based on request.network
  const config = getKladosConfig(c.env, req.network);
  const job = KladosJob.accept(req, config);
  // ...
});
```

### 4. Update `wrangler.jsonc`

Add network-specific agent IDs:

```jsonc
{
  "vars": {
    // Default (used as fallback)
    "AGENT_ID": "01KJ60TTR9BACEJHH5WGW2H10C",

    // Network-specific IDs
    "AGENT_ID_TEST": "IIKHM05BX9NKE0S24TZCDKWFDF",
    "AGENT_ID_MAIN": "01KJ60TTR9BACEJHH5WGW2H10C",

    "AGENT_VERSION": "1.0.0"
  }

  // Secrets (set via wrangler secret put):
  // - ARKE_AGENT_KEY: Default agent API key (fallback)
  // - ARKE_AGENT_KEY_TEST: Test network klados key
  // - ARKE_AGENT_KEY_MAIN: Main network klados key
}
```

Get the klados IDs from your state files:
- `.klados-state.json` → test network `klados_id`
- `.klados-state.prod.json` → main network `klados_id`

### 5. Create new API keys

Each klados entity needs its own API key. Create new keys via the API:

```bash
# Set your user key
export ARKE_USER_KEY="uk_..."

# Create test network key
curl -s -X POST "https://arke-v1.arke.institute/kladoi/YOUR_TEST_KLADOS_ID/keys" \
  -H "Authorization: ApiKey $ARKE_USER_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

# Create main network key
curl -s -X POST "https://arke-v1.arke.institute/kladoi/YOUR_MAIN_KLADOS_ID/keys" \
  -H "Authorization: ApiKey $ARKE_USER_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Each response includes the full key:
```json
{
  "key": "ak_c7f4b20ba29b980d1c0dce3ff808056df86402728a54b6aec848a7f06c75e46f",
  "prefix": "ak_c7f4b",
  "expires_at": "2027-02-26T23:49:30.295Z"
}
```

### 6. Set Cloudflare secrets

```bash
# Set test network key
echo "ak_..." | wrangler secret put ARKE_AGENT_KEY_TEST

# Set main network key
echo "ak_..." | wrangler secret put ARKE_AGENT_KEY_MAIN
```

Verify secrets are set:
```bash
wrangler secret list
```

### 7. Update state files

Update the `api_key_prefix` in your state files with the new prefixes:

`.klados-state.json`:
```json
{
  "api_key_prefix": "ak_c7f4b",
  ...
}
```

`.klados-state.prod.json`:
```json
{
  "api_key_prefix": "ak_7cbd6",
  ...
}
```

### 8. Deploy

```bash
npm run deploy
```

### 9. Test both networks

```bash
# Test network invocation
curl -X POST "https://arke-v1.arke.institute/kladoi/YOUR_TEST_KLADOS_ID/invoke" \
  -H "Authorization: ApiKey $ARKE_USER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target_entity": "...", "target_collection": "...", "confirm": true}'

# Main network invocation
curl -X POST "https://arke-v1.arke.institute/kladoi/YOUR_MAIN_KLADOS_ID/invoke" \
  -H "Authorization: ApiKey $ARKE_USER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"target_entity": "...", "target_collection": "...", "confirm": true}'
```

Both should return `"status": "started"` and complete successfully.

## How getKladosConfig Works

```typescript
function getKladosConfig(env: NetworkEnv, network: 'test' | 'main'): KladosJobConfig {
  // Select agent ID based on network
  let agentId: string;
  if (network === 'test' && env.AGENT_ID_TEST) {
    agentId = env.AGENT_ID_TEST;
  } else if (network === 'main' && env.AGENT_ID_MAIN) {
    agentId = env.AGENT_ID_MAIN;
  } else {
    agentId = env.AGENT_ID; // fallback
  }

  // Select API key based on network
  let authToken: string;
  if (network === 'test' && env.ARKE_AGENT_KEY_TEST) {
    authToken = env.ARKE_AGENT_KEY_TEST;
  } else if (network === 'main' && env.ARKE_AGENT_KEY_MAIN) {
    authToken = env.ARKE_AGENT_KEY_MAIN;
  } else {
    authToken = env.ARKE_AGENT_KEY; // fallback
  }

  return { agentId, agentVersion: env.AGENT_VERSION, authToken };
}
```

**Fallback behavior:** If network-specific vars aren't set, it falls back to the default `AGENT_ID` and `ARKE_AGENT_KEY`. This allows gradual migration.

## Key Rotation Script

For convenience, add a key rotation script to your worker. See `core/describe/scripts/rotate-keys.ts` for a complete example.

Add to `package.json`:
```json
{
  "scripts": {
    "rotate-keys": "npx tsx scripts/rotate-keys.ts"
  }
}
```

Usage:
```bash
ARKE_USER_KEY=uk_... npm run rotate-keys
```

This will:
1. Create new API keys for both kladoi
2. Set them as Cloudflare Worker secrets
3. Update the state files with new prefixes

## Revoking Old Keys

After migration, revoke old API keys:

```bash
# List keys to find old prefixes
curl -s "https://arke-v1.arke.institute/kladoi/YOUR_KLADOS_ID/keys" \
  -H "Authorization: ApiKey $ARKE_USER_KEY"

# Revoke old key by prefix
curl -s -X DELETE "https://arke-v1.arke.institute/kladoi/YOUR_KLADOS_ID/keys/ak_old_prefix" \
  -H "Authorization: ApiKey $ARKE_USER_KEY"
```

## Workers Requiring Migration

The following workers in `arke-kladoi/` have dual-network registrations and should be migrated:

| Worker | Test Klados | Main Klados |
|--------|-------------|-------------|
| core/describe | IIKHM05BX9NKE0S24TZCDKWFDF | 01KJ60TTR9BACEJHH5WGW2H10C |
| core/scatter | (check state files) | (check state files) |
| knowledge-graph/kg-extractor | (check state files) | (check state files) |
| knowledge-graph/kg-cluster | (check state files) | (check state files) |
| file-processing/kladoi/* | (check state files) | (check state files) |

Check each worker's `.klados-state.json` and `.klados-state.prod.json` for IDs.

## Troubleshooting

### "Authentication required" errors
- Verify the API key is correct for the network being invoked
- Check that secrets are set: `wrangler secret list`
- Ensure the key hasn't expired (keys expire after 1 year by default)

### Wrong klados ID in logs
- Check that `AGENT_ID_TEST` and `AGENT_ID_MAIN` are set correctly in `wrangler.jsonc`
- Verify the worker was redeployed after changing vars

### Job starts but fails immediately
- Check wrangler logs: `wrangler tail`
- Look for authentication errors indicating wrong key for network
