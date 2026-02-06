/**
 * Verification endpoint helper
 *
 * Pure functions for building the /.well-known/arke-verification response.
 * Workers use this to handle the verification endpoint during registration.
 * No SDK dependencies.
 */

/**
 * Configuration for verification endpoint.
 * Workers pass their environment bindings to build the response.
 */
export interface VerificationConfig {
  /**
   * Temporary verification token set during registration.
   * Only present while registration is in progress.
   */
  verificationToken?: string;

  /**
   * Klados ID used during verification.
   * Set before AGENT_ID is finalized.
   */
  verifyAgentId?: string;

  /**
   * Klados ID (permanent).
   * Set after activation is complete.
   */
  agentId: string;
}

/** Response body for /.well-known/arke-verification */
export interface VerificationResponse {
  verification_token: string;
  klados_id: string;
}

/**
 * Build the verification response object.
 * Returns null if verification is not configured (no token).
 *
 * @example
 * ```typescript
 * const response = buildVerificationResponse({
 *   verificationToken: env.VERIFICATION_TOKEN,
 *   verifyAgentId: env.ARKE_VERIFY_AGENT_ID,
 *   agentId: env.AGENT_ID,
 * });
 *
 * if (response) {
 *   return c.json(response);
 * } else {
 *   return c.json({ error: 'Not in verification mode' }, 400);
 * }
 * ```
 */
export function buildVerificationResponse(
  config: VerificationConfig
): VerificationResponse | null {
  const token = config.verificationToken;
  const kladosId = config.verifyAgentId || config.agentId;

  if (!token) {
    return null;
  }

  return {
    verification_token: token,
    klados_id: kladosId,
  };
}

/** Handler result for framework-agnostic use */
export interface VerificationHandlerResult {
  status: number;
  body: VerificationResponse | { error: string };
}

/**
 * Create a verification handler for common frameworks.
 * Returns a function that produces status code and body.
 *
 * @example Hono
 * ```typescript
 * app.get('/.well-known/arke-verification', (c) => {
 *   const handler = createVerificationHandler({
 *     verificationToken: c.env.VERIFICATION_TOKEN,
 *     verifyAgentId: c.env.ARKE_VERIFY_AGENT_ID,
 *     agentId: c.env.AGENT_ID,
 *   });
 *   const result = handler();
 *   return c.json(result.body, result.status);
 * });
 * ```
 *
 * @example Express
 * ```typescript
 * app.get('/.well-known/arke-verification', (req, res) => {
 *   const handler = createVerificationHandler({
 *     verificationToken: process.env.VERIFICATION_TOKEN,
 *     verifyAgentId: process.env.ARKE_VERIFY_AGENT_ID,
 *     agentId: process.env.AGENT_ID,
 *   });
 *   const result = handler();
 *   res.status(result.status).json(result.body);
 * });
 * ```
 */
export function createVerificationHandler(
  config: VerificationConfig
): () => VerificationHandlerResult {
  return () => {
    const response = buildVerificationResponse(config);

    if (response) {
      return {
        status: 200,
        body: response,
      };
    }

    return {
      status: 400,
      body: { error: 'Verification not configured' },
    };
  };
}
