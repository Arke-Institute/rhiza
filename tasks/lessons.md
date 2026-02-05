# Lessons Learned

## 2026-02-05: Stamp Chain Workflow Debugging

### 1. Klados API Keys vs User API Keys

**Problem**: Klados workers were using user API keys (`uk_...`) instead of klados API keys (`ak_...`). This caused permission mismatches because permissions granted to a klados entity don't apply when authenticating as a user.

**Root Cause**: Registration script used `POST /users/me/keys` instead of `POST /kladoi/{id}/keys`.

**Fix**: Use the klados-specific endpoint to create API keys:
```typescript
// Wrong - creates user key
POST /users/me/keys { label: "..." }

// Correct - creates klados key that authenticates AS the klados
POST /kladoi/{kladosId}/keys { label: "..." }
```

**Rule**: Always use `/kladoi/{id}/keys` for klados workers. The klados API key authenticates requests as the klados entity, allowing permission grants to work correctly.

---

### 2. Collection Public Invoke Permissions

**Problem**: Klados workers couldn't invoke other kladoi in the workflow because the collection's `public` role only had `*:view`, not `*:invoke`.

**Root Cause**: Collection created without specifying roles, using defaults that don't include invoke.

**Fix**: Specify roles when creating klados collections:
```typescript
POST /collections {
  label: "Klados Agents",
  roles: {
    public: ['*:view', '*:invoke'],  // Enable public invocation
    // ... other roles
  }
}
```

**Rule**: Klados collections need `*:invoke` in the public role for workflow chaining to work.

---

### 3. API Parameter Names: target_entity vs target

**Problem**: SDK was sending `target` but API expects `target_entity` or `target_entities`.

**Root Cause**: Outdated comment in code said "API expects: target" but actual API schema changed.

**Fix**: Use correct parameter names:
```typescript
// Wrong
body: { target: entityId, ... }

// Correct
body: { target_entity: entityId, ... }
// or
body: { target_entities: [entityId1, entityId2], ... }
```

**Rule**: Always verify parameter names against actual API spec, not code comments.

---

### 4. Single-Element Array Handling for Cardinality

**Problem**: When outputs is `['entityId']`, it was treated as "many" and sent as `target_entities`, but the target klados expected `cardinality: one` requiring `target_entity`.

**Root Cause**: `Array.isArray(['entityId'])` is true, so code assumed it should use `target_entities`.

**Fix**: Normalize single-element arrays:
```typescript
const isSingleElementArray = Array.isArray(target) && target.length === 1;
const targetEntity = isSingleElementArray ? target[0] : (Array.isArray(target) ? undefined : target);
const targetEntities = Array.isArray(target) && !isSingleElementArray ? target : undefined;
```

**Rule**: Single-element arrays should be treated as single entities for klados with `cardinality: one`.

---

### 5. Silent Handoff Failures

**Problem**: Handoff invocations could fail silently - the invokeTarget function returned `{ accepted: false }` but the caller didn't check.

**Root Cause**: Missing error handling after invoke call.

**Fix**: Check result and throw on failure:
```typescript
const result = await invokeTarget(...);
if (!result.accepted) {
  throw new Error(`Handoff invoke failed: ${result.error}`);
}
```

**Rule**: Always check `result.accepted` after invocations and surface errors.

---

### 6. Log Polling via Collection Query

**Problem**: `getWorkflowLogs` only found the first log because it relied on `first_log` relationship, but subsequent logs don't have direct relationships to the collection.

**Root Cause**: Second+ logs only have `received_from` relationships to parent logs, not to the collection.

**Fix**: Query collection for all klados_log entities:
```typescript
// Wrong - only finds first log
const firstLogRel = collection.relationships.find(r => r.predicate === 'first_log');

// Correct - finds all logs in collection
const response = await apiRequest('GET', `/collections/${collectionId}/entities?type=klados_log`);
```

**Rule**: Use collection entity queries to find all logs, not relationship traversal.

---

## General Patterns

### Debugging Workflow Issues

1. **Check the log status** - `done` vs `error` tells you if processing succeeded
2. **Check the log's handoffs** - Shows what was invoked and the request sent
3. **Check the log's error** - Contains specific error message if failed
4. **Check collection entity count** - Verify all expected logs exist
5. **Check entity permissions** - Verify klados has required permissions

### Permission Grant Checklist

For klados to work in workflows, it needs permissions on:

**Target Collection:**
- Entity types it processes (view, update, create as needed)

**Job Collection:**
- `klados_log:create`, `klados_log:view`, `klados_log:update`
- `batch:create`, `batch:view`, `batch:update` (for scatter/gather)
- `collection:view`, `collection:update`

**Klados Collection (for chaining):**
- `*:invoke` in public role
