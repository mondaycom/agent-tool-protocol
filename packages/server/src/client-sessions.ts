/**
 * Client Session Management
 */
import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import jwt from 'jsonwebtoken';
import type {
	CacheProvider,
	ClientToolDefinition,
	ClientServices,
} from '@mondaydotcomorg/atp-protocol';

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
	tokenRotateAt?: number;
}

/**
 * Client session manager with JWT-based authentication
 */
export class ClientSessionManager {
	private cache?: CacheProvider;
	private inMemorySessions: Map<string, ClientSession> = new Map();
	private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
	private tokenTTL: number;
	private jwtSecret: string;

	constructor(options: { cache?: CacheProvider; tokenTTL: number; tokenRotation: number }) {
		this.cache = options.cache;
		this.tokenTTL = options.tokenTTL;

		const secret = process.env.ATP_JWT_SECRET;
		if (!secret) {
			throw new Error(
				'ATP_JWT_SECRET environment variable is required. Generate one with: openssl rand -base64 32'
			);
		}

		this.jwtSecret = secret;
	}

	/**
	 * Initialize a new client session
	 */
	async initClient(request: ClientInitRequest): Promise<ClientInitResponse> {
		const clientId = this.generateClientId();

		const now = Date.now();
		const expiresAt = now + this.tokenTTL;
		const tokenRotateAt = now + this.tokenTTL / 2;

		const token = this.generateToken(clientId);

		const session: ClientSession = {
			clientId,
			createdAt: now,
			expiresAt,
			clientInfo: request.clientInfo,
			guidance: request.guidance,
			tools: request.tools || [],
			services: request.services,
		};

		if (this.cache) {
			const ttlSeconds = Math.floor(this.tokenTTL / 1000);
			await this.cache.set(`session:${clientId}`, session, ttlSeconds);
		} else {
			this.inMemorySessions.set(clientId, session);
			this.scheduleCleanup(clientId, this.tokenTTL);
		}

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
			// Prevent algorithm confusion attacks - only allow HS256
			const decoded = jwt.verify(token, this.jwtSecret, {
				algorithms: ['HS256'],
			}) as { clientId: string; type: string };

			if (decoded.clientId !== clientId || decoded.type !== 'client') {
				return false;
			}

			const session = await this.getSession(clientId);
			return session !== null;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Get client session
	 */
	async getSession(clientId: string): Promise<ClientSession | null> {
		let session: ClientSession | null = null;

		if (this.cache) {
			session = await this.cache.get<ClientSession>(`session:${clientId}`);
		} else {
			session = this.inMemorySessions.get(clientId) || null;
		}

		if (!session) {
			return null;
		}

		if (Date.now() > session.expiresAt) {
			if (this.cache) {
				await this.cache.delete(`session:${clientId}`);
			} else {
				this.inMemorySessions.delete(clientId);
			}
			return null;
		}

		return session;
	}

	/**
	 * Revoke client session
	 */
	async revokeClient(clientId: string): Promise<void> {
		if (this.cache) {
			await this.cache.delete(`session:${clientId}`);
		} else {
			this.inMemorySessions.delete(clientId);
		}
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
				jti: nanoid(),
			},
			this.jwtSecret,
			{
				expiresIn: 3600,
			}
		);
	}

	/**
	 * Schedule cleanup of expired in-memory session
	 */
	private scheduleCleanup(clientId: string, ttl: number): void {
		const existingTimer = this.cleanupTimers.get(clientId);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			this.inMemorySessions.delete(clientId);
			this.cleanupTimers.delete(clientId);
		}, ttl);

		this.cleanupTimers.set(clientId, timer);
	}

	/**
	 * Manually cleanup a session (useful for tests and explicit cleanup)
	 */
	async cleanup(clientId: string): Promise<void> {
		const timer = this.cleanupTimers.get(clientId);
		if (timer) {
			clearTimeout(timer);
			this.cleanupTimers.delete(clientId);
		}

		if (this.cache) {
			await this.cache.delete(`session:${clientId}`);
		} else {
			this.inMemorySessions.delete(clientId);
		}
	}

	/**
	 * Cleanup all sessions (useful for shutdown)
	 */
	async cleanupAll(): Promise<void> {
		for (const timer of this.cleanupTimers.values()) {
			clearTimeout(timer);
		}
		this.cleanupTimers.clear();

		if (!this.cache) {
			this.inMemorySessions.clear();
		}
	}
}
