import type { ClientToolDefinition } from '@mondaydotcomorg/atp-protocol';
import type { TokenRefreshConfig } from './types.js';

/**
 * Token credentials returned from init and refresh operations
 */
export interface TokenCredentials {
	clientId: string;
	token: string;
	expiresAt: number;
	tokenRotateAt: number;
}

/**
 * Session interface for ATP client operations
 */
export interface ISession {
	init(
		clientInfo?: { name?: string; version?: string; [key: string]: unknown },
		tools?: ClientToolDefinition[],
		services?: { hasLLM: boolean; hasApproval: boolean; hasEmbedding: boolean; hasTools: boolean }
	): Promise<TokenCredentials>;
	getClientId(): string;
	ensureInitialized(): Promise<void>;
	getHeaders(): Record<string, string>;
	getBaseUrl(): string;
	prepareHeaders(method: string, url: string, body?: unknown): Promise<Record<string, string>>;
	refreshTokenIfNeeded(): Promise<void>;
	setTokenRefreshConfig(config: Partial<TokenRefreshConfig>): void;
}

/**
 * Stored init parameters for re-initialization during token refresh.
 */
export interface StoredInitParams {
	clientInfo?: { name?: string; version?: string; [key: string]: unknown };
	tools?: ClientToolDefinition[];
	services?: { hasLLM: boolean; hasApproval: boolean; hasEmbedding: boolean; hasTools: boolean };
}

/**
 * Base session class with shared token management logic.
 * Subclasses implement the transport-specific operations (HTTP vs in-process).
 */
export abstract class BaseSession implements ISession {
	protected clientId?: string;
	protected clientToken?: string;
	protected tokenExpiresAt?: number;
	protected tokenRotateAt?: number;
	protected initPromise?: Promise<void>;
	protected refreshPromise?: Promise<void>;
	protected storedInitParams?: StoredInitParams;
	protected tokenRefreshConfig: TokenRefreshConfig = {
		enabled: true,
		bufferMs: 1000,
	};

	protected constructor(tokenRefreshConfig?: Partial<TokenRefreshConfig>) {
		if (tokenRefreshConfig) {
			this.tokenRefreshConfig = { ...this.tokenRefreshConfig, ...tokenRefreshConfig };
		}
	}

	/**
	 * Initialize the session - must be implemented by subclass
	 */
	abstract init(
		clientInfo?: { name?: string; version?: string; [key: string]: unknown },
		tools?: ClientToolDefinition[],
		services?: { hasLLM: boolean; hasApproval: boolean; hasEmbedding: boolean; hasTools: boolean }
	): Promise<TokenCredentials>;

	/**
	 * Get headers for requests - must be implemented by subclass
	 */
	abstract getHeaders(): Record<string, string>;

	/**
	 * Get base URL - must be implemented by subclass
	 */
	abstract getBaseUrl(): string;

	/**
	 * Ensure client is initialized - must be implemented by subclass
	 */
	abstract ensureInitialized(): Promise<void>;

	/**
	 * Prepare headers for a request - must be implemented by subclass
	 */
	abstract prepareHeaders(method: string, url: string, body?: unknown): Promise<Record<string, string>>;

	/**
	 * Perform token refresh by re-initializing the session.
	 * Resets the init guard and calls init() again with the stored params,
	 * effectively creating a fresh session without depending on the old
	 * session still existing in the server's cache.
	 */
	protected async doRefreshToken(): Promise<void> {
		if (!this.storedInitParams) {
			throw new Error('Cannot refresh token: init params not stored. Was init() called?');
		}

		// Reset the init guard so init() runs a fresh handshake
		this.initPromise = undefined;

		await this.init(
			this.storedInitParams.clientInfo,
			this.storedInitParams.tools,
			this.storedInitParams.services,
		);
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
	 * Configure automatic token refresh behavior
	 */
	setTokenRefreshConfig(config: Partial<TokenRefreshConfig>): void {
		this.tokenRefreshConfig = { ...this.tokenRefreshConfig, ...config };
	}

	/**
	 * Check if token needs refresh based on current time and config
	 */
	protected needsTokenRefresh(): boolean {
		const now = Date.now();
		return (
			(this.tokenRotateAt !== undefined && now >= this.tokenRotateAt - this.tokenRefreshConfig.bufferMs) ||
			(this.tokenExpiresAt !== undefined && now >= this.tokenExpiresAt)
		);
	}

	/**
	 * Refresh token if needed (past rotateAt time or expired).
	 * This is called automatically before requests when autoRefresh is enabled.
	 * Uses a shared promise to prevent concurrent refresh requests.
	 *
	 * Refresh works by re-initializing the session (calling init() again),
	 * so it does not depend on the old session still existing in the server's cache.
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

		// Check if we need to refresh
		if (!this.needsTokenRefresh()) {
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
	 * Update token state after successful init or refresh
	 */
	protected updateTokenState(credentials: TokenCredentials): void {
		this.clientId = credentials.clientId;
		this.clientToken = credentials.token;
		this.tokenExpiresAt = credentials.expiresAt;
		this.tokenRotateAt = credentials.tokenRotateAt;
	}

	/**
	 * Check if URL should skip token refresh (to avoid infinite recursion).
	 * Since refresh now calls init(), we only need to guard the init path.
	 */
	protected shouldSkipRefreshForUrl(url: string): boolean {
		return url.includes('/api/init');
	}
}
