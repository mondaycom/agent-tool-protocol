/**
 * ATPEngine - Embedded execution engine for Agent Tool Protocol
 * 
 * Direct, in-process code execution without HTTP server overhead.
 * Perfect for CLI tools, testing, and embedded scenarios.
 */

import type {
	ExecutionConfig,
	ExecutionResult,
	APIGroupConfig,
	CustomFunctionDef,
	CacheProvider,
	AuditSink,
} from '@mondaydotcomorg/atp-protocol';
import type { ICompiler } from '@mondaydotcomorg/atp-compiler';
import type { SecurityPolicy, ProvenanceMode } from '@mondaydotcomorg/atp-provenance';
import type { Logger } from 'pino';
import { nanoid } from 'nanoid';
import { APIRegistry } from './api-registry.js';
import { SandboxExecutor } from './executor/index.js';

/**
 * Engine configuration
 */
export interface ATPEngineConfig {
	// Execution limits
	timeout?: number;
	memory?: number;
	maxLLMCalls?: number;

	// Compiler
	compiler?: ICompiler;
	enableCompiler?: boolean;
	enableBatchParallel?: boolean;
	batchSizeThreshold?: number;

	// Provenance security
	provenanceMode?: ProvenanceMode | 'none' | 'proxy' | 'ast';
	securityPolicies?: SecurityPolicy[];

	// Providers
	cacheProvider?: CacheProvider;
	auditSink?: AuditSink;

	// Logging
	logger?: Logger;
}

/**
 * API registration spec
 */
export interface APISpec {
	type: 'openapi' | 'mcp' | 'custom' | 'oauth';
	spec?: APIGroupConfig;
	functions?: CustomFunctionDef[];
	description?: string;
	baseUrl?: string;
}

/**
 * ATPEngine - Core execution engine without HTTP
 */
export class ATPEngine {
	private config: Required<Omit<ATPEngineConfig, 'compiler' | 'cacheProvider' | 'auditSink' | 'logger'>>;
	private compiler?: ICompiler;
	private cacheProvider?: CacheProvider;
	private auditSink?: AuditSink;
	private logger?: Logger;
	private registry: APIRegistry;
	private executor: SandboxExecutor;

	constructor(config: ATPEngineConfig = {}) {
		// Default configuration
		this.config = {
			timeout: config.timeout ?? 30000,
			memory: config.memory ?? 128 * 1024 * 1024,
			maxLLMCalls: config.maxLLMCalls ?? 10,
			enableCompiler: config.enableCompiler ?? true,
			enableBatchParallel: config.enableBatchParallel ?? true,
			batchSizeThreshold: config.batchSizeThreshold ?? 5,
			provenanceMode: config.provenanceMode ?? 'none',
			securityPolicies: config.securityPolicies ?? [],
		};

		this.compiler = config.compiler;
		this.cacheProvider = config.cacheProvider;
		this.auditSink = config.auditSink;
		this.logger = config.logger;

		// Initialize registry and executor
		this.registry = new APIRegistry();
		this.executor = new SandboxExecutor({
			timeout: this.config.timeout,
			memory: this.config.memory,
			compiler: this.compiler,
			enableCompiler: this.config.enableCompiler,
			enableBatchParallel: this.config.enableBatchParallel,
			batchSizeThreshold: this.config.batchSizeThreshold,
			cacheProvider: this.cacheProvider,
			auditSink: this.auditSink,
			logger: this.logger,
		});
	}

	/**
	 * Register an API by ID
	 * 
	 * @example
	 * ```typescript
	 * // OpenAPI
	 * engine.registerAPI('petstore', {
	 *   type: 'openapi',
	 *   spec: petstoreAPIGroup
	 * });
	 * 
	 * // Custom functions
	 * engine.registerAPI('database', {
	 *   type: 'custom',
	 *   functions: [{ name: 'getUser', handler: ... }]
	 * });
	 * ```
	 */
	registerAPI(id: string, spec: APISpec): void {
		if (spec.spec) {
			this.registry.register(id, spec.spec);
		} else if (spec.functions) {
			// Convert functions to APIGroupConfig
			const apiGroup: APIGroupConfig = {
				name: id,
				type: spec.type,
				description: spec.description,
				functions: spec.functions,
			};
			this.registry.register(id, apiGroup);
		} else {
			throw new Error(`Invalid API spec for ${id}: must provide spec or functions`);
		}

		// Update executor with new API groups
		this.executor.setAPIGroups(this.registry.getAllAPIGroups());
	}

	/**
	 * Unregister an API by ID
	 */
	unregisterAPI(id: string): boolean {
		const result = this.registry.unregister(id);
		if (result) {
			this.executor.setAPIGroups(this.registry.getAllAPIGroups());
		}
		return result;
	}

	/**
	 * List all registered API IDs
	 */
	listAPIs(): string[] {
		return this.registry.listIDs();
	}

	/**
	 * Get API metadata by ID
	 */
	getAPIMetadata(id: string): APIGroupConfig | undefined {
		return this.registry.get(id);
	}

	/**
	 * Execute code directly (no HTTP, no pause/resume)
	 * 
	 * @example
	 * ```typescript
	 * const result = await engine.execute(`
	 *   const pets = await atp.api.petstore.findPetsByStatus({ status: 'available' });
	 *   return pets.length;
	 * `);
	 * 
	 * console.log(result.result); // 42
	 * ```
	 */
	async execute(
		code: string,
		options: Partial<ExecutionConfig> = {}
	): Promise<ExecutionResult> {
		const executionId = nanoid();
		const clientId = options.context?.clientId ?? 'embedded';

		const executionConfig: ExecutionConfig = {
			code,
			timeout: options.timeout ?? this.config.timeout,
			maxLLMCalls: options.maxLLMCalls ?? this.config.maxLLMCalls,
			provenanceMode: options.provenanceMode ?? this.config.provenanceMode,
			pausable: false, // Embedded mode - no pause/resume
			...options,
		};

		return await this.executor.execute(code, executionConfig, clientId);
	}

	/**
	 * Get TypeScript type definitions for all registered APIs
	 * 
	 * @example
	 * ```typescript
	 * const types = await engine.getTypeDefinitions();
	 * writeFileSync('atp.d.ts', types);
	 * ```
	 */
	async getTypeDefinitions(options?: { apis?: string[] }): Promise<string> {
		return this.registry.generateTypeScript(options?.apis);
	}

	/**
	 * Search APIs by query (semantic or keyword search)
	 */
	async searchAPIs(query: string, limit: number = 10): Promise<Array<{
		api: string;
		function: string;
		description: string;
		score: number;
	}>> {
		return this.registry.search(query, limit);
	}

	/**
	 * Get execution statistics
	 */
	getStats(): {
		totalExecutions: number;
		totalAPICalls: number;
		averageExecutionTime: number;
		cacheHitRate: number;
	} {
		return this.executor.getStats();
	}

	/**
	 * Reset execution statistics
	 */
	resetStats(): void {
		this.executor.resetStats();
	}

	/**
	 * Dispose engine and clean up resources
	 */
	async dispose(): Promise<void> {
		await this.executor.dispose();
	}
}

