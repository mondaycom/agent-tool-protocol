import type { ProvenanceMode, SecurityPolicy } from '@mondaydotcomorg/atp-provenance';
export { ProvenanceMode, type SecurityPolicy } from '@mondaydotcomorg/atp-provenance';

/**
 * Callback types that can pause execution
 */
export enum CallbackType {
	LLM = 'llm',
	APPROVAL = 'approval',
	EMBEDDING = 'embedding',
	TOOL = 'tool',
}

/**
 * Tool callback operations
 */
export enum ToolOperation {
	CALL = 'call',
}

export interface AgentToolProtocolRequest {
	jsonrpc: '2.0';
	id: string | number;
	method: string;
	params: Record<string, unknown>;
}

export interface AgentToolProtocolResponse {
	jsonrpc: '2.0';
	id: string | number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

export interface AgentToolProtocolNotification {
	jsonrpc: '2.0';
	method: string;
	params: Record<string, unknown>;
}

/**
 * Client-provided service availability
 */
export interface ClientServices {
	/** Whether client provides LLM implementation */
	hasLLM: boolean;
	/** Whether client provides approval handler */
	hasApproval: boolean;
	/** Whether client provides embedding model */
	hasEmbedding: boolean;
	/** Whether client provides custom tools */
	hasTools: boolean;
	/** Names of client-provided tools (for discovery) */
	toolNames?: string[];
}

/**
 * Client-provided LLM handler
 */
export interface ClientLLMHandler {
	call: (
		prompt: string,
		options?: {
			context?: Record<string, unknown>;
			model?: string;
			temperature?: number;
			systemPrompt?: string;
		}
	) => Promise<string>;
	extract?: <T>(
		prompt: string,
		schema: Record<string, unknown>,
		options?: {
			context?: Record<string, unknown>;
		}
	) => Promise<T>;
	classify?: (
		text: string,
		categories: string[],
		options?: {
			context?: Record<string, unknown>;
		}
	) => Promise<string>;
}

/**
 * Client-provided approval handler
 */
export interface ClientApprovalHandler {
	request: (
		message: string,
		context?: Record<string, unknown>
	) => Promise<{
		approved: boolean;
		response?: unknown;
		timestamp: number;
	}>;
}

/**
 * Client-provided embedding handler
 */
export interface ClientEmbeddingHandler {
	embed: (text: string) => Promise<number[]>;
	similarity?: (text1: string, text2: string) => Promise<number>;
}

/**
 * Client-provided tool handler
 * Function that executes on the client side when a client tool is invoked
 */
export interface ClientToolHandler {
	(input: unknown): Promise<unknown>;
}

/**
 * Client tool definition (metadata sent to server)
 * The actual handler function remains on the client side
 */
export interface ClientToolDefinition {
	/** Tool name (unique per client session) */
	name: string;
	/** API namespace (e.g., 'playwright', 'browser'). Defaults to 'client' if not specified */
	namespace?: string;
	/** Human-readable description of what the tool does */
	description: string;
	/** JSON Schema for tool input validation */
	inputSchema: JSONSchema;
	/** JSON Schema for tool output (optional, for documentation) */
	outputSchema?: JSONSchema;
	/** Tool metadata for security and risk management */
	metadata?: ToolMetadata;
	/** Whether this tool supports parallel execution with other tools */
	supportsConcurrency?: boolean;
	/** Keywords for search/discovery (optional) */
	keywords?: string[];
}

/**
 * Client tool with handler (used client-side only)
 * Extends ClientToolDefinition to include the actual handler function
 */
export interface ClientTool extends ClientToolDefinition {
	/** Handler function that executes on client side */
	handler: ClientToolHandler;
}

/**
 * Tool operation type classification
 */
export enum ToolOperationType {
	/** Safe read-only operations */
	READ = 'read',
	/** Operations that modify data */
	WRITE = 'write',
	/** Operations that delete or destroy data */
	DESTRUCTIVE = 'destructive',
}

/**
 * Tool sensitivity level
 */
export enum ToolSensitivityLevel {
	/** Public data, no sensitivity concerns */
	PUBLIC = 'public',
	/** Internal data, requires authentication */
	INTERNAL = 'internal',
	/** Sensitive data (PII, financial data, etc.) */
	SENSITIVE = 'sensitive',
}

/**
 * Client-side tool execution rules
 * Allows clients to control which tools can be executed and under what conditions
 */
export interface ClientToolRules {
	/** Block all tools of specific operation types */
	blockOperationTypes?: ToolOperationType[];
	/** Block all tools with specific sensitivity levels */
	blockSensitivityLevels?: ToolSensitivityLevel[];
	/** Require approval for specific operation types */
	requireApprovalForOperationTypes?: ToolOperationType[];
	/** Require approval for specific sensitivity levels */
	requireApprovalForSensitivityLevels?: ToolSensitivityLevel[];
	/** Block specific tools by name (e.g., ['deleteDatabase', 'dropTable']) */
	blockTools?: string[];
	/** Allow only specific tools by name (whitelist mode) */
	allowOnlyTools?: string[];
	/** Block entire API groups (e.g., ['admin', 'system']) */
	blockApiGroups?: string[];
	/** Allow only specific API groups (whitelist mode) */
	allowOnlyApiGroups?: string[];
}

/**
 * Tool/API metadata for security and risk management
 *
 * What can clients do with these annotations?
 *
 * 1. **Block Execution**:
 *    - Block all WRITE operations: blockOperationTypes: [ToolOperationType.WRITE]
 *    - Block all DESTRUCTIVE operations: blockOperationTypes: [ToolOperationType.DESTRUCTIVE]
 *    - Block SENSITIVE data access: blockSensitivityLevels: [ToolSensitivityLevel.SENSITIVE]
 *
 * 2. **Require Approval**:
 *    - Require approval for WRITE: requireApprovalForOperationTypes: [ToolOperationType.WRITE]
 *    - Require approval for DESTRUCTIVE: requireApprovalForOperationTypes: [ToolOperationType.DESTRUCTIVE]
 *    - Require approval for SENSITIVE: requireApprovalForSensitivityLevels: [ToolSensitivityLevel.SENSITIVE]
 *
 * 3. **Whitelist/Blacklist**:
 *    - Block specific tools: blockTools: ['deleteDatabase', 'dropTable']
 *    - Allow only safe tools: allowOnlyTools: ['getUser', 'listItems']
 *    - Block admin APIs: blockApiGroups: ['admin', 'system']
 *
 * 4. **Audit & Logging**:
 *    - Log all DESTRUCTIVE operations
 *    - Track access to SENSITIVE data
 *    - Monitor WRITE operations
 *
 * Granularity levels:
 * - Operation Type: READ, WRITE, DESTRUCTIVE (coarse-grained)
 * - Sensitivity Level: PUBLIC, INTERNAL, SENSITIVE (data classification)
 * - Tool Name: Specific function names (fine-grained)
 * - API Group: Entire namespaces (medium-grained)
 */
export interface ToolMetadata {
	/** Operation type classification */
	operationType?: ToolOperationType;
	/** Sensitivity level of data handled */
	sensitivityLevel?: ToolSensitivityLevel;
	/** Require explicit approval before execution (server-side enforcement) */
	requiresApproval?: boolean;
	/** Category for grouping/filtering (e.g., 'database', 'user-management') */
	category?: string;
	/** Additional tags for classification */
	tags?: string[];
	/** Human-readable description of potential impact */
	impactDescription?: string;
	/**
	 * Required OAuth scopes to use this tool
	 * Used for scope-based filtering when user credentials have limited permissions
	 * @example ['repo', 'read:user'] for GitHub
	 * @example ['https://www.googleapis.com/auth/calendar'] for Google
	 */
	requiredScopes?: string[];
	/**
	 * Generic permissions required (for non-OAuth providers)
	 * @example ['admin', 'write:users']
	 */
	requiredPermissions?: string[];
}

/**
 * Client service providers
 */
export interface ClientServiceProviders {
	llm?: ClientLLMHandler;
	approval?: ClientApprovalHandler;
	embedding?: ClientEmbeddingHandler;
	/** Client-provided tools that execute locally */
	tools?: ClientTool[];
}

export interface ExecutionConfig {
	timeout: number;
	maxMemory: number;
	maxLLMCalls: number;
	allowedAPIs: string[];
	allowLLMCalls: boolean;
	progressCallback?: (message: string, fraction: number) => void;
	customLLMHandler?: (prompt: string, options?: any) => Promise<string>;
	clientServices?: ClientServices;
	provenanceMode?: ProvenanceMode;
	securityPolicies?: SecurityPolicy[];
	provenanceHints?: string[];
}

/**
 * Execution status codes for fine-grained error reporting
 */
export enum ExecutionStatus {
	COMPLETED = 'completed',
	FAILED = 'failed',
	TIMEOUT = 'timeout',
	CANCELLED = 'cancelled',
	PAUSED = 'paused',
	MEMORY_EXCEEDED = 'memory_exceeded',
	LLM_CALLS_EXCEEDED = 'llm_calls_exceeded',
	SECURITY_VIOLATION = 'security_violation',
	VALIDATION_FAILED = 'validation_failed',
	LOOP_DETECTED = 'loop_detected',
	RATE_LIMITED = 'rate_limited',
	NETWORK_ERROR = 'network_error',
	PARSE_ERROR = 'parse_error',
}

/**
 * Execution error codes for categorizing failures
 */
export enum ExecutionErrorCode {
	UNKNOWN_ERROR = 'UNKNOWN_ERROR',
	EXECUTION_FAILED = 'EXECUTION_FAILED',
	TIMEOUT_ERROR = 'TIMEOUT_ERROR',

	MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
	LLM_CALL_LIMIT_EXCEEDED = 'LLM_CALL_LIMIT_EXCEEDED',
	HTTP_CALL_LIMIT_EXCEEDED = 'HTTP_CALL_LIMIT_EXCEEDED',

	SECURITY_VIOLATION = 'SECURITY_VIOLATION',
	VALIDATION_FAILED = 'VALIDATION_FAILED',
	FORBIDDEN_OPERATION = 'FORBIDDEN_OPERATION',

	PARSE_ERROR = 'PARSE_ERROR',
	SYNTAX_ERROR = 'SYNTAX_ERROR',
	TYPE_ERROR = 'TYPE_ERROR',
	REFERENCE_ERROR = 'REFERENCE_ERROR',

	INFINITE_LOOP_DETECTED = 'INFINITE_LOOP_DETECTED',
	LOOP_TIMEOUT = 'LOOP_TIMEOUT',

	NETWORK_ERROR = 'NETWORK_ERROR',
	HTTP_ERROR = 'HTTP_ERROR',
	DNS_ERROR = 'DNS_ERROR',

	RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
	CONCURRENT_LIMIT_EXCEEDED = 'CONCURRENT_LIMIT_EXCEEDED',
}

export interface ExecutionResult {
	executionId: string;
	status: ExecutionStatus;
	result?: unknown;
	error?: {
		message: string;
		code?: ExecutionErrorCode;
		stack?: string;
		line?: number;
		context?: Record<string, unknown>;
		retryable?: boolean;
		suggestion?: string;
	};
	stats: {
		duration: number;
		memoryUsed: number;
		llmCallsCount: number;
		approvalCallsCount: number;
		statementsExecuted?: number;
		statementsCached?: number;
	};
	needsCallback?: {
		type: CallbackType;
		operation: string;
		payload: Record<string, unknown>;
	};
	needsCallbacks?: BatchCallbackRequest[];
	callbackHistory?: Array<{
		type: CallbackType;
		operation: string;
		payload: Record<string, unknown>;
		result?: unknown;
		timestamp: number;
		sequenceNumber: number;
	}>;
	transformedCode?: string;
	provenanceSnapshot?: unknown;
	provenanceTokens?: Array<{
		path: string;
		token: string;
	}>;
}

/**
 * Batch callback request for parallel execution
 */
export interface BatchCallbackRequest {
	/** Unique callback ID */
	id: string;
	/** Callback type */
	type: CallbackType;
	/** Operation name */
	operation: string;
	/** Operation payload */
	payload: Record<string, unknown>;
}

/**
 * Batch callback result from client
 */
export interface BatchCallbackResult {
	/** Callback ID (matches BatchCallbackRequest.id) */
	id: string;
	/** Callback result */
	result: unknown;
}

export interface SearchOptions {
	query: string;
	apiGroups?: string[];
	maxResults?: number;
	useEmbeddings?: boolean;
	embeddingModel?: string;
}

export interface SearchResult {
	apiGroup: string;
	functionName: string;
	description: string;
	signature: string;
	example?: string;
	relevanceScore: number;
}

export interface ExploreRequest {
	path: string;
}

export interface ExploreDirectoryResult {
	type: 'directory';
	path: string;
	items: Array<{ name: string; type: 'directory' | 'function' }>;
}

export interface ExploreFunctionResult {
	type: 'function';
	path: string;
	name: string;
	description: string;
	definition: string;
	group: string;
}

export type ExploreResult = ExploreDirectoryResult | ExploreFunctionResult;

export interface ValidationResult {
	valid: boolean;
	errors?: ValidationError[];
	warnings?: ValidationError[];
	securityIssues?: SecurityIssue[];
}

export interface ValidationError {
	line: number;
	message: string;
	severity: 'error' | 'warning';
}

export interface SecurityIssue {
	line: number;
	issue: string;
	risk: 'low' | 'medium' | 'high';
}

export interface APISource {
	type: 'mcp' | 'openapi' | 'custom';
	name: string;
	url?: string;
	spec?: unknown;
}

export interface ServerConfig {
	apiGroups: APIGroupConfig[];
	security: SecurityConfig;
	execution: ExecutionLimits;
	search: SearchConfig;
	logging: LoggingConfig;
}

export interface APIGroupConfig {
	name: string;
	type: 'mcp' | 'openapi' | 'custom';
	url?: string;
	spec?: unknown;
	functions?: CustomFunctionDef[];
	/** Authentication configuration for this API group */
	auth?: import('./auth.js').AuthConfig;
}

export interface SecurityConfig {
	allowedOrigins: string[];
	apiKeyRequired: boolean;
	rateLimits: {
		requestsPerMinute: number;
		executionsPerHour: number;
	};
}

export interface ExecutionLimits {
	defaultTimeout: number;
	maxTimeout: number;
	defaultMemoryLimit: number;
	maxMemoryLimit: number;
	defaultLLMCallLimit: number;
	maxLLMCallLimit: number;
}

export interface SearchConfig {
	enableEmbeddings: boolean;
	embeddingProvider?: 'openai' | 'cohere' | 'custom';
	customSearcher?: (query: string) => Promise<SearchResult[]>;
}

export interface LoggingConfig {
	level: 'debug' | 'info' | 'warn' | 'error';
	destination: 'console' | 'file' | 'remote';
	auditEnabled: boolean;
}

export interface CustomFunctionDef {
	name: string;
	description: string;
	inputSchema: JSONSchema;
	outputSchema?: JSONSchema;
	handler: (params: unknown) => Promise<unknown>;
	keywords?: string[];
	metadata?: ToolMetadata; // NEW: Tool metadata for security
	requiredScopes?: string[]; // OAuth scopes required to use this function
	auth?: {
		source?: 'server' | 'user';
		oauthProvider?: string;
	};
}

export interface JSONSchema {
	type: string;
	properties?: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
}

export interface ClientConfig {
	serverUrl: string;
	apiKey: string;
	timeout?: number;
	llmProvider: 'anthropic' | 'openai' | 'custom';
	llmModel?: string;
	temperature?: number;
	defaultExecutionConfig?: Partial<ExecutionConfig>;
	searchPreferences?: {
		useEmbeddings?: boolean;
		embeddingModel?: string;
		maxResults?: number;
	};
}

export interface RuntimeMethodParam {
	name: string;
	type: string;
	description: string;
	optional: boolean;
}

export interface RuntimeMethod {
	name: string;
	description: string;
	params: RuntimeMethodParam[];
	returns: string;
}

export interface RuntimeAPI {
	name: string;
	description: string;
	methods: RuntimeMethod[];
}

export interface RuntimeDefinitions {
	version: string;
	runtimeAPIs: RuntimeAPI[];
	description: string;
	usage: { example: string };
}
