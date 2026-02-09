import type { ClientToolDefinition } from '@mondaydotcomorg/atp-protocol';
import type { ClientHooks, TokenRefreshConfig } from './types.js';
import { BaseSession, type TokenCredentials } from './base-session.js';

/**
 * HTTP-based session for connecting to remote ATP servers.
 */
export class ClientSession extends BaseSession {
	private baseUrl: string;
	private customHeaders: Record<string, string>;
	private hooks?: ClientHooks;

	constructor(
		baseUrl: string,
		headers?: Record<string, string>,
		hooks?: ClientHooks,
		tokenRefreshConfig?: Partial<TokenRefreshConfig>
	) {
		super(tokenRefreshConfig);
		this.baseUrl = baseUrl;
		this.customHeaders = headers || {};
		this.hooks = hooks;
	}

	/**
	 * Initializes the client session with the server.
	 * This MUST be called before any other operations.
	 * The server generates and returns a unique client ID and token.
	 */
	async init(
		clientInfo?: { name?: string; version?: string; [key: string]: unknown },
		tools?: ClientToolDefinition[],
		services?: { hasLLM: boolean; hasApproval: boolean; hasEmbedding: boolean; hasTools: boolean }
	): Promise<TokenCredentials> {
		// Store init params so doRefreshToken() can re-init with the same data
		this.storedInitParams = { clientInfo, tools, services };

		if (this.initPromise) {
			await this.initPromise;
			return {
				clientId: this.clientId!,
				token: this.clientToken!,
				expiresAt: this.tokenExpiresAt!,
				tokenRotateAt: this.tokenRotateAt!,
			};
		}

		let initResult: TokenCredentials;

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

			const data = (await response.json()) as TokenCredentials;
			this.updateTokenState(data);
			initResult = data;
		})();

		await this.initPromise;

		return initResult!;
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
	 * Prepares headers for a request, refreshing token if needed and calling preRequest hook if configured
	 */
	async prepareHeaders(
		method: string,
		url: string,
		body?: unknown
	): Promise<Record<string, string>> {
		// Refresh token if needed BEFORE preparing headers
		if (!this.shouldSkipRefreshForUrl(url)) {
			await this.refreshTokenIfNeeded();
		}

		let headers = this.getHeaders();

		if (this.hooks?.preRequest) {
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
		}

		return headers;
	}
}
