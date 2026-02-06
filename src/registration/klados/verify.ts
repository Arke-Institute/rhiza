/**
 * Klados verification flow
 *
 * SDK-dependent functions for endpoint verification.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type { KeyStore } from '../types';
import { SECRET_NAMES } from '../types';

/** Result of requesting a verification token */
export interface VerificationTokenResult {
  /** The verification token to return at /.well-known/arke-verification */
  token: string;
  /** When the token expires (ISO timestamp) */
  expiresAt: string;
}

/** Result of confirming verification */
export interface VerificationConfirmResult {
  /** Whether verification succeeded */
  verified: boolean;
  /** When verification was confirmed (ISO timestamp) */
  verifiedAt?: string;
  /** Error message if verification failed */
  error?: string;
}

// Response types for API calls (union types from SDK)
interface VerifyTokenResponse {
  verification_token: string;
  klados_id: string;
  endpoint: string;
  instructions: string;
  expires_at: string;
}

interface VerifyConfirmResponse {
  verified: true;
  verified_at: string;
}

interface VerifyErrorResponse {
  verified: false;
  error?: string;
  message?: string;
}

type VerifyResponse = VerifyTokenResponse | VerifyConfirmResponse | VerifyErrorResponse;

/**
 * Request a verification token from Arke.
 *
 * The token must be returned at `{endpoint}/.well-known/arke-verification`
 * along with the klados ID.
 *
 * @param client - Arke client (authenticated with user key)
 * @param kladosId - Klados entity ID
 * @returns Verification token and expiry
 */
export async function requestVerification(
  client: ArkeClient,
  kladosId: string
): Promise<VerificationTokenResult> {
  const { data, error } = await client.api.POST('/kladoi/{id}/verify', {
    params: { path: { id: kladosId } },
    body: {},
  });

  if (error || !data) {
    throw new Error(`Failed to request verification: ${error?.error || 'Unknown error'}`);
  }

  // Type narrow to token response
  const response = data as VerifyResponse;
  if ('verification_token' in response) {
    return {
      token: response.verification_token,
      expiresAt: response.expires_at,
    };
  }

  throw new Error('Unexpected response from verification request');
}

/**
 * Confirm endpoint verification.
 *
 * Arke will call `{endpoint}/.well-known/arke-verification` and verify
 * that the returned token and klados_id match.
 *
 * @param client - Arke client (authenticated with user key)
 * @param kladosId - Klados entity ID
 * @returns Verification result
 */
export async function confirmVerification(
  client: ArkeClient,
  kladosId: string
): Promise<VerificationConfirmResult> {
  const { data, error } = await client.api.POST('/kladoi/{id}/verify', {
    params: { path: { id: kladosId } },
    body: { confirm: true },
  });

  if (error) {
    return {
      verified: false,
      error: error.error || 'Unknown error',
    };
  }

  // Type narrow the response
  const response = data as VerifyResponse;

  if ('verified' in response && response.verified === true) {
    return {
      verified: true,
      verifiedAt: (response as VerifyConfirmResponse).verified_at,
    };
  }

  // Verification failed
  const errorResponse = response as VerifyErrorResponse;
  return {
    verified: false,
    error: errorResponse.message || errorResponse.error || 'Verification failed',
  };
}

/**
 * Activate a klados (set status to 'active').
 *
 * Uses Compare-And-Swap to safely update status.
 *
 * @param client - Arke client (authenticated with user key)
 * @param kladosId - Klados entity ID
 */
export async function activateKlados(
  client: ArkeClient,
  kladosId: string
): Promise<void> {
  // Get current tip for CAS
  const { data: tipData, error: tipError } = await client.api.GET(
    '/entities/{id}/tip',
    {
      params: { path: { id: kladosId } },
    }
  );

  if (tipError || !tipData) {
    throw new Error(`Failed to get entity tip: ${tipError?.error || 'Unknown error'}`);
  }

  // Update status to active
  const { error: updateError } = await client.api.PUT('/kladoi/{id}', {
    params: { path: { id: kladosId } },
    body: {
      expect_tip: tipData.cid,
      status: 'active',
    },
  });

  if (updateError) {
    throw new Error(`Failed to activate klados: ${updateError.error || 'Unknown error'}`);
  }
}

/**
 * Run the full verification flow with KeyStore automation.
 *
 * Steps:
 * 1. Request verification token
 * 2. Push token and klados ID to keyStore
 * 3. Call onDeploy (platform deploys worker)
 * 4. Call onWaitForHealth (wait for endpoint)
 * 5. Confirm verification
 * 6. Activate klados
 * 7. Cleanup verification secrets
 *
 * @param client - Arke client
 * @param kladosId - Klados entity ID
 * @param endpoint - Worker endpoint URL
 * @param options - Flow options
 * @returns Verification result
 */
export async function runVerificationFlow(
  client: ArkeClient,
  kladosId: string,
  endpoint: string,
  options: {
    keyStore: KeyStore;
    onDeploy: () => Promise<void>;
    onWaitForHealth: (endpoint: string) => Promise<void>;
  }
): Promise<VerificationConfirmResult> {
  const { keyStore, onDeploy, onWaitForHealth } = options;

  // Step 1: Request token
  const { token } = await requestVerification(client, kladosId);

  // Step 2: Push secrets
  await keyStore.set(SECRET_NAMES.VERIFICATION_TOKEN, token);
  await keyStore.set(SECRET_NAMES.VERIFY_AGENT_ID, kladosId);

  // Step 3: Deploy
  await onDeploy();

  // Step 4: Wait for health
  await onWaitForHealth(endpoint);

  // Step 5: Confirm verification
  const result = await confirmVerification(client, kladosId);

  if (result.verified) {
    // Step 6: Activate
    await activateKlados(client, kladosId);

    // Step 7: Cleanup
    await keyStore.delete(SECRET_NAMES.VERIFICATION_TOKEN);
    await keyStore.delete(SECRET_NAMES.VERIFY_AGENT_ID);
  }

  return result;
}
