import { createServer as createHTTPServer, IncomingMessage, ServerResponse } from 'node:http';
import type {
	CacheProvider,
	AuthProvider,
	AuditSink,
	APIGroupConfig,
	AuditEvent,
	ToolMetadata,
} from '@mondaydotcomorg/atp-protocol';
import { ProvenanceMode } from '@mondaydotcomorg/atp-protocol';
import { log, initializeLogger } from '@mondaydotcomorg/atp-runtime';
import { shutdownLogger } from '@mondaydotcomorg/atp-runtime';
import type { RuntimeAPIName } from '@mondaydotcomorg/atp-runtime';
import type {
	ServerConfig,
	Middleware,
	RequestContext,
	ResolvedServerConfig,
} from './core/config.js';
import { MB, HOUR, MINUTE } from './core/config.js';
import { ClientSessionManager } from './client-sessions.js';
import { SandboxExecutor } from './executor/index.js';
import { CodeValidator } from './validator/index.js';
import { SearchEngine } from './search/index.js';
import { ExecutionStateManager } from './execution-state/index.js';
import { ExplorerService } from './explorer/index.js';
import { toJSONSchema, printBanner, getServerInfo } from './utils/index.js';
import { handleHTTPRequest } from './http/request-handler.js';
import { handleRoute } from './http/router.js';
import { handleInit } from './handlers/init.handler.js';
import { handleSearch, handleSearchQuery } from './handlers/search.handler.js';
import { handleExplore } from './handlers/explorer.handler.js';
import { handleExecute } from './handlers/execute.handler.js';
import { handleResume } from './handlers/resume.handler.js';
import { getDefinitions } from './handlers/definitions.handler.js';
import { shutdownAudit } from './middleware/audit.js';
import {
	EnvAuthProvider,
	MemoryCache,
	OpenTelemetryAuditSink,
} from '@mondaydotcomorg/atp-providers';
import { APIAggregator } from './aggregator/index.js';

export class AgentToolProtocolServer {
	private config: ResolvedServerConfig;
	private middleware: Middleware[] = [];
	private apiGroups: APIGroupConfig[] = [];
	private httpServer: ReturnType<typeof createHTTPServer> | null = null;
	private responseHeaders: Map<IncomingMessage, Map<string, string>> = new Map();
	private isRunning: boolean = false;
	sessionManager?: ClientSessionManager;
	executor?: SandboxExecutor;
	validator?: CodeValidator;
	searchEngine?: SearchEngine;
	explorerService?: ExplorerService;
	stateManager?: ExecutionStateManager;
	approvalHandler?: (request: {
		message: string;
		context?: any;
	}) => Promise<{ approved: boolean; data?: any }>;

	cacheProvider?: CacheProvider;
	authProvider?: AuthProvider;
	auditSink?: AuditSink;
	private customLogger?: any;

	constructor(config: ServerConfig = {}) {
		this.config = {
			execution: {
				timeout: config.execution?.timeout ?? 30000,
				memory: config.execution?.memory ?? 128 * MB,
				llmCalls: config.execution?.llmCalls ?? 10,
				provenanceMode: config.execution?.provenanceMode ?? ProvenanceMode.NONE,
				securityPolicies: config.execution?.securityPolicies ?? [],
			},
			clientInit: {
				tokenTTL: config.clientInit?.tokenTTL ?? HOUR,
				tokenRotation: config.clientInit?.tokenRotation ?? 30 * MINUTE,
			},
			executionState: {
				ttl: config.executionState?.ttl ?? 3600,
				maxPauseDuration: config.executionState?.maxPauseDuration ?? 3600,
			},
			discovery: {
				embeddings: config.discovery?.embeddings ?? false,
			},
			audit: {
				enabled: config.audit?.enabled ?? false,
				sinks: config.audit?.sinks,
			},
			otel: {
				enabled: config.otel?.enabled ?? false,
				serviceName:
					config.otel?.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'agent-tool-protocol',
				serviceVersion: config.otel?.serviceVersion ?? process.env.OTEL_SERVICE_VERSION ?? '1.0.0',
				traceEndpoint:
					config.otel?.traceEndpoint ??
					process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
					(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
						? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
						: 'http://localhost:4318/v1/traces'),
				metricsEndpoint:
					config.otel?.metricsEndpoint ??
					process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
					(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
						? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`
						: 'http://localhost:4318/v1/metrics'),
				headers:
					config.otel?.headers ?? this.parseOtelHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
				metricsInterval: config.otel?.metricsInterval ?? 60000,
				resourceAttributes: config.otel?.resourceAttributes ?? {},
			},
			logger: config.logger ?? 'info',
		};

		if (config.providers) {
			if (config.providers.cache) {
				this.cacheProvider = config.providers.cache;
				log.info('Cache provider configured', { provider: config.providers.cache.name });
			}
			if (config.providers.auth) {
				this.authProvider = config.providers.auth;
				log.info('Token store configured', { provider: config.providers.auth.name });
			}
		}

		if (!this.cacheProvider) {
			this.cacheProvider = new MemoryCache({ maxKeys: 1000, defaultTTL: 3600 });
			log.info('Cache provider configured (default)', { provider: 'memory' });
		}

		if (!this.authProvider) {
			this.authProvider = new EnvAuthProvider();
			log.info('Token store configured (default)', { provider: 'env' });
		}

		if (this.config.otel.enabled && !this.config.audit.sinks) {
			this.config.audit.enabled = true;
			this.config.audit.sinks = [new OpenTelemetryAuditSink()];
			log.info('Auto-configured OpenTelemetry audit sink from otel config');
		}

		if (this.config.audit.enabled && this.config.audit.sinks) {
			const auditSinks = Array.isArray(this.config.audit.sinks)
				? this.config.audit.sinks
				: [this.config.audit.sinks];

			if (auditSinks.length > 1) {
				this.auditSink = {
					name: 'multi',
					async write(event: AuditEvent) {
						await Promise.all(auditSinks.map((s: AuditSink) => s.write(event)));
					},
					async writeBatch(events: AuditEvent[]) {
						await Promise.all(auditSinks.map((s: AuditSink) => s.writeBatch(events)));
					},
				};
				log.info('Audit sinks configured', { count: auditSinks.length });
			} else {
				this.auditSink = auditSinks[0];
				log.info('Audit sink configured', { sink: auditSinks[0]?.name });
			}
		}

		if (typeof this.config.logger === 'string') {
			initializeLogger({
				level: this.config.logger,
				pretty: process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test',
			});
		} else {
			this.customLogger = this.config.logger;
		}
	}

	/**
	 * Register middleware or API groups.
	 * SECURITY: Cannot be called after server starts to prevent runtime injection attacks.
	 * @throws {Error} If called after listen() or handler()
	 */
	use(...items: (Middleware | APIGroupConfig | APIGroupConfig[])[]): this {
		if (this.isRunning) {
			throw new Error('Cannot add middleware or API groups after server has started. ');
		}

		for (const item of items) {
			if (Array.isArray(item)) {
				this.apiGroups.push(...item);
			} else if (typeof item === 'function') {
				this.middleware.push(item);
			} else if ('name' in item && 'type' in item) {
				this.apiGroups.push(item);
			}
		}
		return this;
	}

	/**
	 * Register a tool/function with optional hierarchical grouping.
	 * Supports hierarchical paths like 'github/readOnly' for better organization.
	 * All functions registered here will be exposed as api.{group}.{name}()
	 *
	 * @param name - Function name
	 * @param definition - Function definition including description, input schema, handler
	 * @param definition.group - Optional hierarchical group path (e.g., 'github/readOnly'). Defaults to 'custom'
	 *
	 * @example
	 * // Simple function in default 'custom' group -> api.custom.hello()
	 * server.tool('hello', {
	 *   description: 'Say hello',
	 *   input: { name: 'string' },
	 *   handler: async (input) => ({ message: `Hello ${input.name}` })
	 * });
	 *
	 * // Hierarchical grouping -> api.github.readOnly.getUser()
	 * server.tool('getUser', {
	 *   group: 'github/readOnly',
	 *   description: 'Get GitHub user',
	 *   input: { username: 'string' },
	 *   handler: async (input) => ({ username: input.username })
	 * });
	 */
	tool(
		name: string,
		definition: {
			group?: string;
			description: string;
			input: Record<string, string>;
			output?: Record<string, string>;
			handler: (input: unknown) => Promise<unknown>;
			metadata?: ToolMetadata;
		}
	): this {
		const groupName = definition.group || 'custom';

		let targetGroup = this.apiGroups.find((g) => g.name === groupName);
		if (!targetGroup) {
			targetGroup = {
				name: groupName,
				type: 'custom',
				functions: [],
			};
			this.apiGroups.push(targetGroup);
		}

		targetGroup.functions!.push({
			name,
			description: definition.description,
			inputSchema: toJSONSchema(definition.input),
			outputSchema: definition.output ? toJSONSchema(definition.output) : undefined,
			handler: definition.handler,
			metadata: definition.metadata,
		});
		return this;
	}

	/**
	 * Configure approval handler for human-in-the-loop operations
	 * The handler will be called when code requests approval via atp.approval.request()
	 */
	onApproval(
		handler: (request: {
			message: string;
			context?: any;
		}) => Promise<{ approved: boolean; data?: any }>
	): this {
		this.approvalHandler = handler;
		log.info('Approval handler configured');
		return this;
	}

	async listen(port: number): Promise<void> {
		if (this.httpServer) {
			throw new Error('Server is already running');
		}

		this.isRunning = true;

		this.sessionManager = new ClientSessionManager({
			cache: this.cacheProvider,
			tokenTTL: this.config.clientInit.tokenTTL,
			tokenRotation: this.config.clientInit.tokenRotation,
		});

		this.validator = new CodeValidator();
		this.executor = new SandboxExecutor(
			{
				defaultTimeout: this.config.execution.timeout,
				maxTimeout: this.config.execution.timeout * 2,
				defaultMemoryLimit: this.config.execution.memory,
				maxMemoryLimit: this.config.execution.memory * 2,
				defaultLLMCallLimit: this.config.execution.llmCalls,
				maxLLMCallLimit: this.config.execution.llmCalls * 2,
				cacheProvider: this.cacheProvider,
			},
			this.apiGroups,
			this.approvalHandler,
			this.sessionManager
		);

		for (const group of this.apiGroups) {
			log.info(`  - ${group.name}: ${group.functions?.length || 0} functions`);
		}

		this.searchEngine = new SearchEngine(this.apiGroups);
		this.explorerService = new ExplorerService(this.apiGroups);
		this.stateManager = new ExecutionStateManager(this.cacheProvider!, {
			ttl: this.config.executionState.ttl,
			maxPauseDuration: this.config.executionState.maxPauseDuration,
			keyPrefix: this.config.executionState.keyPrefix,
		});

		this.httpServer = createHTTPServer((req, res) => {
			handleHTTPRequest(
				req,
				res,
				{
					cacheProvider: this.cacheProvider,
					authProvider: this.authProvider,
					auditSink: this.auditSink,
					customLogger: this.customLogger,
					middleware: this.middleware,
					routeHandler: (ctx) => handleRoute(ctx, this),
					sessionManager: this.sessionManager,
				},
				this.responseHeaders
			).catch((error) => {
				log.error('Unhandled error in HTTP request handler:', error);
				try {
					if (!res.headersSent) {
						res.writeHead(500, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'Internal server error' }));
					}
				} catch (e) {}
			});
		});

		if (process.env.NODE_ENV === 'test') {
			this.httpServer.keepAliveTimeout = 5000;
			this.httpServer.headersTimeout = 6000;
		}

		return new Promise((resolve, reject) => {
			this.httpServer!.listen(port, () => {
				printBanner({
					port,
					cacheProvider: this.cacheProvider,
					authProvider: this.authProvider,
					auditSink: this.auditSink,
				});
				resolve();
			});
			this.httpServer!.on('error', reject);
		});
	}

	async stop(): Promise<void> {
		if (!this.httpServer) return;

		this.httpServer.closeAllConnections?.();

		await new Promise<void>((resolve, reject) => {
			this.httpServer!.close((err) => (err ? reject(err) : resolve()));
		});

		shutdownAudit();
		shutdownLogger();

		await Promise.all([
			this.cacheProvider?.disconnect?.(),
			this.authProvider?.disconnect?.(),
			this.auditSink?.disconnect?.(),
			this.stateManager?.close(),
			this.sessionManager?.cleanupAll(),
		]);

		this.isRunning = false;
	}

	getInfo(): unknown {
		return getServerInfo({
			maxTimeout: this.config.execution.timeout,
			maxMemory: this.config.execution.memory,
			maxLLMCalls: this.config.execution.llmCalls,
		});
	}

	async getDefinitions(ctx?: RequestContext): Promise<unknown> {
		const definitions = await getDefinitions(this.apiGroups);

		if (ctx && ctx.clientId && this.sessionManager) {
			const session = await this.sessionManager.getSession(ctx.clientId);
			if (session?.guidance) {
				return {
					...(definitions as object),
					guidance: session.guidance,
				};
			}
		}

		return definitions;
	}

	async getRuntimeDefinitions(ctx?: RequestContext): Promise<string> {
		const aggregator = new APIAggregator(this.apiGroups);
		
		let requestedApis: RuntimeAPIName[] | undefined;
		if (ctx?.query?.apis) {
			requestedApis = ctx.query.apis
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean) as RuntimeAPIName[];
		}
		
		let clientServices: { hasLLM: boolean; hasApproval: boolean; hasEmbedding: boolean; hasTools: boolean } | undefined;
		
		if (ctx?.clientId && this.sessionManager) {
			try {
				const session = await this.sessionManager.getSession(ctx.clientId);
				if (session?.services) {
					clientServices = session.services;
				}
			} catch (error) {}
		}
		
		return aggregator.generateRuntimeTypes({
			clientServices,
			requestedApis,
		});
	}

	async handleInit(ctx: RequestContext): Promise<unknown> {
		if (!this.sessionManager) ctx.throw(503, 'Session manager not initialized');
		return await handleInit(ctx, this.sessionManager, this.auditSink);
	}

	async handleSearch(ctx: RequestContext): Promise<unknown> {
		if (!this.searchEngine) ctx.throw(503, 'Search not initialized');
		return await handleSearch(ctx, this.searchEngine, this.config);
	}

	async handleSearchQuery(ctx: RequestContext): Promise<unknown> {
		if (!this.searchEngine) ctx.throw(503, 'Search not initialized');
		return await handleSearchQuery(ctx, this.searchEngine, this.config);
	}

	async handleExplore(ctx: RequestContext): Promise<unknown> {
		if (!this.explorerService) ctx.throw(503, 'Explorer not initialized');
		return await handleExplore(ctx, this.explorerService);
	}

	async handleExecute(ctx: RequestContext): Promise<unknown> {
		if (!this.executor || !this.validator || !this.stateManager) {
			ctx.throw(503, 'Execution not initialized');
		}
		return await handleExecute(
			ctx,
			this.executor,
			this.stateManager,
			this.config,
			this.auditSink,
			this.sessionManager
		);
	}

	async handleResume(ctx: RequestContext, executionId: string): Promise<unknown> {
		if (!this.executor || !this.stateManager) {
			ctx.throw(503, 'Execution not initialized');
		}
		return await handleResume(
			ctx,
			executionId,
			this.executor,
			this.stateManager,
			this.config,
			this.sessionManager
		);
	}

	/**
	 * Get raw Node.js request handler for framework integration
	 * Use this to integrate ATP with Express, Fastify, or any Node.js framework
	 */
	handler(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
		if (
			!this.executor ||
			!this.validator ||
			!this.stateManager ||
			!this.sessionManager ||
			!this.searchEngine ||
			!this.explorerService
		) {
			throw new Error(
				'Server not initialized. Call listen() first or initialize components manually.'
			);
		}

		this.isRunning = true;

		return (req, res) =>
			handleHTTPRequest(
				req,
				res,
				{
					cacheProvider: this.cacheProvider,
					authProvider: this.authProvider,
					auditSink: this.auditSink,
					customLogger: this.customLogger,
					middleware: this.middleware,
					routeHandler: (ctx) => handleRoute(ctx, this),
					sessionManager: this.sessionManager,
				},
				this.responseHeaders
			);
	}

	/**
	 * Get Express middleware
	 * @example
	 * const app = express();
	 * app.use('/atp', server.toExpress());
	 */
	toExpress(): (req: unknown, res: unknown, next: (err?: unknown) => void) => void {
		const requestHandler = this.handler();
		return (req: unknown, res: unknown, next: (err?: unknown) => void) => {
			requestHandler(req as IncomingMessage, res as ServerResponse).catch(next);
		};
	}

	/**
	 * Get Fastify handler
	 * @example
	 * fastify.all('/atp/*', server.toFastify());
	 */
	toFastify(): (request: unknown, reply: unknown) => Promise<void> {
		const requestHandler = this.handler();
		return async (request: unknown, reply: unknown) => {
			const req = (request as { raw: IncomingMessage }).raw;
			const res = (reply as { raw: ServerResponse }).raw;
			await requestHandler(req, res);
		};
	}

	/**
	 * Parse OpenTelemetry headers from environment variable format
	 * Format: "key1=value1,key2=value2"
	 */
	private parseOtelHeaders(headersStr?: string): Record<string, string> {
		if (!headersStr) return {};

		const headers: Record<string, string> = {};
		const pairs = headersStr.split(',');

		for (const pair of pairs) {
			const [key, value] = pair.split('=');
			if (key && value) {
				headers[key.trim()] = value.trim();
			}
		}

		return headers;
	}
}

export function createServer(config?: ServerConfig): AgentToolProtocolServer {
	return new AgentToolProtocolServer(config);
}
