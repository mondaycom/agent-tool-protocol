import type { ClientToolDefinition } from '@mondaydotcomorg/atp-protocol';
import type { TokenRefreshConfig } from './types.js';
import { BaseSession, type TokenCredentials } from './base-session.js';

/**
 * Server interface for in-process communication
 */
export interface InProcessServer {
	start(): Promise<void>;
	handleInit(ctx: InProcessRequestContext): Promise<unknown>;
	getDefinitions(ctx?: InProcessRequestContext): Promise<unknown>;
	getRuntimeDefinitions(ctx?: InProcessRequestContext): Promise<string>;
	getInfo(): unknown;
	handleSearch(ctx: InProcessRequestContext): Promise<unknown>;
	handleExplore(ctx: InProcessRequestContext): Promise<unknown>;
	handleExecute(ctx: InProcessRequestContext): Promise<unknown>;
	handleResume(ctx: InProcessRequestContext, executionId: string): Promise<unknown>;
}

/**
 * Request context for in-process server calls
 */
export interface InProcessRequestContext {
	method: string;
	path: string;
	query: Record<string, string>;
	headers: Record<string, string>;
	body: unknown;
	clientId?: string;
	clientToken?: string;
	userId?: string;
	user?: unknown;
	executionId?: string;
	code?: string;
	validation?: unknown;
	result?: unknown;
	error?: Error;
	logger: { debug: () => void; info: () => void; warn: () => void; error: () => void };
	status: number;
	responseBody: unknown;
	throw(status: number, message: string): never;
	assert(condition: boolean, message: string): asserts condition;
	set(header: string, value: string): void;
}

/**
 * In-process session for direct server communication without HTTP.
 * Used when the client and server run in the same process.
 */
export class InProcessSession extends BaseSession {
	private server: InProcessServer;
	private initialized: boolean = false;

	constructor(server: InProcessServer, tokenRefreshConfig?: Partial<TokenRefreshConfig>) {
		super(tokenRefreshConfig);
		this.server = server;
	}

	/**
	 * Initializes the client session with the in-process server.
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
			await this.server.start();

			const ctx = await this.createContext({
				method: 'POST',
				path: '/api/init',
				body: {
					clientInfo,
					tools: tools || [],
					services,
				},
			});

			const result = (await this.server.handleInit(ctx)) as TokenCredentials;
			this.updateTokenState(result);
			this.initialized = true;
			initResult = result;
		})();

		await this.initPromise;

		return initResult!;
	}

	/**
	 * Ensures the client is initialized before making requests.
	 */
	async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			throw new Error('Client not initialized. Call init() first.');
		}
	}

	/**
	 * Creates headers for in-process requests (lowercase for consistency with Node.js)
	 */
	getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'content-type': 'application/json',
		};

		if (this.clientId) {
			headers['x-client-id'] = this.clientId;
		}

		if (this.clientToken) {
			headers['authorization'] = `Bearer ${this.clientToken}`;
		}

		return headers;
	}

	getBaseUrl(): string {
		return '';
	}

	/**
	 * Prepares headers for a request, refreshing token if needed
	 */
	async prepareHeaders(
		_method: string,
		url: string,
		_body?: unknown
	): Promise<Record<string, string>> {
		// Refresh token if needed BEFORE preparing headers
		if (!this.shouldSkipRefreshForUrl(url)) {
			await this.refreshTokenIfNeeded();
		}
		return this.getHeaders();
	}

	// ============================================
	// In-process specific methods for direct server calls
	// ============================================

	async getDefinitions(options?: { apiGroups?: string[] }): Promise<{
		typescript: string;
		version: string;
		apiGroups: string[];
	}> {
		await this.ensureInitialized();

		const ctx = await this.createContext({
			method: 'GET',
			path: '/api/definitions',
			query: options?.apiGroups ? { apiGroups: options.apiGroups.join(',') } : {},
		});

		return (await this.server.getDefinitions(ctx)) as {
			typescript: string;
			version: string;
			apiGroups: string[];
		};
	}

	async getRuntimeDefinitions(options?: { apis?: string[] }): Promise<string> {
		await this.ensureInitialized();

		const ctx = await this.createContext({
			method: 'GET',
			path: '/api/runtime',
			query: options?.apis?.length ? { apis: options.apis.join(',') } : {},
		});

		return await this.server.getRuntimeDefinitions(ctx);
	}

	async getServerInfo(): Promise<{
		version: string;
		capabilities: Record<string, boolean>;
	}> {
		await this.ensureInitialized();
		return this.server.getInfo() as {
			version: string;
			capabilities: Record<string, boolean>;
		};
	}

	async search(query: string, options?: Record<string, unknown>): Promise<{ results: unknown[] }> {
		await this.ensureInitialized();

		const ctx = await this.createContext({
			method: 'POST',
			path: '/api/search',
			body: { query, ...options },
		});

		return (await this.server.handleSearch(ctx)) as { results: unknown[] };
	}

	async explore(path: string, options?: Record<string, unknown>): Promise<unknown> {
		await this.ensureInitialized();

		// Per-call `headers` pulled out of options so it can merge into ctx.headers
		// (where the server's toolRulesProvider reads from). Stripped from the body
		// to avoid duplicating it alongside `path` + `toolRules`.
		const { headers: callerHeaders, ...body } = (options ?? {}) as {
			headers?: Record<string, string>;
			[k: string]: unknown;
		};

		const ctx = await this.createContext({
			method: 'POST',
			path: '/api/explore',
			body: { path, ...body },
			headers: callerHeaders,
		});

		return await this.server.handleExplore(ctx);
	}

	async execute(code: string, config?: Record<string, unknown>): Promise<unknown> {
		await this.ensureInitialized();

		// `requestContext.headers` is the documented entry point for per-call
		// header forwarding (consumed by openapi-loader headerProvider). Also
		// merge those into ctx.headers so the server-level toolRulesProvider
		// sees the same values.
		const rc = (config?.requestContext ?? {}) as { headers?: Record<string, string> };

		const ctx = await this.createContext({
			method: 'POST',
			path: '/api/execute',
			body: { code, config },
			headers: rc.headers,
		});

		return await this.server.handleExecute(ctx);
	}

	async resume(executionId: string, callbackResult: unknown): Promise<unknown> {
		await this.ensureInitialized();

		const ctx = await this.createContext({
			method: 'POST',
			path: `/api/resume/${executionId}`,
			body: { result: callbackResult },
		});

		return await this.server.handleResume(ctx, executionId);
	}

	async resumeWithBatchResults(
		executionId: string,
		batchResults: Array<{ id: string; result: unknown }>
	): Promise<unknown> {
		await this.ensureInitialized();

		const ctx = await this.createContext({
			method: 'POST',
			path: `/api/resume/${executionId}`,
			body: { results: batchResults },
		});

		return await this.server.handleResume(ctx, executionId);
	}

	/**
	 * Creates a request context for in-process server calls
	 */
	private async createContext(options: {
		method: string;
		path: string;
		query?: Record<string, string>;
		body?: unknown;
		headers?: Record<string, string>;
	}): Promise<InProcessRequestContext> {
		const noopLogger = {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
		};

		// Merge per-call headers (if any) on top of session-level headers.
		// Session auth keys (`x-client-id`, `authorization`) still survive
		// because `prepareHeaders` produces them first and the caller would
		// rarely override them; when they do, the caller's choice wins here —
		// match that with the RequestContext.headers convention.
		const sessionHeaders = await this.prepareHeaders(options.method, options.path, options.body);
		const mergedHeaders = options.headers
			? { ...sessionHeaders, ...options.headers }
			: sessionHeaders;

		return {
			method: options.method,
			path: options.path,
			query: options.query || {},
			headers: mergedHeaders,
			body: options.body,
			clientId: this.clientId,
			clientToken: this.clientToken,
			logger: noopLogger,
			status: 200,
			responseBody: null,
			throw: (status: number, message: string) => {
				const error = new Error(message);
				(error as Error & { status: number }).status = status;
				throw error;
			},
			assert: (condition: boolean, message: string) => {
				if (!condition) {
					throw new Error(message);
				}
			},
			set: () => {},
		};
	}
}
