import type { ExecutionConfig, ClientTool } from '@mondaydotcomorg/atp-protocol';
import type { ClientHooks } from '@mondaydotcomorg/atp-client';
import type { UIMessageStreamWriter } from './event-adapter.js';
import type { generateText, generateObject } from 'ai';

export interface ApprovalRequest {
	message: string;
	context?: Record<string, unknown>;
	timestamp: number;
}

export interface ApprovalResponse {
	approved: boolean;
	reason?: string;
	timestamp: number;
}

export type ApprovalHandler = (
	message: string,
	context?: Record<string, unknown>
) => Promise<boolean>;

export interface EmbeddingProvider {
	embed(text: string): Promise<number[]>;
}

/**
 * Options for generateText function - uses the full parameter type from Vercel AI SDK
 * This allows consumers to pass any valid options that generateText accepts
 */
export type GenerateTextOptions = Parameters<typeof generateText>[0];

/**
 * Result from generateText function - uses the full return type from Vercel AI SDK
 * This ensures type compatibility with the actual generateText function
 */
export type GenerateTextResult = Awaited<ReturnType<typeof generateText>>;

/**
 * Type signature for generateText function from Vercel AI SDK
 * Consumers can provide their own implementation that matches this signature
 * The function accepts the full options type and returns the full result type
 */
export type GenerateTextFunction = (
	options: GenerateTextOptions
) => Promise<GenerateTextResult>;

/**
 * Options for generateObject function - uses the full parameter type from Vercel AI SDK
 * This allows consumers to pass any valid options that generateObject accepts
 */
export type GenerateObjectOptions = Parameters<typeof generateObject>[0];

/**
 * Result from generateObject function - uses the full return type from Vercel AI SDK
 * This ensures type compatibility with the actual generateObject function
 */
export type GenerateObjectResult = Awaited<ReturnType<typeof generateObject>>;

/**
 * Type signature for generateObject function from Vercel AI SDK
 * Consumers can provide their own implementation that matches this signature
 * The function accepts the full options type and returns the full result type
 */
export type GenerateObjectFunction = (
	options: GenerateObjectOptions
) => Promise<GenerateObjectResult>;

export interface InProcessServer {
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

interface BaseClientOptions {
	model: any;
	embeddings?: EmbeddingProvider;
	tools?: ClientTool[];
	approvalHandler?: ApprovalHandler;
	hooks?: ClientHooks;
	/**
	 * Optional custom implementation of generateText function.
	 * If not provided, the default implementation from 'ai' package will be used.
	 * Must match the GenerateTextFunction signature.
	 */
	generateTextFn?: GenerateTextFunction;
	/**
	 * Optional custom implementation of generateObject function.
	 * If not provided, the default implementation from 'ai' package will be used.
	 * Must match the GenerateObjectFunction signature.
	 */
	generateObjectFn?: GenerateObjectFunction;
}

/** HTTP mode options */
interface HttpModeOptions extends BaseClientOptions {
	serverUrl: string;
	headers?: Record<string, string>;
	server?: never;
}

/** In-process mode options */
interface InProcessModeOptions extends BaseClientOptions {
	server: InProcessServer;
	serverUrl?: never;
	headers?: never;
}

export type VercelAIATPClientOptions = HttpModeOptions | InProcessModeOptions;

export type CreateATPToolsOptions = (HttpModeOptions | InProcessModeOptions) & {
	defaultExecutionConfig?: Partial<ExecutionConfig>;
};

/**
 * Options for creating ATP tools with streaming event support
 */
export type StreamingToolsOptions = CreateATPToolsOptions & {
	/**
	 * UIMessageStreamWriter to forward events to.
	 * Events like 'thinking', 'tool_start', 'tool_end', 'text', 'source' will be
	 * converted to Vercel AI SDK format and written to this stream.
	 */
	dataStream: UIMessageStreamWriter;
};

export interface ATPToolsResult {
	client: any;
	tools: Record<string, any>;
}
