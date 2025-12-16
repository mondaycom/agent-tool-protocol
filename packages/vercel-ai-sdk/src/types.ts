import type { ExecutionConfig, ClientTool } from '@mondaydotcomorg/atp-protocol';
import type { ClientHooks } from '@mondaydotcomorg/atp-client';
import type { UIMessageStreamWriter } from './event-adapter.js';

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
