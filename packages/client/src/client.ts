import type {
	ExecutionResult,
	ExecutionConfig,
	SearchOptions,
	SearchResult,
	ClientTool,
	ClientToolDefinition,
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
	type ISession,
	ClientSession,
	InProcessSession,
	APIOperations,
	ExecutionOperations,
	ServiceProviders,
} from './core/index.js';
import {
	type Tool,
	createSearchApiTool,
	createFetchAllApisTool,
	createExecuteCodeTool,
	createExploreApiTool,
} from './tools/index.js';

interface InProcessServer {
	start(): Promise<void>;
	handleInit(ctx: unknown): Promise<unknown>;
	getDefinitions(ctx?: unknown): Promise<unknown>;
	getRuntimeDefinitions(ctx?: unknown): Promise<string>;
	getInfo(): unknown;
	handleSearch(ctx: unknown): Promise<unknown>;
	handleExplore(ctx: unknown): Promise<unknown>;
	handleExecute(ctx: unknown): Promise<unknown>;
	handleResume(ctx: unknown, executionId: string): Promise<unknown>;
}

/**
 * Options for creating an AgentToolProtocolClient
 */
export interface AgentToolProtocolClientOptions {
	/** Base URL of the Agent Tool Protocol server (HTTP mode) */
	baseUrl?: string;
	/** Server instance for in-process mode (no HTTP, no port binding) */
	server?: InProcessServer;
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
	private session: ISession;
	private inProcessSession?: InProcessSession;
	private apiOps: APIOperations;
	private execOps: ExecutionOperations;
	private serviceProviders: ServiceProviders;

	/**
	 * Creates a new client instance.
	 *
	 * @example
	 * ```typescript
	 * // HTTP mode
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
	 *
	 * // In-process mode (no port binding)
	 * const server = createServer();
	 * server.use(myApiGroup);
	 * const client = new AgentToolProtocolClient({ server });
	 * ```
	 */
	constructor(options: AgentToolProtocolClientOptions) {
		const { baseUrl, server, headers, serviceProviders, hooks } = options;

		if (!baseUrl && !server) {
			throw new Error('Either baseUrl or server must be provided');
		}

		if (baseUrl && server) {
			throw new Error('Cannot provide both baseUrl and server');
		}

		this.serviceProviders = new ServiceProviders(serviceProviders);

		if (server) {
			this.inProcessSession = new InProcessSession(server);
			this.session = this.inProcessSession;
			this.apiOps = new APIOperations(this.session, this.inProcessSession);
			this.execOps = new ExecutionOperations(this.session, this.serviceProviders, this.inProcessSession);
		} else {
			this.session = new ClientSession(baseUrl!, headers, hooks);
			this.apiOps = new APIOperations(this.session);
			this.execOps = new ExecutionOperations(this.session, this.serviceProviders);
		}
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
	 * Gets all client-provided tools (registered via provideTools).
	 * Returns the full tool objects including handlers.
	 */
	getClientTools(): ClientTool[] {
		return this.serviceProviders.getTools() || [];
	}

	/**
	 * Gets client-provided tool definitions (without handlers).
	 * Useful for sending tool metadata to servers.
	 */
	getClientToolDefinitions(): ClientToolDefinition[] {
		return this.serviceProviders.getToolDefinitions();
	}

	/**
	 * Gets the ATP tools (execute_code, explore_api, search_api, fetch_all_apis).
	 * These are ready-to-use tools that can be exposed to MCP or other frameworks.
	 *
	 * @example
	 * ```typescript
	 * const tools = client.getATPTools();
	 * for (const tool of tools) {
	 *   mcpServer.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
	 *     const result = await tool.func(args);
	 *     return { content: [{ type: 'text', text: result }] };
	 *   });
	 * }
	 * ```
	 */
	getATPTools(): Tool[] {
		return [
			createSearchApiTool(this),
			createFetchAllApisTool(this),
			createExecuteCodeTool(this),
			createExploreApiTool(this),
		];
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
