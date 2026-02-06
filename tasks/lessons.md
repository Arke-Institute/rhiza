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

---

## 2026-02-05: Scatter Workflow & Permission Optimization

### 7. Permission Granting at Scale Causes CAS Conflicts

**Problem**: When scatter creates N outputs and invokes N kladoi concurrently, all N try to grant themselves permissions on the job_collection. They all read the same CID, so only 1 succeeds - the rest fail with CAS errors.

**Root Cause**: Each klados invocation was calling `grantKladosPermissions` which performs a CAS write. With concurrent invocations, only the first write succeeds.

**Fix**: Check permissions first, only grant if missing:
```typescript
// In klados invoke route
const permStatus = await checkKladosPermissions(storage, tip, jobCollectionId, kladosId);

if (!permStatus.hasPermission) {
  // Only grant if not already present (edge case)
  await grantKladosPermissions(...);
}
// Otherwise skip - rhiza already granted upfront
```

**Rule**: Always check before writing. Reads scale; concurrent writes don't.

---

### 8. Rhiza Grants ALL Klados Permissions Upfront

**Problem**: Assumed each klados needed to grant its own permissions during invocation.

**Discovery**: The rhiza invoke endpoint already:
1. Calls `collectFlowKladoi()` to gather ALL unique klados IDs from the flow
2. Grants ALL of them permissions on target_collection (single batch)
3. Grants ALL of them permissions on job_collection (single batch)

**Rule**: Rhiza handles bulk permission grants. Individual klados invocations should only check, not re-grant. The "grant with retry" path is only for edge cases (direct invocation without rhiza, expired permissions).

---

### 9. Use Entity IDs, Not Logical IDs, for Relationships

**Problem**: `sent_to` relationships were created with `fromLogId: this.logId` where `logId` was the logical ID like `log_xxx`, not the actual entity ID.

**Root Cause**: `KladosJob` stores both:
- `logId` - logical identifier (e.g., `log_65bba3f1-9e23-4179-8568-7aae22648e5e`)
- `logFileId` - actual entity ID (e.g., `IIKGQX29FWJWVG2B8KEPDJZ2MX`)

**Fix**: Use `logFileId` for relationships:
```typescript
// Wrong
fromLogId: this.logId  // "log_xxx" - not a valid entity ID!

// Correct
fromLogId: this.logFileId!  // "IIKGXXX..." - actual entity ID
```

**Rule**: Relationship peers must be actual entity IDs, not logical/semantic identifiers.

---

### 10. Verify Data via Relationships, Not Collection Listing

**Problem**: Test was calling `GET /collections/{id}/entities?type=test_entity` to find copies - this relies on indexes and isn't the "graph way".

**Correct Approach**: Traverse relationships from known entities:
```typescript
// Wrong - relies on index
const copies = await apiRequest('GET', `/collections/${colId}/entities?type=test_entity`);

// Correct - follows relationships
const original = await getEntity(originalId);
const copyRels = original.relationships.filter(r => r.predicate === 'has_copy');
for (const rel of copyRels) {
  const copy = await getEntity(rel.peer);
  // verify copy...
}
```

**Rule**: Use relationship traversal to verify data. Collection listing is for discovery, not verification.

---

### 11. Workers Must Declare ALL Required Permissions

**Problem**: Scatter worker created copies (needed `entity:create`) but then tried to update the original to add `has_copy` relationships (needed `entity:update`). Update failed with "Action 'entity:update' not allowed".

**Root Cause**: `agent.json` only declared `["entity:view", "entity:create"]`.

**Fix**: Declare all needed actions:
```json
{
  "actions_required": ["entity:view", "entity:create", "entity:update"]
}
```

**Rule**: Think through the full operation flow. If you create children AND update the parent to reference them, you need both `create` and `update`.

---

### 12. Copies Should Have Bidirectional Relationships

**Problem**: Scatter worker only stored `source_entity: targetId` as a property - no actual relationship.

**Correct Approach**: Create bidirectional relationships:
```typescript
// When creating copy
relationships: [
  { predicate: 'copy_of', peer: original.id, peer_type: original.type }
]

// After creating all copies, update original
relationships_add: copies.map(copyId => ({
  predicate: 'has_copy', peer: copyId, peer_type: 'test_entity'
}))
```

**Rule**: Always use relationships for entity connections, not just properties. Relationships enable graph traversal.

---

### 13. KladosLogger Has Limited Methods

**Problem**: Called `job.log.warn(...)` but got "job.log.warn is not a function".

**Available Methods**:
- `job.log.info(message, metadata?)`
- `job.log.error(message, metadata?)`
- `job.log.success(message, metadata?)`

**Rule**: No `warn` or `debug` levels in KladosLogger. Use `info` for warnings.

---

### 14. PUT /entities/{id} Requires expect_tip

**Problem**: Update call failed with `"expect_tip" required`.

**Root Cause**: CAS is mandatory for entity updates. Must fetch current tip first.

**Fix**:
```typescript
// First get the tip
const { data: tipData } = await client.api.GET('/entities/{id}/tip', {
  params: { path: { id: entityId } }
});

// Then update with expect_tip
await client.api.PUT('/entities/{id}', {
  params: { path: { id: entityId } },
  body: {
    expect_tip: tipData.cid,
    // ... your changes
  }
});
```

**Rule**: Always fetch tip before updates. CAS prevents lost updates.
