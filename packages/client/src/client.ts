import type {
	ExecutionResult,
	ExecutionConfig,
	SearchOptions,
	SearchResult,
	ClientTool,
	ExploreResult,
} from '@mondaydotcomorg/atp-protocol';
import type { RuntimeAPIName } from '@mondaydotcomorg/atp-runtime';
import { CallbackType } from '@mondaydotcomorg/atp-protocol';
import {
	type ClientLLMHandler,
	type ClientApprovalHandler,
	type ClientEmbeddingHandler,
	type ClientServiceProviders,
	type ClientHooks,
	ClientSession,
	APIOperations,
	ExecutionOperations,
	ServiceProviders,
} from './core/index.js';

/**
 * Options for creating an AgentToolProtocolClient
 */
export interface AgentToolProtocolClientOptions {
	/** Base URL of the Agent Tool Protocol server */
	baseUrl: string;
	/** Optional headers for authentication (e.g., { Authorization: 'Bearer token' }) */
	headers?: Record<string, string>;
	/** Optional client-provided services (LLM, approval, embedding) */
	serviceProviders?: ClientServiceProviders;
	/** Optional hooks for intercepting and modifying client behavior */
	hooks?: ClientHooks;
}

/**
 * AgentToolProtocolClient provides a client interface for connecting to
 * Agent Tool Protocol servers and executing code.
 */
export class AgentToolProtocolClient {
	private session: ClientSession;
	private apiOps: APIOperations;
	private execOps: ExecutionOperations;
	private serviceProviders: ServiceProviders;

	/**
	 * Creates a new client instance.
	 *
	 * @example
	 * ```typescript
	 * const client = new AgentToolProtocolClient({
	 *   baseUrl: 'http://localhost:3333',
	 *   headers: { Authorization: 'Bearer token' },
	 *   hooks: {
	 *     preRequest: async (context) => {
	 *       const token = await refreshToken();
	 *       return { headers: { ...context.currentHeaders, Authorization: `Bearer ${token}` } };
	 *     }
	 *   }
	 * });
	 * ```
	 */
	constructor(options: AgentToolProtocolClientOptions) {
		const { baseUrl, headers, serviceProviders, hooks } = options;
		this.session = new ClientSession(baseUrl, headers, hooks);
		this.serviceProviders = new ServiceProviders(serviceProviders);
		this.apiOps = new APIOperations(this.session);
		this.execOps = new ExecutionOperations(this.session, this.serviceProviders);
	}

	/**
	 * Initializes the client session with the server.
	 * Automatically registers any client-provided tools and services with the server.
	 */
	async init(clientInfo?: { name?: string; version?: string; [key: string]: unknown }): Promise<{
		clientId: string;
		token: string;
		expiresAt: number;
		tokenRotateAt: number;
	}> {
		const toolDefinitions = this.serviceProviders.getToolDefinitions();
		const services = {
			hasLLM: !!this.serviceProviders.getLLM(),
			hasApproval: !!this.serviceProviders.getApproval(),
			hasEmbedding: !!this.serviceProviders.getEmbedding(),
			hasTools: this.serviceProviders.hasTools(),
		};
		return await this.session.init(clientInfo, toolDefinitions, services);
	}

	/**
	 * Gets the unique client ID.
	 */
	getClientId(): string {
		return this.session.getClientId();
	}

	/**
	 * Provides an LLM implementation for server to use during execution.
	 */
	provideLLM(handler: ClientLLMHandler): void {
		this.serviceProviders.provideLLM(handler);
	}

	/**
	 * Provides an approval handler for server to request human approval.
	 */
	provideApproval(handler: ClientApprovalHandler): void {
		this.serviceProviders.provideApproval(handler);
	}

	/**
	 * Provides an embedding model for server to use.
	 */
	provideEmbedding(handler: ClientEmbeddingHandler): void {
		this.serviceProviders.provideEmbedding(handler);
	}

	/**
	 * Provides custom tools that execute on the client side.
	 * Note: Must be called before init() or re-initialize after calling this.
	 */
	provideTools(tools: ClientTool[]): void {
		this.serviceProviders.provideTools(tools);
	}

	/**
	 * Connects to the server and retrieves API definitions.
	 */
	async connect(options?: { apiGroups?: string[] }): Promise<{
		serverVersion: string;
		capabilities: unknown;
		apiGroups: string[];
	}> {
		return await this.apiOps.connect(options);
	}

	/**
	 * Gets the TypeScript type definitions for available APIs.
	 */
	getTypeDefinitions(): string {
		return this.apiOps.getTypeDefinitions();
	}

	/**
	 * Searches for available API functions.
	 */
	async searchAPI(query: string, options?: SearchOptions): Promise<SearchResult[]> {
		return await this.apiOps.searchAPI(query, options);
	}

	/**
	 * Explores the API filesystem at the given path.
	 */
	async exploreAPI(path: string): Promise<ExploreResult> {
		return await this.apiOps.exploreAPI(path);
	}

	/**
	 * Executes code on the server with real-time progress updates via SSE.
	 */
	async executeStream(
		code: string,
		config?: Partial<ExecutionConfig>,
		onProgress?: (message: string, fraction: number) => void
	): Promise<ExecutionResult> {
		return await this.execOps.executeStream(code, config, onProgress);
	}

	/**
	 * Executes code on the server in a sandboxed environment.
	 */
	async execute(code: string, config?: Partial<ExecutionConfig>): Promise<ExecutionResult> {
		return await this.execOps.execute(code, config);
	}

	/**
	 * Resumes a paused execution with a callback result.
	 */
	async resume(executionId: string, callbackResult: unknown): Promise<ExecutionResult> {
		return await this.execOps.resume(executionId, callbackResult);
	}

	/**
	 * Handles a callback request from the server during execution.
	 */
	async handleCallback(callbackType: CallbackType, payload: any): Promise<any> {
		return await this.serviceProviders.handleCallback(callbackType, payload);
	}

	/**
	 * Gets information about the server.
	 */
	async getServerInfo(): Promise<{
		version: string;
		capabilities: Record<string, boolean>;
	}> {
		return await this.apiOps.getServerInfo();
	}

	/**
	 * Gets ATP runtime API definitions as TypeScript declarations.
	 * Returns the full TypeScript definitions for atp.llm.*, atp.cache.*, etc.
	 * These are the APIs available during code execution.
	 *
	 * Behavior:
	 * - No options: Returns APIs based on client capabilities (default filtering)
	 * - apis: ['llm', 'cache']: Returns only specified APIs (intersection with client capabilities)
	 * - apis: []: Returns all APIs regardless of client capabilities
	 *
	 * @param options - Optional filtering options
	 * @param options.apis - Specific APIs to include (e.g., ['llm', 'cache', 'approval'])
	 */
	async getRuntimeDefinitions(options?: { apis?: RuntimeAPIName[] }): Promise<string> {
		return await this.apiOps.getRuntimeDefinitions(options);
	}
}
