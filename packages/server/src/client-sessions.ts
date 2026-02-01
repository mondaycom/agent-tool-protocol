/**
 * Client Session Management
 */
import { randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { log } from '@mondaydotcomorg/atp-runtime';
import type {
	CacheProvider,
	ClientToolDefinition,
	ClientServices,
} from '@mondaydotcomorg/atp-protocol';

const DEFAULT_JWT_SECRET = 'atp-default-development-secret';

export interface ClientSession {
	clientId: string;
	createdAt: number;
	expiresAt: number;
	clientInfo?: {
		name?: string;
		version?: string;
		[key: string]: unknown;
	};
	guidance?: string;
	/** Client-provided tool definitions */
	tools?: ClientToolDefinition[];
	/** Client-provided services (LLM, approval, embedding) */
	services?: ClientServices;
}

export interface ClientInitRequest {
	clientInfo?: {
		name?: string;
		version?: string;
		[key: string]: unknown;
	};
	guidance?: string;
	/** Client tool definitions to register */
	tools?: ClientToolDefinition[];
	/** Client-provided services (LLM, approval, embedding) */
	services?: ClientServices;
}

export interface ClientInitResponse {
	clientId: string;
	token: string;
	expiresAt: number;
	tokenRotateAt: number;
}

/**
 * Client session manager with JWT-based authentication
 */
export class ClientSessionManager {
	private cache: CacheProvider;
	private readonly tokenTTL: number;
	private readonly tokenRotation: number;
	private readonly jwtSecret: string;

	constructor(options: { cache: CacheProvider; tokenTTL: number; tokenRotation: number }) {
		this.cache = options.cache;
		this.tokenTTL = options.tokenTTL;
		this.tokenRotation = options.tokenRotation;

		const secret = process.env.ATP_JWT_SECRET;
		if (!secret) {
			log.warn(
				'ATP_JWT_SECRET not set - using default secret. This is insecure for production! ' +
					'Generate a secure secret with: openssl rand -base64 32'
			);
			this.jwtSecret = DEFAULT_JWT_SECRET;
		} else {
			this.jwtSecret = secret;
		}
	}

	private ensureClientJWT(token: string, clientId: string, ignoreExpiration = false) {
		const decoded = jwt.verify(token, this.jwtSecret, {
			algorithms: ['HS256'],
			ignoreExpiration,
		}) as { clientId: string; type: string };

		if (decoded.clientId !== clientId || decoded.type !== 'client') {
			return false;
		}

		return decoded;
	}

	/**
	 * Initialize a new client session
	 */
	async initClient(request: ClientInitRequest): Promise<ClientInitResponse> {
		const clientId = this.generateClientId();

		const now = Date.now();
		const expiresAt = now + this.tokenTTL;
		const tokenRotateAt = now + this.tokenRotation;

		const token = this.generateToken(clientId);

		const session: ClientSession = {
			clientId,
			createdAt: now,
			expiresAt: expiresAt,
			clientInfo: request.clientInfo,
			guidance: request.guidance,
			tools: request.tools || [],
			services: request.services,
		};

		// Caching client session with default cache provider ttl, sessionExpiresAt is enforced programmatically on get.
		await this.cache.set(`session:${clientId}`, session);

		return {
			clientId,
			token,
			expiresAt,
			tokenRotateAt,
		};
	}

	/**
	 * Verify client token (JWT-based, stateless)
	 */
	async verifyClient(clientId: string, token: string): Promise<boolean> {
		try {
			if (!this.ensureClientJWT(token, clientId)) {
				return false;
			}

			const session = await this.getSession(clientId);
			return session !== null;
		} catch {
			return false;
		}
	}

	/**
	 * Verify client token for refresh purposes - allows expired JWT tokens.
	 * This is used during token refresh when the JWT may have expired but
	 * the session still exists in cache.
	 */
	async verifyClientForRefresh(clientId: string, token: string): Promise<boolean> {
		try {
			// Verify token structure but ignore expiration - token refresh should work
			// even if the JWT has expired, as long as the session still exists in cache
			if (!this.ensureClientJWT(token, clientId, true)) {
				return false;
			}

			// Check if session exists in cache - don't check session.expiresAt
			const session = await this.cache.get<ClientSession>(`session:${clientId}`);
			return session !== null;
		} catch {
			return false;
		}
	}

	/**
	 * Get client session
	 */
	async getSession(clientId: string): Promise<ClientSession | null> {
		const session = await this.cache.get<ClientSession>(`session:${clientId}`);

		if (!session) {
			return null;
		}

		if (Date.now() > session.expiresAt) {
			await this.cache.delete(`session:${clientId}`);
			return null;
		}

		return session;
	}

	/**
	 * Revoke client session
	 */
	async revokeClient(clientId: string): Promise<void> {
		await this.cache.delete(`session:${clientId}`);
	}

	/**
	 * Generate cryptographically secure client ID
	 */
	private generateClientId(): string {
		const random = randomBytes(16).toString('hex');
		return `cli_${random}`;
	}

	/**
	 * Generate JWT token for client
	 */
	generateToken(clientId: string): string {
		return jwt.sign(
			{
				clientId,
				type: 'client',
				jti: randomUUID(),
			},
			this.jwtSecret,
			{
				expiresIn: Math.ceil(this.tokenTTL / 1000),
			}
		);
	}

	/**
	 * Refresh token for an existing client session.
	 * Returns new token credentials if session exists in cache.
	 * This works even if the session's expiresAt has passed - the refresh
	 * will update expiresAt to extend the session.
	 */
	async refreshToken(clientId: string): Promise<ClientInitResponse | null> {
		// Get session directly from cache without expiry check
		const session = await this.cache.get<ClientSession>(`session:${clientId}`);
		if (!session) {
			// Throw happens in handler
			return null;
		}

		// Remove old client session entry.
		await this.cache.delete(`session:${clientId}`);;

		const newClientId = this.generateClientId();
		const now = Date.now();
		const newExpiresAt = now + this.tokenTTL;
		const newTokenRotateAt = now + this.tokenRotation;

		// Update session with both new clientId and new expiresAt
		const updatedSession: ClientSession = {
			...session,
			clientId,
			expiresAt: newExpiresAt,
		};

		await this.cache.set(`session:${newClientId}`, updatedSession);

		const newToken = this.generateToken(newClientId);

		return {
			clientId: newClientId,
			token: newToken,
			expiresAt: newExpiresAt,
			tokenRotateAt: newTokenRotateAt,
		};
	}

	/**
	 * Get token TTL and rotation settings (useful for clients)
	 */
	getTokenSettings(): { tokenTTL: number; tokenRotation: number } {
		return {
			tokenTTL: this.tokenTTL,
			tokenRotation: this.tokenRotation,
		};
	}
}
