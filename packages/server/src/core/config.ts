import type {
	CacheProvider,
	AuthProvider,
	AuditSink,
	ProvenanceMode,
	SecurityPolicy,
	ScopeFilteringConfig,
} from '@mondaydotcomorg/atp-protocol';
import type { ICompiler } from '@mondaydotcomorg/atp-compiler';

export const MB = 1024 * 1024;
export const GB = 1024 * 1024 * 1024;
export const SECOND = 1000;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * 60 * 60 * 1000;

/**
 * Execution configuration
 */
export interface ExecutionConfig {
	/** Timeout in milliseconds */
	timeout: number;
	/** Memory limit in bytes */
	memory: number;
	/** Maximum LLM calls allowed */
	llmCalls: number;
	/** Provenance tracking mode (none|proxy|ast) */
	provenanceMode?: ProvenanceMode;
	/** Security policies for provenance-based protection */
	securityPolicies?: SecurityPolicy[];
}

/**
 * Client initialization configuration
 */
export interface ClientInitConfig {
	/** Token time-to-live in milliseconds */
	tokenTTL: number;
	/** Token rotation interval in milliseconds */
	tokenRotation: number;
}

/**
 * Execution state configuration
 */
export interface ExecutionStateConfig {
	/** TTL for paused execution state in seconds */
	ttl: number;
	/** Maximum allowed pause duration in seconds (default: 1 hour) */
	maxPauseDuration: number;
	/** Key prefix for execution state (defaults to 'atp:execution:') */
	keyPrefix?: string;
}

/**
 * Discovery configuration
 */
export interface DiscoveryConfig {
	/** Enable embeddings for semantic search */
	embeddings: boolean;
	/** Scope filtering configuration for search results */
	scopeFiltering?: ScopeFilteringConfig;
}

/**
 * OpenTelemetry configuration
 */
export interface OpenTelemetryConfig {
	/** Enable OpenTelemetry tracing and metrics */
	enabled: boolean;
	/** Service name for traces and metrics (defaults to 'agent-tool-protocol') */
	serviceName?: string;
	/** Service version for resource attributes */
	serviceVersion?: string;
	/** OTLP endpoint for traces (defaults to http://localhost:4318/v1/traces) */
	traceEndpoint?: string;
	/** OTLP endpoint for metrics (defaults to http://localhost:4318/v1/metrics) */
	metricsEndpoint?: string;
	/** Headers for OTLP exporter (e.g., for authentication) */
	headers?: Record<string, string>;
	/** Metrics export interval in milliseconds (defaults to 60000) */
	metricsInterval?: number;
	/** Additional resource attributes */
	resourceAttributes?: Record<string, string>;
}

/**
 * Logger interface
 */
export interface Logger {
	debug(message: string, meta?: unknown): void;
	info(message: string, meta?: unknown): void;
	warn(message: string, meta?: unknown): void;
	error(message: string, meta?: unknown): void;
	child?(meta: Record<string, unknown>): Logger;
}

/**
 * Audit configuration
 */
export interface AuditConfig {
	/** Enable audit logging */
	enabled: boolean;
	/** Audit sink(s) for logging events */
	sinks?: AuditSink | AuditSink[];
}

/**
 * Provider configuration
 */
export interface ProvidersConfig {
	/** Cache provider for storing execution state and data (defaults to MemoryCache) */
	cache?: CacheProvider;
	/** Token/credential store for managing client tokens (defaults to EnvAuthProvider) */
	auth?: AuthProvider;
}

/**
 * Server configuration (user input - all fields optional)
 */
export interface ServerConfig {
	execution?: Partial<ExecutionConfig>;
	clientInit?: Partial<ClientInitConfig>;
	executionState?: Partial<ExecutionStateConfig>;
	discovery?: Partial<DiscoveryConfig>;
	/** Audit logging configuration */
	audit?: Partial<AuditConfig>;
	/** OpenTelemetry tracing and metrics configuration */
	otel?: Partial<OpenTelemetryConfig>;
	/** External providers (cache, auth) */
	providers?: ProvidersConfig;
	/** Custom compiler implementation (optional, defaults to standard ATPCompiler) */
	compiler?: ICompiler;
	logger?: 'none' | 'debug' | 'info' | 'warn' | 'error' | Logger;
}

/**
 * Resolved server configuration with defaults applied
 */
export interface ResolvedServerConfig {
	execution: ExecutionConfig;
	clientInit: ClientInitConfig;
	executionState: ExecutionStateConfig;
	discovery: DiscoveryConfig;
	audit: AuditConfig;
	otel: OpenTelemetryConfig;
	logger: 'none' | 'debug' | 'info' | 'warn' | 'error' | Logger;
}

/**
 * Request context passed through middleware
 */
export interface RequestContext {
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
	cache?: CacheProvider;
	auth?: AuthProvider;
	audit?: AuditSink;
	logger: Logger;
	status: number;
	responseBody: unknown;
	throw(status: number, message: string): never;
	assert(condition: boolean, message: string): asserts condition;
	set(header: string, value: string): void;
}

/**
 * Middleware function signature
 */
export type Middleware = (ctx: RequestContext, next: () => Promise<void>) => Promise<void>;
