import type { ClientHooks } from './types.js';
import type { ClientToolDefinition } from '@mondaydotcomorg/atp-protocol';

/**
 * Configuration for automatic token refresh behavior
 */
export interface TokenRefreshConfig {
	/** Enable automatic token refresh (default: true) */
	enabled: boolean;
	/** Buffer time in ms before rotateAt to trigger refresh (default: 1000ms) */
	bufferMs: number;
}

export interface ISession {
	init(
		clientInfo?: { name?: string; version?: string; [key: string]: unknown },
		tools?: ClientToolDefinition[],
		services?: { hasLLM: boolean; hasApproval: boolean; hasEmbedding: boolean; hasTools: boolean }
	): Promise<{
		clientId: string;
		token: string;
		expiresAt: number;
		tokenRotateAt: number;
	}>;
	getClientId(): string;
	ensureInitialized(): Promise<void>;
	getHeaders(): Record<string, string>;
	getBaseUrl(): string;
	updateToken(response: Response): void;
	prepareHeaders(method: string, url: string, body?: unknown): Promise<Record<string, string>>;
	/** Refresh token if needed (past rotateAt time) */
	refreshTokenIfNeeded(): Promise<void>;
	/** Configure automatic token refresh behavior */
	setTokenRefreshConfig(config: Partial<TokenRefreshConfig>): void;
}

export class ClientSession implements ISession {
	private baseUrl: string;
	private customHeaders: Record<string, string>;
	private clientId?: string;
	private clientToken?: string;
	private tokenExpiresAt?: number;
	private tokenRotateAt?: number;
	private initPromise?: Promise<void>;
	private refreshPromise?: Promise<void>;
	private hooks?: ClientHooks;
	private tokenRefreshConfig: TokenRefreshConfig = {
		enabled: true,
		bufferMs: 1000,
	};

	constructor(
		baseUrl: string,
		headers?: Record<string, string>,
		hooks?: ClientHooks,
		tokenRefreshConfig?: Partial<TokenRefreshConfig>
	) {
		this.baseUrl = baseUrl;
		this.customHeaders = headers || {};
		this.hooks = hooks;
		if (tokenRefreshConfig) {
			this.tokenRefreshConfig = { ...this.tokenRefreshConfig, ...tokenRefreshConfig };
		}
	}

	/**
	 * Initializes the client session with the server.
	 * This MUST be called before any other operations.
	 * The server generates and returns a unique client ID and token.
	 * @param clientInfo - Optional client information
	 * @param tools - Optional client tool definitions to register with the server
	 * @param services - Optional client service capabilities (LLM, approval, embedding)
	 */
	async init(
		clientInfo?: { name?: string; version?: string; [key: string]: unknown },
		tools?: ClientToolDefinition[],
		services?: { hasLLM: boolean; hasApproval: boolean; hasEmbedding: boolean; hasTools: boolean }
	): Promise<{
		clientId: string;
		token: string;
		expiresAt: number;
		tokenRotateAt: number;
	}> {
		if (this.initPromise) {
			await this.initPromise;
			return {
				clientId: this.clientId!,
				token: this.clientToken!,
				expiresAt: this.tokenExpiresAt!,
				tokenRotateAt: this.tokenRotateAt!,
			};
		}

		let initResult: {
			clientId: string;
			token: string;
			expiresAt: number;
			tokenRotateAt: number;
		};

		this.initPromise = (async () => {
			const url = `${this.baseUrl}/api/init`;
			const body = JSON.stringify({
				clientInfo,
				tools: tools || [],
				services,
			});

			const headers = await this.prepareHeaders('POST', url, body);

			const response = await fetch(url, {
				method: 'POST',
				headers,
				body,
			});

			if (!response.ok) {
				throw new Error(`Client initialization failed: ${response.status} ${response.statusText}`);
			}

			const data = (await response.json()) as {
				clientId: string;
				token: string;
				expiresAt: number;
				tokenRotateAt: number;
			};

			this.clientId = data.clientId;
			this.clientToken = data.token;
			this.tokenExpiresAt = data.expiresAt;
			this.tokenRotateAt = data.tokenRotateAt;
			initResult = data;
		})();

		await this.initPromise;

		return initResult!;
	}

	/**
	 * Gets the unique client ID.
	 */
	getClientId(): string {
		if (!this.clientId) {
			throw new Error('Client not initialized. Call init() first.');
		}
		return this.clientId;
	}

	/**
	 * Ensures the client is initialized before making requests.
	 */
	async ensureInitialized(): Promise<void> {
		if (!this.clientId) {
			throw new Error('Client not initialized. Call init() first.');
		}
	}

	/**
	 * Creates HTTP headers for requests.
	 */
	getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			...this.customHeaders,
		};

		if (this.clientId) {
			headers['X-Client-ID'] = this.clientId;
		}

		if (this.clientToken) {
			headers['Authorization'] = `Bearer ${this.clientToken}`;
		}

		return headers;
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	/**
	 * Updates the client token from response headers (token refresh).
	 */
	updateToken(response: Response): void {
		const newToken = response.headers.get('X-ATP-Token');
		const newExpiresAt = response.headers.get('X-ATP-Token-Expires');

		if (newToken) {
			this.clientToken = newToken;
		}
		if (newExpiresAt) {
			this.tokenExpiresAt = parseInt(newExpiresAt, 10);
			// Estimate tokenRotateAt as halfway between now and expiry
			const now = Date.now();
			const ttl = this.tokenExpiresAt - now;
			this.tokenRotateAt = now + ttl / 2;
		}
	}

	/**
	 * Configure automatic token refresh behavior
	 */
	setTokenRefreshConfig(config: Partial<TokenRefreshConfig>): void {
		this.tokenRefreshConfig = { ...this.tokenRefreshConfig, ...config };
	}

	/**
	 * Refresh token if needed (past rotateAt time or expired).
	 * This is called automatically before requests when autoRefresh is enabled.
	 * Uses a shared promise to prevent concurrent refresh requests.
	 *
	 * Note: Even expired tokens can be refreshed as long as the server session
	 * still exists. The server accepts expired JWTs for the refresh endpoint.
	 */
	async refreshTokenIfNeeded(): Promise<void> {
		// Skip if auto-refresh is disabled
		if (!this.tokenRefreshConfig.enabled) {
			return;
		}

		// Skip if not initialized
		if (!this.clientId || !this.clientToken) {
			return;
		}

		// Check if we need to refresh:
		// - Past rotateAt time (proactive refresh), OR
		// - Token has expired (reactive refresh - still allowed by server)
		const now = Date.now();
		const needsRefresh =
			(this.tokenRotateAt && now >= this.tokenRotateAt - this.tokenRefreshConfig.bufferMs) ||
			(this.tokenExpiresAt && now >= this.tokenExpiresAt);

		if (!needsRefresh) {
			return; // Token is still fresh
		}

		// Prevent concurrent refresh requests
		if (this.refreshPromise) {
			await this.refreshPromise;
			return;
		}

		this.refreshPromise = this.doRefreshToken();

		try {
			await this.refreshPromise;
		} finally {
			this.refreshPromise = undefined;
		}
	}

	/**
	 * Perform the actual token refresh
	 */
	private async doRefreshToken(): Promise<void> {
		const url = `${this.baseUrl}/api/token/refresh`;
		const body = JSON.stringify({ clientId: this.clientId });

		// Use current token for auth, but don't recursively try to refresh
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			...this.customHeaders,
			'X-Client-ID': this.clientId!,
			Authorization: `Bearer ${this.clientToken}`,
		};

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = (await response.json()) as {
			clientId: string;
			token: string;
			expiresAt: number;
			tokenRotateAt: number;
		};

		this.clientToken = data.token;
		this.tokenExpiresAt = data.expiresAt;
		this.tokenRotateAt = data.tokenRotateAt;
	}

	/**
	 * Prepares headers for a request, refreshing token if needed and calling preRequest hook if configured
	 */
	async prepareHeaders(
		method: string,
		url: string,
		body?: unknown
	): Promise<Record<string, string>> {
		// Refresh token if needed BEFORE preparing headers
		// Skip for token refresh endpoint to avoid infinite recursion
		if (!url.includes('/api/token/refresh') && !url.includes('/api/init')) {
			await this.refreshTokenIfNeeded();
		}

		let headers: Record<string, string> = {
			'Content-Type': 'application/json',
			...this.customHeaders,
		};

		if (this.clientId) {
			headers['X-Client-ID'] = this.clientId;
		}

		if (this.clientToken) {
			headers['Authorization'] = `Bearer ${this.clientToken}`;
		}

		if (this.hooks?.preRequest) {
			try {
				const result = await this.hooks.preRequest({
					url,
					method,
					currentHeaders: headers,
					body,
				});

				if (result.abort) {
					throw new Error(result.abortReason || 'Request aborted by preRequest hook');
				}

				if (result.headers) {
					headers = result.headers;
				}
			} catch (error) {
				throw error;
			}
		}

		return headers;
	}
}
