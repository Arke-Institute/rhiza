# API Changes (arke_v1)

## Overview

The Arke API needs new routes to support klados and rhiza entities. This document outlines the required changes to `/Users/chim/Working/arke_institute/arke_v1`.

**Key change:** Kladoi are now first-class entities, separate from rhizai.

---

## New Entity Types

### Klados Entity

A **klados** is a standalone, reusable action. It knows HOW to do something, but not WHAT comes next.

```typescript
{
  id: 'II01klados_ocr...',
  type: 'klados',
  properties: {
    label: 'OCR Service',
    description: 'Extracts text from images',
    endpoint: 'https://ocr.arke.institute',
    actions_required: ['file:view', 'entity:update'],
    accepts: { types: ['file/jpeg'], cardinality: 'one' },
    produces: { types: ['text/ocr'], cardinality: 'one' },
    input_schema: { /* optional JSON Schema */ },
    status: 'active',
    endpoint_verified_at: '2025-01-15T00:00:00Z',
  }
}
```

### Rhiza Entity

A **rhiza** composes kladoi into a workflow. It defines WHAT happens, in WHAT order.

```typescript
{
  id: 'II01rhiza_pdf...',
  type: 'rhiza',
  properties: {
    label: 'PDF Processing Pipeline',
    description: 'Processes PDFs through OCR and text assembly',
    version: '1.0',
    entry: 'II01klados_pdf...',      // Klados ID (not name)
    flow: {
      'II01klados_pdf...': { then: { scatter: 'II01klados_ocr...' } },
      'II01klados_ocr...': { then: { gather: 'II01klados_assembler...' } },
      'II01klados_assembler...': { then: { done: true } },
    },
    status: 'active',
  }
}
```

**Flow notes:**
- Target IDs can be klados OR rhiza (discovered at runtime via `validateRhizaRuntime`)
- Route conditions can be added for conditional branching: `{ scatter: 'default_id', route: [...] }`
- The klados fetches the rhiza entity itself to get the flow definition; we only pass the path so it knows which instance it is if the same klados appears multiple times

---

## New Files

### `src/profiles/klados/`

```
src/profiles/klados/
├── types.ts        # Klados entity types
├── operations.ts   # CRUD + invoke operations
├── validation.ts   # Klados validation
└── index.ts        # Exports
```

### `src/profiles/rhiza/`

```
src/profiles/rhiza/
├── types.ts        # Rhiza entity types
├── operations.ts   # CRUD + invoke operations
├── validation.ts   # Rhiza validation
└── index.ts        # Exports
```

### `src/routes/kladoi.ts`

New route file for klados endpoints.

### `src/routes/rhizai.ts`

New route file for rhiza endpoints.

---

## Klados Routes

### Invocation Modes

The `/kladoi/:id/invoke` endpoint handles two invocation modes:

| Mode | `job_collection` | `rhiza_context` | Job Collection Created By |
|------|------------------|-----------------|---------------------------|
| **Standalone** | Not provided | Not provided | API creates it |
| **Workflow** | Provided | Provided | Parent rhiza invoke |

**Standalone invocation**: User calls `/kladoi/:id/invoke` directly to run a single action. The API creates a job collection automatically.

**Workflow invocation**: Called by the rhiza invoke endpoint (for entry klados) or by another klados during handoff. The job collection and rhiza context are passed through.

### `src/routes/kladoi.ts`

```typescript
/**
 * Klados (Action) Routes
 *
 * POST   /kladoi              - Create a klados
 * GET    /kladoi/:id          - Get klados by ID
 * PUT    /kladoi/:id          - Update klados
 * DELETE /kladoi/:id          - Delete klados
 * POST   /kladoi/:id/invoke   - Invoke a klados (standalone or workflow context)
 * GET    /kladoi/:id/jobs/:job_id/status - Get job status
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { IManifestStorage, ITipService } from '@/core/storage/interfaces';
import {
  createKlados,
  getKlados,
  updateKlados,
  deleteKlados,
  KLADOS_TYPE,
} from '@/profiles/klados';
import { grantKladosPermissions, invokeKladosEndpoint } from '@/profiles/klados';
import { createRootJobCollection } from '@/profiles/job_collection';
import { generateId } from '@/utils/ulid';
import { requireAuth, getActor } from '@/auth';
import { requireAction } from '@/permissions';
import type { ExecutionContext } from '@/schema/operations';

export interface KladoiRoutesConfig {
  storage: IManifestStorage;
  tip: ITipService;
  executionContext: ExecutionContext;
  signingPrivateKey: string;
}

export function createKladoiRoutes(config: KladoiRoutesConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { storage, tip, executionContext, signingPrivateKey } = config;

  app.use('*', requireAuth);

  // ─────────────────────────────────────────────────────────────────────────
  // POST / - Create klados
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/', async (c) => {
    const actor = getActor(c);
    const body = await c.req.json();

    // Permission check on collection
    await requireAction(
      { storage, tip },
      actor.pi,
      { id: body.collection, type: 'collection' },
      'klados:create'
    );

    const result = await createKlados(storage, tip, {
      id: body.id,
      label: body.label,
      description: body.description,
      endpoint: body.endpoint,
      actions_required: body.actions_required,
      accepts: body.accepts,
      produces: body.produces,
      input_schema: body.input_schema,
      collection: body.collection,
      edited_by: { user_id: actor.pi, method: 'manual' },
      note: body.note,
    }, executionContext);

    return c.json(result, 201);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /:id - Get klados
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);

    await requireAction({ storage, tip }, actor.pi, { id, type: KLADOS_TYPE }, 'klados:view');

    const { cid, manifest } = await getKlados(storage, tip, id);

    return c.json({
      id: manifest.id,
      cid,
      type: manifest.type,
      properties: manifest.properties,
      relationships: manifest.relationships,
      ver: manifest.ver,
      created_at: manifest.created_at,
      ts: manifest.ts,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /:id - Update klados
  // ─────────────────────────────────────────────────────────────────────────
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);
    const body = await c.req.json();

    await requireAction({ storage, tip }, actor.pi, { id, type: KLADOS_TYPE }, 'klados:update');

    const result = await updateKlados(storage, tip, id, {
      expect_tip: body.expect_tip,
      label: body.label,
      description: body.description,
      endpoint: body.endpoint,
      actions_required: body.actions_required,
      accepts: body.accepts,
      produces: body.produces,
      input_schema: body.input_schema,
      status: body.status,
      edited_by: { user_id: actor.pi, method: 'manual' },
      note: body.note,
    }, executionContext);

    return c.json(result);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /:id - Delete klados
  // ─────────────────────────────────────────────────────────────────────────
  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);

    await requireAction({ storage, tip }, actor.pi, { id, type: KLADOS_TYPE }, 'klados:delete');

    await deleteKlados(storage, tip, id, {
      edited_by: { user_id: actor.pi, method: 'manual' },
    }, executionContext);

    return c.json({ deleted: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /:id/invoke - Invoke klados
  //
  // Two modes:
  // 1. STANDALONE: User invokes klados directly (no job_collection, no rhiza_context)
  //    - API creates job collection
  //    - API grants permissions
  //    - Two-phase confirmation flow
  //
  // 2. WORKFLOW: Called by rhiza invoke or klados handoff (job_collection + rhiza_context provided)
  //    - Job collection already exists
  //    - Permissions already granted by rhiza invoke
  //    - No confirmation needed (already confirmed at rhiza level)
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/:id/invoke', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);
    const body = await c.req.json();

    // Get klados
    const { manifest: kladosManifest } = await getKlados(storage, tip, id);

    if (kladosManifest.properties.status !== 'active') {
      throw new HTTPException(400, {
        message: `Klados is not active (status: ${kladosManifest.properties.status})`,
      });
    }

    // Determine invocation mode
    const isWorkflowContext = !!body.job_collection && !!body.rhiza_context;

    // For standalone invocations, require klados:invoke permission
    // For workflow context, permissions were already checked at rhiza invoke
    if (!isWorkflowContext) {
      await requireAction({ storage, tip }, actor.pi, { id, type: KLADOS_TYPE }, 'klados:invoke');
    }

    const expiresIn = body.expires_in ?? 3600;
    const expiresAt = body.expires_at ?? new Date(Date.now() + expiresIn * 1000).toISOString();

    // Two-phase confirmation (standalone only)
    if (!isWorkflowContext && !body.confirm) {
      return c.json({
        status: 'pending_confirmation',
        message: `Klados "${kladosManifest.properties.label}" will be granted access to target`,
        grants: [{
          klados: { id, label: kladosManifest.properties.label },
          actions: kladosManifest.properties.actions_required,
        }],
        expires_at: expiresAt,
      });
    }

    // For standalone: grant permissions and create job collection
    let jobCollection = body.job_collection;
    const jobId = body.job_id ?? `job_${generateId()}`;

    if (!isWorkflowContext) {
      // Standalone: check permission on target and grant to klados
      await requireAction(
        { storage, tip },
        actor.pi,
        { id: body.target, type: 'entity' },
        'entity:manage'
      );

      await grantKladosPermissions(
        storage,
        tip,
        body.target,
        id,
        kladosManifest.properties.actions_required,
        expiresAt,
        { user_id: actor.pi, method: 'system' },
        executionContext
      );

      // Standalone: create job collection
      const jc = await createRootJobCollection(storage, tip, {
        jobId,
        invokingUserId: actor.pi,
        mainKladosId: id,
        targetId: body.target,
        editInfo: { user_id: actor.pi, method: 'system' },
      }, executionContext);
      jobCollection = jc.id;
    }

    // Build request
    const requestUrl = new URL(c.req.url);
    const arkeApiBase = body.api_base ?? `${requestUrl.protocol}//${requestUrl.host}`;
    const network = body.network ?? (c.req.header('X-Arke-Network') === 'test' ? 'test' : 'main');

    const kladosRequest = {
      job_id: jobId,
      target: body.target,
      job_collection: jobCollection,
      input: body.input,
      api_base: arkeApiBase,
      expires_at: expiresAt,
      network,
      // Workflow context (only present when invoked as part of rhiza)
      // Note: batch info is inside rhiza context if present (not separate)
      rhiza: body.rhiza_context,
    };

    // Invoke klados endpoint
    const kladosResponse = await invokeKladosEndpoint(
      kladosManifest,
      kladosRequest,
      signingPrivateKey
    );

    if (!kladosResponse.accepted) {
      return c.json({
        status: 'rejected',
        error: kladosResponse.error ?? 'Klados rejected the job',
        job_id: jobId,
      }, 202);
    }

    return c.json({
      status: 'started',
      job_id: jobId,
      job_collection: jobCollection,
      klados_id: id,
      expires_at: expiresAt,
    }, 202);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /:id/jobs/:job_id/status - Get job status
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/:id/jobs/:job_id/status', async (c) => {
    const kladosId = c.req.param('id');
    const jobId = c.req.param('job_id');

    // Find job collection and return status
    // ... implementation

    return c.json({
      job_id: jobId,
      klados_id: kladosId,
      status: 'running',
    });
  });

  return app;
}
```

---

## Rhiza Routes

### `src/routes/rhizai.ts`

```typescript
/**
 * Rhiza (Workflow) Routes
 *
 * POST   /rhizai              - Create a rhiza
 * GET    /rhizai/:id          - Get rhiza by ID
 * PUT    /rhizai/:id          - Update rhiza
 * DELETE /rhizai/:id          - Delete rhiza
 * POST   /rhizai/:id/invoke   - Invoke a rhiza (workflow)
 * GET    /rhizai/:id/jobs/:job_id/status - Get workflow status
 * POST   /rhizai/:id/jobs/:job_id/resume - Resume failed workflow
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { IManifestStorage, ITipService } from '@/core/storage/interfaces';
import {
  createRhiza,
  getRhiza,
  updateRhiza,
  deleteRhiza,
  RHIZA_TYPE,
} from '@/profiles/rhiza';
import { getKlados, grantKladosPermissions, invokeKladosEndpoint } from '@/profiles/klados';
import { grantRhizaPermissions } from '@/profiles/rhiza'; // For sub-workflow permissions
import { createRootJobCollection } from '@/profiles/job_collection';
import { validateRhizaRuntime } from '@arke-institute/rhiza';
import { generateId } from '@/utils/ulid';
import { requireAuth, getActor } from '@/auth';
import { requireAction } from '@/permissions';
import type { ExecutionContext } from '@/schema/operations';

export interface RhizaiRoutesConfig {
  storage: IManifestStorage;
  tip: ITipService;
  executionContext: ExecutionContext;
  signingPrivateKey: string;
}

export function createRhizaiRoutes(config: RhizaiRoutesConfig): OpenAPIHono {
  const app = new OpenAPIHono();
  const { storage, tip, executionContext, signingPrivateKey } = config;

  app.use('*', requireAuth);

  // ─────────────────────────────────────────────────────────────────────────
  // POST / - Create rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/', async (c) => {
    const actor = getActor(c);
    const body = await c.req.json();

    await requireAction(
      { storage, tip },
      actor.pi,
      { id: body.collection, type: 'collection' },
      'rhiza:create'
    );

    const result = await createRhiza(storage, tip, {
      id: body.id,
      label: body.label,
      description: body.description,
      version: body.version,
      entry: body.entry,
      flow: body.flow,
      collection: body.collection,
      edited_by: { user_id: actor.pi, method: 'manual' },
      note: body.note,
    }, executionContext);

    return c.json(result, 201);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /:id - Get rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);

    await requireAction({ storage, tip }, actor.pi, { id, type: RHIZA_TYPE }, 'rhiza:view');

    const { cid, manifest } = await getRhiza(storage, tip, id);

    return c.json({
      id: manifest.id,
      cid,
      type: manifest.type,
      properties: manifest.properties,
      relationships: manifest.relationships,
      ver: manifest.ver,
      created_at: manifest.created_at,
      ts: manifest.ts,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /:id - Update rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);
    const body = await c.req.json();

    await requireAction({ storage, tip }, actor.pi, { id, type: RHIZA_TYPE }, 'rhiza:update');

    const result = await updateRhiza(storage, tip, id, {
      expect_tip: body.expect_tip,
      label: body.label,
      description: body.description,
      version: body.version,
      status: body.status,
      entry: body.entry,
      flow: body.flow,
      edited_by: { user_id: actor.pi, method: 'manual' },
      note: body.note,
    }, executionContext);

    return c.json(result);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /:id - Delete rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);

    await requireAction({ storage, tip }, actor.pi, { id, type: RHIZA_TYPE }, 'rhiza:delete');

    await deleteRhiza(storage, tip, id, {
      edited_by: { user_id: actor.pi, method: 'manual' },
    }, executionContext);

    return c.json({ deleted: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /:id/invoke - Invoke rhiza
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/:id/invoke', async (c) => {
    const id = c.req.param('id');
    const actor = getActor(c);
    const body = await c.req.json();

    // Get rhiza
    const { manifest: rhizaManifest } = await getRhiza(storage, tip, id);

    if (rhizaManifest.properties.status !== 'active') {
      throw new HTTPException(400, {
        message: `Rhiza is not active (status: ${rhizaManifest.properties.status})`,
      });
    }

    // Permission check
    await requireAction({ storage, tip }, actor.pi, { id, type: RHIZA_TYPE }, 'rhiza:invoke');

    // Runtime validation - load all referenced entities and check compatibility
    // Note: validateRhizaRuntime returns both `kladoi` and `rhizai` maps since
    // flow targets can be either klados (direct action) or rhiza (sub-workflow).
    // Target types are discovered at load time by fetching each entity.
    const runtimeValidation = await validateRhizaRuntime(
      // Pass a client-like interface for loading kladoi and rhizai
      {
        api: {
          GET: async (path: string, options: any) => {
            const entityId = options.params.path.id;
            // Try loading as klados first, then as rhiza
            if (path.includes('/kladoi/')) {
              const { manifest } = await getKlados(storage, tip, entityId);
              return { data: manifest };
            }
            if (path.includes('/rhizai/')) {
              const { manifest } = await getRhiza(storage, tip, entityId);
              return { data: manifest };
            }
            throw new Error(`Unexpected path: ${path}`);
          },
        },
      } as any,
      rhizaManifest.properties
    );

    if (!runtimeValidation.valid) {
      throw new HTTPException(400, {
        message: `Rhiza validation failed: ${runtimeValidation.errors.map(e => e.message).join(', ')}`,
      });
    }

    // Get all klados IDs from validation results (excludes sub-rhizai)
    const allKladosIds = Array.from(runtimeValidation.kladoi.keys());

    // Build grant info
    const expiresIn = body.expires_in ?? 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Two-phase: preview vs confirmed
    if (!body.confirm) {
      // Build grants for kladoi
      const kladosGrants = Array.from(runtimeValidation.kladoi.entries()).map(
        ([kladosId, klados]) => ({
          type: 'klados' as const,
          id: kladosId,
          label: klados.properties.label,
          actions: klados.properties.actions_required,
        })
      );

      // Build grants for sub-rhizai (they will recursively grant their own kladoi)
      const rhizaGrants = Array.from(runtimeValidation.rhizai.entries()).map(
        ([rhizaId, rhiza]) => ({
          type: 'rhiza' as const,
          id: rhizaId,
          label: rhiza.properties.label,
          // Sub-rhizai grant their own permissions when invoked
        })
      );

      return c.json({
        status: 'pending_confirmation',
        message: `Workflow "${rhizaManifest.properties.label}" will be granted access to target`,
        grants: [...kladosGrants, ...rhizaGrants],
        expires_at: expiresAt,
      });
    }

    // Confirmed - grant permissions and invoke

    // Check permission on target
    await requireAction(
      { storage, tip },
      actor.pi,
      { id: body.target, type: 'entity' },
      'entity:manage'
    );

    // Grant permissions to all kladoi in this rhiza
    for (const kladosId of allKladosIds) {
      const klados = runtimeValidation.kladoi.get(kladosId)!;
      await grantKladosPermissions(
        storage,
        tip,
        body.target,
        kladosId,
        klados.properties.actions_required,
        expiresAt,
        { user_id: actor.pi, method: 'system' },
        executionContext
      );
    }

    // Note: Sub-rhizai (targets that are rhiza entities) will grant their own
    // permissions when they are invoked. We don't pre-grant here because:
    // 1. Sub-rhizai may have dynamic permission requirements
    // 2. It keeps permission granting scoped to immediate execution
    // 3. The parent rhiza just invokes the sub-rhiza, which handles its own grants

    // Create job collection
    const jobId = `job_${generateId()}`;
    const entryKladosId = rhizaManifest.properties.entry;

    const jobCollection = await createRootJobCollection(storage, tip, {
      jobId,
      invokingUserId: actor.pi,
      mainKladosId: entryKladosId,
      targetId: body.target,
      rhizaId: id,
      editInfo: { user_id: actor.pi, method: 'system' },
    }, executionContext);

    // Build request
    const requestUrl = new URL(c.req.url);
    const arkeApiBase = `${requestUrl.protocol}//${requestUrl.host}`;
    const network = c.req.header('X-Arke-Network') === 'test' ? 'test' : 'main';

    // Build flow for passing to klados
    const flow = rhizaManifest.properties.flow;

    const kladosRequest = {
      job_id: jobId,
      target: body.target,
      job_collection: jobCollection.id,
      input: body.input,
      api_base: arkeApiBase,
      expires_at: expiresAt,
      network,
      // Rhiza context - klados will fetch rhiza entity itself for flow definition
      // We only pass the path (how we got here) so it knows which instance it is
      // if the same klados appears multiple times in the flow
      rhiza: {
        id,
        path: [entryKladosId],  // Path of klados IDs from entry to current
        parent_logs: [],         // Immediate parent log IDs (empty for entry)
        // batch is optional, added when part of scatter/gather
      },
    };

    // Get entry klados manifest
    const entryKlados = runtimeValidation.kladoi.get(entryKladosId)!;

    // Invoke entry klados
    const kladosResponse = await invokeKladosEndpoint(
      entryKlados,
      kladosRequest,
      signingPrivateKey
    );

    if (!kladosResponse.accepted) {
      return c.json({
        status: 'rejected',
        error: kladosResponse.error ?? 'Entry klados rejected the job',
        job_id: jobId,
      }, 202);
    }

    return c.json({
      status: 'started',
      job_id: jobId,
      job_collection: jobCollection.id,
      rhiza_id: id,
      expires_at: expiresAt,
    }, 202);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /:id/jobs/:job_id/status - Get workflow status
  // ─────────────────────────────────────────────────────────────────────────
  app.get('/:id/jobs/:job_id/status', async (c) => {
    const rhizaId = c.req.param('id');
    const jobId = c.req.param('job_id');

    // Use rhiza package to build status from logs
    // const status = await buildStatusFromLogs(client, jobCollectionId);

    return c.json({
      job_id: jobId,
      rhiza_id: rhizaId,
      status: 'running',
      progress: { total: 0, pending: 0, running: 0, done: 0, error: 0 },
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /:id/jobs/:job_id/resume - Resume failed workflow
  // ─────────────────────────────────────────────────────────────────────────
  app.post('/:id/jobs/:job_id/resume', async (c) => {
    const rhizaId = c.req.param('id');
    const jobId = c.req.param('job_id');
    const body = await c.req.json();

    // Use rhiza package to resume
    // const result = await resumeWorkflow(client, jobCollectionId, body);

    return c.json({
      resumed: 0,
      skipped: 0,
      jobs: [],
    });
  });

  return app;
}
```

---

## Klados Profile

### `src/profiles/klados/types.ts`

```typescript
import type { ContractSpec } from '@arke-institute/rhiza';

export const KLADOS_TYPE = 'klados';

export interface KladosProperties {
  label: string;
  description?: string;
  endpoint: string;
  actions_required: string[];
  accepts: ContractSpec;
  produces: ContractSpec;
  input_schema?: Record<string, unknown>;
  status: 'development' | 'active' | 'disabled';
  endpoint_verified_at?: string;
  created_at: string;
  updated_at: string;
}

export interface KladosManifest {
  id: string;
  type: typeof KLADOS_TYPE;
  properties: KladosProperties;
  relationships: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
    peer_label?: string;
    properties?: Record<string, unknown>;
  }>;
  ver: number;
  created_at: string;
  ts: string;
  edited_by?: {
    user_id: string;
    method: string;
  };
}
```

### `src/profiles/klados/operations.ts`

```typescript
import type { IManifestStorage, ITipService } from '@/core/storage/interfaces';
import type { ExecutionContext, EditInfo } from '@/schema/operations';
import type { KladosManifest, KladosProperties } from './types';
import { KLADOS_TYPE } from './types';
import { validateKladosProperties } from '@arke-institute/rhiza';
import { NotFoundError, ValidationError } from '@/errors';
import { generateId } from '@/utils/ulid';
import { signRequest } from '@/utils/signing';

export async function createKlados(
  storage: IManifestStorage,
  tip: ITipService,
  params: {
    id?: string;
    label: string;
    description?: string;
    endpoint: string;
    actions_required: string[];
    accepts: { types: string[]; cardinality: 'one' | 'many' };
    produces: { types: string[]; cardinality: 'one' | 'many' };
    input_schema?: Record<string, unknown>;
    collection: string;
    edited_by: EditInfo;
    note?: string;
  },
  executionContext: ExecutionContext
): Promise<{ id: string; cid: string; manifest: KladosManifest }> {
  const id = params.id ?? `II${generateId()}`;
  const now = new Date().toISOString();

  // Validate
  const validation = validateKladosProperties({
    label: params.label,
    endpoint: params.endpoint,
    actions_required: params.actions_required,
    accepts: params.accepts,
    produces: params.produces,
  });

  if (!validation.valid) {
    throw new ValidationError(
      `Invalid klados: ${validation.errors.map(e => e.message).join(', ')}`
    );
  }

  const properties: KladosProperties = {
    label: params.label,
    description: params.description,
    endpoint: params.endpoint,
    actions_required: params.actions_required,
    accepts: params.accepts,
    produces: params.produces,
    input_schema: params.input_schema,
    status: 'development',
    created_at: now,
    updated_at: now,
  };

  const manifest: KladosManifest = {
    id,
    type: KLADOS_TYPE,
    properties,
    relationships: [],
    ver: 1,
    created_at: now,
    ts: now,
    edited_by: params.edited_by,
  };

  const cid = await storage.writeManifest(manifest);
  await tip.writeTip(id, cid);

  // Add to collection...

  return { id, cid, manifest };
}

export async function getKlados(
  storage: IManifestStorage,
  tip: ITipService,
  id: string
): Promise<{ cid: string; manifest: KladosManifest }> {
  const cid = await tip.readTipOrNull(id);
  if (!cid) {
    throw new NotFoundError(`Klados ${id} not found`);
  }

  const manifest = (await storage.readManifest(cid)) as KladosManifest;
  if (manifest.type !== KLADOS_TYPE) {
    throw new ValidationError(`Entity ${id} is not a klados`);
  }

  return { cid, manifest };
}

export async function updateKlados(
  storage: IManifestStorage,
  tip: ITipService,
  id: string,
  params: {
    expect_tip: string;
    label?: string;
    description?: string;
    endpoint?: string;
    actions_required?: string[];
    accepts?: { types: string[]; cardinality: 'one' | 'many' };
    produces?: { types: string[]; cardinality: 'one' | 'many' };
    input_schema?: Record<string, unknown>;
    status?: 'development' | 'active' | 'disabled';
    edited_by: EditInfo;
    note?: string;
  },
  executionContext: ExecutionContext
): Promise<{ id: string; cid: string; manifest: KladosManifest; prev_cid: string }> {
  const { cid: currentCid, manifest: current } = await getKlados(storage, tip, id);

  if (currentCid !== params.expect_tip) {
    throw new ValidationError('Conflict: entity has been modified');
  }

  const now = new Date().toISOString();

  const properties: KladosProperties = {
    ...current.properties,
    ...(params.label !== undefined && { label: params.label }),
    ...(params.description !== undefined && { description: params.description }),
    ...(params.endpoint !== undefined && { endpoint: params.endpoint }),
    ...(params.actions_required !== undefined && { actions_required: params.actions_required }),
    ...(params.accepts !== undefined && { accepts: params.accepts }),
    ...(params.produces !== undefined && { produces: params.produces }),
    ...(params.input_schema !== undefined && { input_schema: params.input_schema }),
    ...(params.status !== undefined && { status: params.status }),
    updated_at: now,
  };

  // Re-validate if critical fields changed
  if (
    params.endpoint !== undefined ||
    params.accepts !== undefined ||
    params.produces !== undefined ||
    params.actions_required !== undefined
  ) {
    const validation = validateKladosProperties(properties);
    if (!validation.valid) {
      throw new ValidationError(
        `Invalid klados: ${validation.errors.map(e => e.message).join(', ')}`
      );
    }
  }

  const manifest: KladosManifest = {
    ...current,
    properties,
    ver: current.ver + 1,
    ts: now,
    edited_by: params.edited_by,
  };

  const cid = await storage.writeManifest(manifest);
  await tip.writeTip(id, cid);

  return { id, cid, manifest, prev_cid: currentCid };
}

export async function deleteKlados(
  storage: IManifestStorage,
  tip: ITipService,
  id: string,
  params: { edited_by: EditInfo },
  executionContext: ExecutionContext
): Promise<void> {
  // Soft delete by setting status to disabled
  const { cid } = await getKlados(storage, tip, id);
  await updateKlados(storage, tip, id, {
    expect_tip: cid,
    status: 'disabled',
    edited_by: params.edited_by,
  }, executionContext);
}

export async function grantKladosPermissions(
  storage: IManifestStorage,
  tip: ITipService,
  targetId: string,
  kladosId: string,
  actions: string[],
  expiresAt: string,
  editInfo: EditInfo,
  executionContext: ExecutionContext
): Promise<void> {
  // Grant permissions to klados on target
  // Implementation depends on Arke permission system
}

export async function invokeKladosEndpoint(
  kladosManifest: KladosManifest,
  request: Record<string, unknown>,
  signingPrivateKey: string
): Promise<{ accepted: boolean; job_id?: string; error?: string }> {
  const endpoint = kladosManifest.properties.endpoint;

  // Sign the request
  const signature = signRequest(request, signingPrivateKey);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Arke-Signature': signature,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      return { accepted: false, error };
    }

    const data = await response.json();
    return {
      accepted: data.accepted ?? true,
      job_id: data.job_id,
      error: data.error,
    };
  } catch (e) {
    return {
      accepted: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}
```

---

## Rhiza Profile

### `src/profiles/rhiza/types.ts`

```typescript
import type { FlowStep } from '@arke-institute/rhiza';

export const RHIZA_TYPE = 'rhiza';

export interface RhizaProperties {
  label: string;
  description?: string;
  version: string;
  entry: string; // Entry klados ID (must be klados, not rhiza)
  flow: Record<string, FlowStep>; // Klados/Rhiza ID → handoff spec (targets can be klados or rhiza)
  status: 'development' | 'active' | 'disabled';
  created_at: string;
  updated_at: string;
}

export interface RhizaManifest {
  id: string;
  type: typeof RHIZA_TYPE;
  properties: RhizaProperties;
  relationships: Array<{
    predicate: string;
    peer: string;
    peer_type?: string;
    peer_label?: string;
    properties?: Record<string, unknown>;
  }>;
  ver: number;
  created_at: string;
  ts: string;
  edited_by?: {
    user_id: string;
    method: string;
  };
}
```

### `src/profiles/rhiza/operations.ts`

```typescript
import type { IManifestStorage, ITipService } from '@/core/storage/interfaces';
import type { ExecutionContext, EditInfo } from '@/schema/operations';
import type { RhizaManifest, RhizaProperties } from './types';
import { RHIZA_TYPE } from './types';
import { validateRhizaProperties } from '@arke-institute/rhiza';
import { NotFoundError, ValidationError } from '@/errors';
import { generateId } from '@/utils/ulid';

export async function createRhiza(
  storage: IManifestStorage,
  tip: ITipService,
  params: {
    id?: string;
    label: string;
    description?: string;
    version: string;
    entry: string;
    flow: Record<string, { then: unknown }>;
    collection: string;
    edited_by: EditInfo;
    note?: string;
  },
  executionContext: ExecutionContext
): Promise<{ id: string; cid: string; manifest: RhizaManifest }> {
  const id = params.id ?? `II${generateId()}`;
  const now = new Date().toISOString();

  // Validate
  const validation = validateRhizaProperties({
    label: params.label,
    version: params.version,
    entry: params.entry,
    flow: params.flow as any,
  });

  if (!validation.valid) {
    throw new ValidationError(
      `Invalid rhiza: ${validation.errors.map(e => e.message).join(', ')}`
    );
  }

  const properties: RhizaProperties = {
    label: params.label,
    description: params.description,
    version: params.version,
    entry: params.entry,
    flow: params.flow as any,
    status: 'development',
    created_at: now,
    updated_at: now,
  };

  const manifest: RhizaManifest = {
    id,
    type: RHIZA_TYPE,
    properties,
    relationships: [],
    ver: 1,
    created_at: now,
    ts: now,
    edited_by: params.edited_by,
  };

  const cid = await storage.writeManifest(manifest);
  await tip.writeTip(id, cid);

  return { id, cid, manifest };
}

export async function getRhiza(
  storage: IManifestStorage,
  tip: ITipService,
  id: string
): Promise<{ cid: string; manifest: RhizaManifest }> {
  const cid = await tip.readTipOrNull(id);
  if (!cid) {
    throw new NotFoundError(`Rhiza ${id} not found`);
  }

  const manifest = (await storage.readManifest(cid)) as RhizaManifest;
  if (manifest.type !== RHIZA_TYPE) {
    throw new ValidationError(`Entity ${id} is not a rhiza`);
  }

  return { cid, manifest };
}

export async function updateRhiza(
  storage: IManifestStorage,
  tip: ITipService,
  id: string,
  params: {
    expect_tip: string;
    label?: string;
    description?: string;
    version?: string;
    status?: 'development' | 'active' | 'disabled';
    entry?: string;
    flow?: Record<string, { then: unknown }>;
    edited_by: EditInfo;
    note?: string;
  },
  executionContext: ExecutionContext
): Promise<{ id: string; cid: string; manifest: RhizaManifest; prev_cid: string }> {
  const { cid: currentCid, manifest: current } = await getRhiza(storage, tip, id);

  if (currentCid !== params.expect_tip) {
    throw new ValidationError('Conflict: entity has been modified');
  }

  const now = new Date().toISOString();

  const properties: RhizaProperties = {
    ...current.properties,
    ...(params.label !== undefined && { label: params.label }),
    ...(params.description !== undefined && { description: params.description }),
    ...(params.version !== undefined && { version: params.version }),
    ...(params.status !== undefined && { status: params.status }),
    ...(params.entry !== undefined && { entry: params.entry }),
    ...(params.flow !== undefined && { flow: params.flow as any }),
    updated_at: now,
  };

  // Re-validate if flow/entry changed
  if (params.entry !== undefined || params.flow !== undefined) {
    const validation = validateRhizaProperties(properties);
    if (!validation.valid) {
      throw new ValidationError(
        `Invalid rhiza: ${validation.errors.map(e => e.message).join(', ')}`
      );
    }
  }

  // Can only activate if valid
  if (params.status === 'active') {
    const validation = validateRhizaProperties(properties);
    if (!validation.valid) {
      throw new ValidationError(
        `Cannot activate rhiza: ${validation.errors.map(e => e.message).join(', ')}`
      );
    }
  }

  const manifest: RhizaManifest = {
    ...current,
    properties,
    ver: current.ver + 1,
    ts: now,
    edited_by: params.edited_by,
  };

  const cid = await storage.writeManifest(manifest);
  await tip.writeTip(id, cid);

  return { id, cid, manifest, prev_cid: currentCid };
}

export async function deleteRhiza(
  storage: IManifestStorage,
  tip: ITipService,
  id: string,
  params: { edited_by: EditInfo },
  executionContext: ExecutionContext
): Promise<void> {
  const { cid } = await getRhiza(storage, tip, id);
  await updateRhiza(storage, tip, id, {
    expect_tip: cid,
    status: 'disabled',
    edited_by: params.edited_by,
  }, executionContext);
}
```

---

## Schema Changes

### New Entity Types

| Type | Description |
|------|-------------|
| `klados` | Standalone action entity |
| `rhiza` | Workflow entity |
| `batch` | Scatter/gather coordination entity |
| `klados_log` | Log entry entity |

### New Relationship Predicates

| Predicate | Description |
|-----------|-------------|
| `received_from` | Log chain: child → parent log (only relationship for handoffs) |
| `runs_klados` | Job collection → klados being executed |
| `runs_rhiza` | Job collection → rhiza being executed |

**Note on fire-and-forget architecture:** With the simplified handoff model, only `received_from` exists for tracking handoffs. Parents do not track children (no `handed_off_to` predicate). This means:
- Children always know their parent via `received_from`
- Parents don't maintain references to children they spawned
- Status reconstruction uses `received_from` relationships to build the tree

---

## Permission Actions

### Klados Actions

| Action | Description |
|--------|-------------|
| `klados:create` | Create a klados |
| `klados:view` | View a klados |
| `klados:update` | Update a klados |
| `klados:delete` | Delete a klados |
| `klados:invoke` | Invoke a klados |
| `klados:manage` | Full control |

### Rhiza Actions

| Action | Description |
|--------|-------------|
| `rhiza:create` | Create a rhiza |
| `rhiza:view` | View a rhiza |
| `rhiza:update` | Update a rhiza |
| `rhiza:delete` | Delete a rhiza |
| `rhiza:invoke` | Invoke a rhiza |
| `rhiza:manage` | Full control |

---

## Migration from Agents

### Relationship to Existing Agent System

| Old Concept | New Concept | Notes |
|-------------|-------------|-------|
| Agent entity | Klados entity | Kladoi are similar but with explicit contracts |
| `/agents/:id/invoke` | `/kladoi/:id/invoke` | Same pattern, new endpoint |
| Agent permissions | Klados permissions | Same permission system |
| N/A | Rhiza entity | New workflow composition layer |
| N/A | `/rhizai/:id/invoke` | New workflow invocation |

### Migration Path

1. **No breaking changes** - Existing agent system continues to work
2. **Parallel systems** - Kladoi and agents coexist
3. **Gradual adoption** - Can create kladoi from existing agents
4. **Shared infrastructure** - Uses same job collections, permissions, signing

---

## Verification System

Kladoi inherit the same dual verification system used by agents. This ensures:
1. Only the klados developer can register an endpoint URL
2. Only Arke can invoke a klados

See `reference/agent-verification.md` for the complete verification system documentation.

### Klados Verification Routes

#### `POST /kladoi/:id/verify`

Two-phase endpoint ownership verification:

```typescript
// Phase 1: Request verification token
// POST /kladoi/:id/verify
// Body: {}
// Response: { verification_token, agent_id, endpoint, instructions, expires_at }

// Phase 2: Confirm verification
// POST /kladoi/:id/verify
// Body: { confirm: true }
// Response: { verified: true, verified_at } or { verified: false, error, message }
```

**Route implementation:**

```typescript
const verifyKladosRoute = arkeRoute({
  method: 'post',
  path: '/{id}/verify',
  action: 'klados:manage',
  auth: 'required',
  tags: ['Kladoi'],
  summary: 'Verify klados endpoint ownership',
  description: `
Verify that you control the klados's endpoint URL.

**Two-phase flow:**
1. Call without \`confirm\` to get a verification token
2. Deploy \`/.well-known/arke-verification\` endpoint returning the token
3. Call with \`confirm: true\` to complete verification
  `.trim(),
});
```

### Request Signature Verification

When Arke invokes a klados endpoint, it signs the request using Ed25519:

```
POST /process
Content-Type: application/json
X-Arke-Signature: t=<unix_timestamp>,v1=<base64_signature>
X-Arke-Request-Id: req_<ulid>

{
  "job_id": "job_...",
  "target": "II...",
  "job_collection": "II...",
  ...
}
```

**Signature format:** `{timestamp}.{JSON_body}`

### Public Key Endpoint

Arke exposes its signing public key at:

```
GET /.well-known/signing-key

{
  "public_key": "<base64_ed25519_public_key>",
  "algorithm": "Ed25519",
  "key_id": "<key_identifier>"
}
```

Kladoi fetch and cache this key (1-hour TTL) to verify incoming requests.

### Verification Properties

The `KladosProperties` includes verification state:

```typescript
interface KladosProperties {
  // ... other properties ...

  /** Status - cannot be 'active' without endpoint_verified_at */
  status: 'development' | 'active' | 'disabled';

  /** When endpoint was verified (ISO 8601) */
  endpoint_verified_at?: string;
}
```

**Verification rules:**
- New kladoi start with `status: 'development'`
- Setting `status: 'active'` requires `endpoint_verified_at` to be set
- Changing the endpoint clears `endpoint_verified_at` and resets status to `development`

### Verification Token Storage

Tokens are stored in D1:

```sql
CREATE TABLE klados_verification_tokens (
  klados_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

- Token prefix: `vt_`
- Token TTL: 1 hour
- Tokens are deleted after successful verification

---

## klados-core Package

A new package replaces `agent-core` for klados implementations:

```
@arke-institute/klados-core/
├── src/
│   ├── router.ts       # Standard Hono router factory
│   ├── verify.ts       # Arke signature verification
│   ├── types.ts        # TypeScript types
│   ├── register/       # Registration automation
│   │   ├── register.ts
│   │   ├── config.ts
│   │   └── types.ts
│   └── index.ts
└── package.json
```

### Router Factory

```typescript
import { createKladosRouter } from '@arke-institute/klados-core';

const app = createKladosRouter({
  doBindingName: 'KLADOS_JOBS',
  healthData: (env) => ({
    accepts: ['file/pdf'],
    produces: ['text/ocr'],
  }),
});

export default app;
```

The router provides:
- `GET /health` - Health check
- `POST /process` - Accept jobs (with signature verification)
- `GET /status/:job_id` - Job status
- `GET /.well-known/arke-verification` - Endpoint verification

### Signature Verification

```typescript
import { verifyArkeSignature } from '@arke-institute/klados-core';

// In /process handler:
const body = await c.req.text();
const signatureHeader = c.req.header('X-Arke-Signature');

const result = await verifyArkeSignature(
  body,
  signatureHeader,
  request.api_base
);

if (!result.valid) {
  return c.json({ accepted: false, error: result.error }, 401);
}
```

### Registration Script

```bash
# Register klados on test network
npx klados-register

# Register on production network
npx klados-register --production
```

The registration script:
1. Creates or updates the klados entity
2. Requests a verification token
3. Pushes verification secrets to worker
4. Waits for worker deployment
5. Confirms verification
6. Activates the klados
7. Creates and pushes API key

### Environment Variables

```typescript
interface KladosEnv {
  // Required
  ARKE_API_KEY: string;          // Klados API key for calling Arke

  // Set by registration during verification
  ARKE_VERIFY_TOKEN?: string;    // Temporary verification token
  ARKE_VERIFY_KLADOS_ID?: string; // Klados ID for verification

  // Informational
  KLADOS_ID?: string;            // Klados entity ID
  KLADOS_VERSION?: string;       // Deployment version
}
```

---

## Porting from agent-core to klados-core

| agent-core | klados-core | Notes |
|------------|-------------|-------|
| `createAgentRouter()` | `createKladosRouter()` | Same API |
| `verifyArkeSignature()` | `verifyArkeSignature()` | Unchanged |
| `ARKE_VERIFY_AGENT_ID` | `ARKE_VERIFY_KLADOS_ID` | Renamed env var |
| `AGENT_ID` | `KLADOS_ID` | Renamed env var |
| `BaseAgentEnv` | `BaseKladosEnv` | Same structure |
| `AgentJobRequest` | `KladosRequest` | Extended with `rhiza` context |

### Request Type Changes

```typescript
// Old (agent-core)
interface AgentJobRequest {
  job_id: string;
  target: string;
  job_collection: string;
  input?: Record<string, unknown>;
  api_base: string;
  expires_at: string;
  network: 'test' | 'main';
}

// New (klados-core)
interface KladosRequest {
  // Same base fields
  job_id: string;
  target: string;
  job_collection: string;
  input?: Record<string, unknown>;
  api_base: string;
  expires_at: string;
  network: 'test' | 'main';

  // NEW: Workflow context (present when invoked as part of rhiza)
  rhiza?: {
    id: string;           // Rhiza entity ID
    path: string[];       // Path of klados IDs from entry
    parent_logs: string[]; // Parent log IDs for chain
    batch?: {             // Present during scatter/gather
      id: string;
      index: number;
      total: number;
    };
  };
}
```

### Handoff Integration

When a klados completes in workflow context, it uses the rhiza SDK to determine and execute handoffs:

```typescript
import { getNextHandoff, executeHandoff } from '@arke-institute/rhiza';

// After processing...
if (request.rhiza) {
  // Fetch rhiza entity to get flow definition
  const rhiza = await client.rhizai.get(request.rhiza.id);

  // Determine next step from flow
  const current = request.rhiza.path[request.rhiza.path.length - 1];
  const handoff = getNextHandoff(rhiza.flow, current, outputs);

  if (!handoff.done) {
    // Execute handoff (creates log entry, invokes next klados)
    await executeHandoff(client, request, handoff, outputs);
  }
}
```

### Verification Endpoint

The `/.well-known/arke-verification` endpoint uses klados-specific env vars:

```typescript
app.get('/.well-known/arke-verification', (c) => {
  const token = c.env.ARKE_VERIFY_TOKEN;
  const kladosId = c.env.ARKE_VERIFY_KLADOS_ID || c.env.KLADOS_ID;

  if (!token) {
    return c.json({ error: 'Verification not configured' }, 404);
  }

  return c.json({
    verification_token: token,
    agent_id: kladosId,  // Note: field name stays "agent_id" for API compatibility
    timestamp: Date.now(),
  });
});
```
