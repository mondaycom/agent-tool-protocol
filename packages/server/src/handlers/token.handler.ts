import type { RequestContext } from '../core/config.js';
import type { ClientSessionManager } from '../client-sessions.js';
import { log } from '@mondaydotcomorg/atp-runtime';

export interface TokenRefreshRequest {
	clientId: string;
}

export interface TokenRefreshResponse {
	clientId: string;
	token: string;
	expiresAt: number;
	tokenRotateAt: number;
}

/**
 * Handle token refresh requests.
 * Allows clients to refresh their token, even if the JWT has expired.
 * The session must still exist in the cache for refresh to succeed.
 */
export async function handleTokenRefresh(
	ctx: RequestContext,
	sessionManager: ClientSessionManager
): Promise<TokenRefreshResponse> {
	// Get clientId from header or body
	const clientId = ctx.clientId || (ctx.body as TokenRefreshRequest)?.clientId;

	if (!clientId) {
		ctx.throw(400, 'Client ID is required for token refresh');
	}

	// Verify the current token (from Authorization header)
	const authHeader = ctx.headers['authorization'];
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		ctx.throw(401, 'Bearer token required for refresh');
	}

	const currentToken = authHeader.substring(7);

	// Verify the token belongs to this client - allows expired JWT tokens
	const isValid = await sessionManager.verifyClientForRefresh(clientId, currentToken);
	if (!isValid) {
		ctx.throw(401, 'Invalid token or session expired');
	}

	// Refresh the token
	const refreshResult = await sessionManager.refreshToken(clientId);
	if (!refreshResult) {
		ctx.throw(401, 'Session not found or expired');
	}

	log.debug('Token refreshed', {
		clientId,
		newExpiresAt: refreshResult.expiresAt,
		newRotateAt: refreshResult.tokenRotateAt,
	});

	return refreshResult;
}
