# Template Update Plan

## Overview

Update the `klados-worker-template` registration script to fix issues discovered during stamp-chain workflow debugging.

## Files to Update

### 1. `klados-worker-template/scripts/register.ts`

#### Fix 1: Collection Roles (lines 187-196)
**Current:**
```typescript
const { id } = await apiRequest<{ id: string }>(
  network,
  'POST',
  '/collections',
  {
    label: 'Klados Agents',
    description: 'Collection for klados worker agents',
  }
);
```

**Updated:**
```typescript
const { id } = await apiRequest<{ id: string }>(
  network,
  'POST',
  '/collections',
  {
    label: 'Klados Agents',
    description: 'Collection for klados worker agents',
    roles: {
      public: ['*:view', '*:invoke'],
      viewer: ['*:view'],
      editor: ['*:view', '*:update', '*:create', '*:invoke'],
      owner: ['*:view', '*:update', '*:create', '*:manage', '*:invoke', 'collection:update', 'collection:manage'],
    },
  }
);
```

**Why:** Kladoi need to be publicly invokable for workflow chaining.

---

#### Fix 2: Klados API Key (lines 280-293)
**Current:**
```typescript
async function createApiKey(
  network: Network,
  label: string
): Promise<{ key: string; prefix: string }> {
  console.log(`  Creating API key...`);
  const result = await apiRequest<{ key: string; prefix: string }>(
    network,
    'POST',
    '/users/me/keys',
    { label }
  );
  console.log(`  API key created: ${result.prefix}...`);
  return result;
}
```

**Updated:**
```typescript
async function createKladosApiKey(
  network: Network,
  kladosId: string,
  label: string
): Promise<{ key: string; prefix: string }> {
  console.log(`  Creating klados API key...`);
  const result = await apiRequest<{ key: string; prefix: string }>(
    network,
    'POST',
    `/kladoi/${kladosId}/keys`,
    { label }
  );
  console.log(`  Klados API key created: ${result.prefix}...`);
  return result;
}
```

**Why:** Klados workers must authenticate AS the klados entity, not as the user. This ensures permission grants to the klados apply correctly.

---

#### Fix 3: Update call site (line 469)
**Current:**
```typescript
const apiKey = await createApiKey(network, `${config.label} - ${network}`);
```

**Updated:**
```typescript
const apiKey = await createKladosApiKey(network, klados.id, `${config.label} - ${network}`);
```

---

### 2. `klados-worker-template/README.md`

Add a section explaining:
- Klados API keys vs User API keys
- Collection permission requirements for workflow chaining
- How to debug permission issues

---

### 3. Sync stamp-worker with template

The `klados-examples/stamp-worker` already has these fixes. After updating the template, verify consistency:
- Compare `scripts/register.ts` between template and stamp-worker
- Ensure they match (except for worker-specific parts)

---

## Verification Steps

1. Delete existing `.klados-state.json` from template
2. Run `npm run register` with fresh registration
3. Verify:
   - Collection has `*:invoke` in public role
   - API key prefix is `ak_...` not `uk_...`
4. Test with a workflow invocation

---

## Downstream Considerations

- Any existing klados registered with the old template will need:
  1. Collection role update (add `*:invoke` to public)
  2. New klados API key created and deployed

- Document migration steps in README
