import type { ClientToolDefinition } from '@mondaydotcomorg/atp-protocol';
import type { ISession } from './session.js';

interface InProcessServer {
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

interface InProcessRequestContext {
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

export class InProcessSession implements ISession {
	private server: InProcessServer;
	private clientId?: string;
	private clientToken?: string;
	private initialized: boolean = false;
	private initPromise?: Promise<void>;

	constructor(server: InProcessServer) {
		this.server = server;
	}

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
			await this.server.start();

			const ctx = this.createContext({
				method: 'POST',
				path: '/api/init',
				body: {
					clientInfo,
					tools: tools || [],
					services,
				},
			});

			const result = (await this.server.handleInit(ctx)) as {
				clientId: string;
				token: string;
				expiresAt: number;
				tokenRotateAt: number;
			};

			this.clientId = result.clientId;
			this.clientToken = result.token;
			this.initialized = true;
		})();

		await this.initPromise;

		return {
			clientId: this.clientId!,
			token: this.clientToken!,
			expiresAt: 0,
			tokenRotateAt: 0,
		};
	}

	getClientId(): string {
		if (!this.clientId) {
			throw new Error('Client not initialized. Call init() first.');
		}
		return this.clientId;
	}

	async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			throw new Error('Client not initialized. Call init() first.');
		}
	}

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

	updateToken(_response: Response): void {
		// No-op for in-process - tokens are managed directly
	}

	async prepareHeaders(
		_method: string,
		_url: string,
		_body?: unknown
	): Promise<Record<string, string>> {
		return this.getHeaders();
	}

	async getDefinitions(options?: { apiGroups?: string[] }): Promise<{
		typescript: string;
		version: string;
		apiGroups: string[];
	}> {
		await this.ensureInitialized();

		const ctx = this.createContext({
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

		const ctx = this.createContext({
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

		const ctx = this.createContext({
			method: 'POST',
			path: '/api/search',
			body: { query, ...options },
		});

		return (await this.server.handleSearch(ctx)) as { results: unknown[] };
	}

	async explore(path: string): Promise<unknown> {
		await this.ensureInitialized();

		const ctx = this.createContext({
			method: 'POST',
			path: '/api/explore',
			body: { path },
		});

		return await this.server.handleExplore(ctx);
	}

	async execute(code: string, config?: Record<string, unknown>): Promise<unknown> {
		await this.ensureInitialized();

		const ctx = this.createContext({
			method: 'POST',
			path: '/api/execute',
			body: { code, config },
		});

		return await this.server.handleExecute(ctx);
	}

	async resume(executionId: string, callbackResult: unknown): Promise<unknown> {
		await this.ensureInitialized();

		const ctx = this.createContext({
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

		const ctx = this.createContext({
			method: 'POST',
			path: `/api/resume/${executionId}`,
			body: { results: batchResults },
		});

		return await this.server.handleResume(ctx, executionId);
	}

	private createContext(options: {
		method: string;
		path: string;
		query?: Record<string, string>;
		body?: unknown;
	}): InProcessRequestContext {
		const noopLogger = {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
		};

		return {
			method: options.method,
			path: options.path,
			query: options.query || {},
			headers: this.getHeaders(),
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

