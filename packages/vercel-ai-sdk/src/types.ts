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

export interface VercelAIATPClientOptions {
	serverUrl: string;
	headers?: Record<string, string>;
	model: any;
	embeddings?: EmbeddingProvider;
	tools?: ClientTool[];
	approvalHandler?: ApprovalHandler;
	hooks?: ClientHooks;
}

export interface CreateATPToolsOptions {
	serverUrl: string;
	headers?: Record<string, string>;
	model: any;
	embeddings?: EmbeddingProvider;
	approvalHandler?: ApprovalHandler;
	defaultExecutionConfig?: Partial<ExecutionConfig>;
	hooks?: ClientHooks;
}

/**
 * Options for creating ATP tools with streaming event support
 */
export interface StreamingToolsOptions extends CreateATPToolsOptions {
	/**
	 * UIMessageStreamWriter to forward events to.
	 * Events like 'thinking', 'tool_start', 'tool_end', 'text', 'source' will be
	 * converted to Vercel AI SDK format and written to this stream.
	 */
	dataStream: UIMessageStreamWriter;
}

export interface ATPToolsResult {
	client: any;
	tools: Record<string, any>;
}
