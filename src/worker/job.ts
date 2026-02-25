/**
 * KladosJob - High-level klados job management
 *
 * Manages the full lifecycle of a klados job:
 * - Logging (create, update, finalize)
 * - Error handling (log + batch slot)
 * - Workflow handoff (via interpretThen)
 *
 * Reduces ~80 lines of boilerplate to ~15 lines.
 */

import { ArkeClient } from '@arke-institute/sdk';
import type {
  KladosRequest,
  KladosResponse,
  KladosLogEntry,
  FlowStep,
  HandoffRecord,
  BatchContext,
  Output,
} from '../types';
import type { RhizaRuntimeConfig } from '../types/config';
import { KladosLogger } from '../logging/logger';
import { writeKladosLog, updateLogWithHandoffs, updateLogStatus } from '../logging/writer';
import { interpretThen, type InterpretResult } from '../handoff/interpret';
import { generateId } from '../utils';
import { failKlados, toKladosError } from './errors';

/**
 * Configuration for creating a KladosJob
 */
export interface KladosJobConfig {
  /** Klados agent ID */
  agentId: string;

  /** Klados agent version */
  agentVersion: string;

  /**
   * Authentication token for Arke client.
   * Accepts either:
   * - Agent API key with 'ak_' prefix
   * - User API key with 'uk_' prefix
   * - JWT token from Supabase auth
   */
  authToken?: string;

  /**
   * Link entities to their processing logs via relationships.
   * When enabled, creates:
   * - has_processing_log: input entity → log (when log is written)
   * - has_creation_log: output entity → log (when job completes with outputs)
   *
   * Requires `entity:update` permission on target_collection.
   * Linking is best-effort - failures are logged but don't fail the job.
   * @default false
   */
  linkEntitiesToLogs?: boolean;
}

/**
 * Result of completing a job
 */
export interface KladosJobResult {
  /** The handoff result (if in a workflow) */
  handoff?: InterpretResult;

  /** Output entity IDs or OutputItems */
  outputs: Output[];
}

/**
 * State of a KladosJob
 */
type JobState = 'accepted' | 'started' | 'completed' | 'failed';

/**
 * KladosJob - Manages the full lifecycle of a klados job
 *
 * Usage:
 * ```typescript
 * const job = KladosJob.accept(request, { agentId, agentVersion, authToken });
 *
 * ctx.waitUntil(job.run(async () => {
 *   job.log.info('Processing...');
 *   const outputs = await doWork();
 *   return outputs;  // Job handles handoff + finalization
 * }));
 *
 * return Response.json(job.acceptResponse);
 * ```
 */
export class KladosJob {
  /** The Arke client */
  readonly client: ArkeClient;

  /** Logger for this job */
  readonly log: KladosLogger;

  /** The original request */
  readonly request: KladosRequest;

  /** The acceptance response to return to caller */
  readonly acceptResponse: KladosResponse;

  /** Job configuration */
  readonly config: KladosJobConfig;

  /** Rhiza runtime configuration */
  readonly rhizaConfig?: RhizaRuntimeConfig;

  /** Generated log ID */
  readonly logId: string;

  // Internal state
  private state: JobState = 'accepted';
  private logFileId: string | null = null;
  private flow: Record<string, FlowStep> | null = null;

  /**
   * Create a new KladosJob (private - use static methods)
   */
  private constructor(
    request: KladosRequest,
    config: KladosJobConfig,
    rhizaConfig?: RhizaRuntimeConfig
  ) {
    this.request = request;
    this.config = config;
    this.rhizaConfig = rhizaConfig;
    this.log = new KladosLogger();
    this.logId = `log_${generateId()}`;

    // Create Arke client with correct network
    this.client = new ArkeClient({
      baseUrl: request.api_base,
      authToken: config.authToken,
      network: request.network,
    });

    // Build acceptance response
    this.acceptResponse = {
      accepted: true,
      job_id: request.job_id,
    };
  }

  /**
   * Accept a klados request and create a job
   *
   * This is the main factory method. Call this immediately when receiving
   * a request, then process the job asynchronously.
   *
   * @param request - The incoming KladosRequest
   * @param config - Job configuration
   * @param rhizaConfig - Optional rhiza runtime configuration (for scatter utility delegation)
   * @returns A new KladosJob instance
   */
  static accept(
    request: KladosRequest,
    config: KladosJobConfig,
    rhizaConfig?: RhizaRuntimeConfig
  ): KladosJob {
    return new KladosJob(request, config, rhizaConfig);
  }

  /**
   * Get the batch context (if in a scatter/gather)
   */
  get batchContext(): BatchContext | undefined {
    return this.request.rhiza?.batch;
  }

  /**
   * Check if this job is part of a workflow
   */
  get isWorkflow(): boolean {
    return !!this.request.rhiza;
  }

  /**
   * Get the current recursion depth (for recurse handoffs)
   * Returns 0 if not in a recursive workflow.
   */
  get recurseDepth(): number {
    return this.request.rhiza?.recurse_depth ?? 0;
  }

  /**
   * Run the job with automatic lifecycle management
   *
   * This is the recommended way to process a klados job. It handles:
   * - Writing the initial log entry
   * - Catching and recording errors
   * - Executing workflow handoffs
   * - Finalizing the log
   *
   * @param fn - The processing function that returns output entity IDs or OutputItems
   * @returns The job result
   */
  async run(
    fn: () => Promise<Output[]>,
    options?: { outputProperties?: Record<string, unknown> }
  ): Promise<KladosJobResult> {
    // Start the job (write initial log)
    await this.start();

    try {
      // Execute the processing function
      const outputs = await fn();

      // Complete the job (handoff + finalize)
      return await this.complete(outputs, options?.outputProperties);
    } catch (error) {
      // Handle failure
      await this.fail(error);
      throw error; // Re-throw so caller knows it failed
    }
  }

  /**
   * Start the job (write initial log entry)
   *
   * For advanced use cases where you need more control over the lifecycle.
   * Most users should use `run()` instead.
   */
  async start(): Promise<void> {
    if (this.state !== 'accepted') {
      throw new Error(`Cannot start job in state: ${this.state}`);
    }

    // Build log entry
    const logEntry: KladosLogEntry = {
      id: this.logId,
      type: 'klados_log',
      klados_id: this.config.agentId,
      rhiza_id: this.request.rhiza?.id,
      job_id: this.request.job_id,
      started_at: new Date().toISOString(),
      status: 'running',
      received: {
        target_entity: this.request.target_entity,
        target_entities: this.request.target_entities,
        target_collection: this.request.target_collection,
        from_logs: this.request.rhiza?.parent_logs,
        batch: this.request.rhiza?.batch,
        scatter_total: this.request.rhiza?.scatter_total,
      },
    };

    // Write initial log entry
    // Use relationship updater service for fire-and-forget parent log updates
    // NOTE: Entity linking (has_processing_log, has_creation_log) happens in complete(),
    // AFTER the job finishes, to avoid race conditions with worker's CAS updates.
    const { fileId } = await writeKladosLog({
      client: this.client,
      jobCollectionId: this.request.job_collection,
      entry: logEntry,
      messages: this.log.getMessages(),
      agentId: this.config.agentId,
      agentVersion: this.config.agentVersion,
    });

    this.logFileId = fileId;
    this.state = 'started';

    // Fetch rhiza flow if in a workflow
    if (this.request.rhiza) {
      await this.fetchFlow();
    }
  }

  /**
   * Complete the job with outputs
   *
   * For advanced use cases. Handles workflow handoff and log finalization.
   *
   * Outputs can be:
   * - string[] - entity IDs (backward compatible)
   * - OutputItem[] - objects with entity_id + routing properties (for per-item routing)
   * - mixed array of strings and OutputItems
   *
   * @param outputs - Output entity IDs or OutputItems produced by this job
   * @param outputProperties - Properties of the primary output (for aggregate routing, deprecated)
   */
  async complete(
    outputs: Output[],
    outputProperties?: Record<string, unknown>
  ): Promise<KladosJobResult> {
    if (this.state !== 'started') {
      throw new Error(`Cannot complete job in state: ${this.state}`);
    }

    if (!this.logFileId) {
      throw new Error('Job not started - logFileId is null');
    }

    let handoffResult: InterpretResult | undefined;
    const handoffs: HandoffRecord[] = [];

    // Execute workflow handoff if in a workflow
    if (this.request.rhiza && this.flow) {
      // Look up current step by path (last element is current step name)
      const currentStepName = this.request.rhiza.path?.at(-1);
      if (!currentStepName) {
        throw new Error('Missing step name in rhiza path');
      }
      const myStep = this.flow[currentStepName];

      if (myStep?.then) {
        handoffResult = await interpretThen(
          myStep.then,
          {
            client: this.client,
            rhizaId: this.request.rhiza.id,
            kladosId: this.config.agentId,
            jobId: this.request.job_id,
            targetCollection: this.request.target_collection,
            jobCollectionId: this.request.job_collection,
            flow: this.flow,
            outputs,
            outputProperties,
            fromLogId: this.logFileId!, // Actual entity ID, not the logical log ID
            path: this.request.rhiza.path,
            apiBase: this.request.api_base,
            network: this.request.network,
            batchContext: this.request.rhiza.batch,
            authToken: this.config.authToken,
            recurseDepth: this.request.rhiza.recurse_depth,
            input: this.request.input,  // Forward workflow input to handoffs
          },
          this.rhizaConfig
        );

        if (handoffResult.handoffRecord) {
          handoffs.push(handoffResult.handoffRecord);
        }

        this.log.info(`Handoff: ${handoffResult.action}`, {
          target: handoffResult.target,
          targetType: handoffResult.targetType,
        });
      }
    }

    // Update log with handoffs
    if (handoffs.length > 0) {
      await updateLogWithHandoffs(this.client, this.logFileId, handoffs);
    }

    // Add completion message before finalizing
    this.log.success('Job completed');
    this.state = 'completed';

    // Mark log as done with final messages and link entities if enabled
    // Extract entity IDs from outputs (handles both string[] and OutputItem[])
    const outputIds = outputs.map(o => typeof o === 'string' ? o : o.entity_id);

    // Build input entity IDs for linking
    const inputEntityIds: string[] = [];
    if (this.request.target_entity) {
      inputEntityIds.push(this.request.target_entity);
    }
    if (this.request.target_entities?.length) {
      inputEntityIds.push(...this.request.target_entities);
    }

    await updateLogStatus(this.client, this.logFileId, 'done', {
      messages: this.log.getMessages(),
      outputs: outputIds.length > 0 ? outputIds : undefined,
      inputEntityIds: inputEntityIds.length > 0 ? inputEntityIds : undefined,
      linkEntitiesToLogs: this.config.linkEntitiesToLogs,
    });

    return {
      handoff: handoffResult,
      outputs,
    };
  }

  /**
   * Mark the job as failed
   *
   * Handles both log status update AND batch slot error (if applicable).
   *
   * @param error - The error that caused the failure
   */
  async fail(error: unknown): Promise<void> {
    if (this.state === 'completed' || this.state === 'failed') {
      return; // Already finalized
    }

    const kladosError = toKladosError(error);
    this.log.error('Job failed', { code: kladosError.code, message: kladosError.message });

    // If we haven't started yet, we can't update the log
    if (!this.logFileId) {
      this.state = 'failed';
      return;
    }

    // Use failKlados to handle both log and batch slot
    await failKlados(this.client, {
      logFileId: this.logFileId,
      batchContext: this.request.rhiza?.batch,
      error: kladosError,
      messages: this.log.getMessages(),
    });

    this.state = 'failed';
  }

  /**
   * Get the permission-scoped collection
   */
  get targetCollection(): string {
    return this.request.target_collection;
  }

  /**
   * Fetch the target entity (for cardinality: 'one')
   *
   * Convenience method to fetch the single entity being processed.
   * Throws if target_entity is not set in the request.
   */
  async fetchTarget<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<{
    id: string;
    type: string;
    properties: T;
  }> {
    if (!this.request.target_entity) {
      throw new Error('No target_entity in request');
    }

    const { data, error } = await this.client.api.GET('/entities/{id}', {
      params: { path: { id: this.request.target_entity } },
    });

    if (error || !data) {
      throw new Error(`Failed to fetch target entity: ${this.request.target_entity}`);
    }

    return {
      id: data.id,
      type: data.type,
      properties: data.properties as T,
    };
  }

  /**
   * Fetch the target entities (for cardinality: 'many')
   *
   * Convenience method to fetch all entities being processed.
   * Throws if target_entities is not set or empty in the request.
   */
  async fetchTargets<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<
    Array<{
      id: string;
      type: string;
      properties: T;
    }>
  > {
    if (!this.request.target_entities?.length) {
      throw new Error('No target_entities in request');
    }

    return Promise.all(
      this.request.target_entities.map(async (id) => {
        const { data, error } = await this.client.api.GET('/entities/{id}', {
          params: { path: { id } },
        });

        if (error || !data) {
          throw new Error(`Failed to fetch target entity: ${id}`);
        }

        return {
          id: data.id,
          type: data.type,
          properties: data.properties as T,
        };
      })
    );
  }

  /**
   * Fetch the rhiza flow definition
   */
  private async fetchFlow(): Promise<void> {
    if (!this.request.rhiza) {
      return;
    }

    const { data, error } = await this.client.api.GET('/entities/{id}', {
      params: { path: { id: this.request.rhiza.id } },
    });

    if (error || !data) {
      throw new Error(`Failed to fetch rhiza: ${this.request.rhiza.id}`);
    }

    this.flow = data.properties.flow as Record<string, FlowStep>;
  }
}
