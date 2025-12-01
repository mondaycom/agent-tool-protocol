import type { ExecutionConfig, ClientTool } from '@mondaydotcomorg/atp-protocol';
import type { ClientHooks } from '@mondaydotcomorg/atp-client';

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

export interface ATPToolsResult {
	client: any;
	tools: Record<string, any>;
}
