import type { ClientHooks } from './types.js';
import type { ClientToolDefinition } from '@mondaydotcomorg/atp-protocol';

export class ClientSession {
	private baseUrl: string;
	private customHeaders: Record<string, string>;
	private clientId?: string;
	private clientToken?: string;
	private initPromise?: Promise<void>;
	private hooks?: ClientHooks;

	constructor(baseUrl: string, headers?: Record<string, string>, hooks?: ClientHooks) {
		this.baseUrl = baseUrl;
		this.customHeaders = headers || {};
		this.hooks = hooks;
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
				expiresAt: 0,
				tokenRotateAt: 0,
			};
		}

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
		})();

		await this.initPromise;

		return {
			clientId: this.clientId!,
			token: this.clientToken!,
			expiresAt: 0,
			tokenRotateAt: 0,
		};
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
		if (newToken) {
			this.clientToken = newToken;
		}
	}

	/**
	 * Prepares headers for a request, calling preRequest hook if configured
	 */
	async prepareHeaders(
		method: string,
		url: string,
		body?: unknown
	): Promise<Record<string, string>> {
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
