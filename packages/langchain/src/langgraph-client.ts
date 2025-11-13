/**
 * LangGraph-aware ATP Client
 *
 * This client integrates ATP execution with LangGraph's interrupt-based
 * human-in-the-loop (HITL) system. When ATP code calls atp.approval.request(),
 * it triggers a LangGraph interrupt for production-ready async approval flows.
 *
 * Features:
 * - LangGraph interrupt integration for approvals
 * - LLM sampling via LangChain models
 * - Checkpoint-aware state management
 * - Production-ready async approval workflows
 */

import { AgentToolProtocolClient, ClientCallbackError } from '@mondaydotcomorg/atp-client';
import type { ClientHooks } from '@mondaydotcomorg/atp-client';
import type { ExecutionResult, ExecutionConfig, ClientTool } from '@mondaydotcomorg/atp-protocol';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { Embeddings } from '@langchain/core/embeddings';

/**
 * Approval request that needs human decision
 */
export interface ApprovalRequest {
	message: string;
	context?: Record<string, unknown>;
	executionId: string;
	timestamp: number;
}

/**
 * Approval response from human
 */
export interface ApprovalResponse {
	approved: boolean;
	reason?: string;
	timestamp: number;
}

/**
 * Options for creating the LangGraph ATP client
 */
export interface LangGraphATPClientOptions {
	/** Base URL of ATP server */
	serverUrl: string;
	/** Custom headers for authentication (e.g., { Authorization: 'Bearer token' }) */
	headers?: Record<string, string>;
	/** LangChain LLM for atp.llm.call() sampling */
	llm: BaseChatModel;
	/**
	 * LangChain embeddings model for atp.embedding.embed() and atp.embedding.search()
	 * Optional - if not provided, embedding calls will fail
	 */
	embeddings?: Embeddings;
	/**
	 * Client-provided tools that execute locally (e.g., file operations, browser automation)
	 * These tools are registered with the server and can be called from server code execution
	 */
	tools?: ClientTool[];
	/**
	 * Whether to use LangGraph interrupts for approvals (production mode).
	 * If false, will use a direct callback handler.
	 * Default: true
	 */
	useLangGraphInterrupts?: boolean;
	/**
	 * Direct approval handler (only used if useLangGraphInterrupts = false)
	 */
	approvalHandler?: (message: string, context?: Record<string, unknown>) => Promise<boolean>;
	/**
	 * Hooks for intercepting and modifying client behavior
	 */
	hooks?: ClientHooks;
}

/**
 * Result of ATP execution that may need approval
 */
export interface ATPExecutionResult {
	/** Standard execution result */
	result: ExecutionResult;
	/** If true, execution is waiting for approval via LangGraph interrupt */
	needsApproval: boolean;
	/** Approval request details (if needsApproval = true) */
	approvalRequest?: ApprovalRequest;
}

/**
 * Exception thrown when approval is needed - this triggers LangGraph interrupt
 */
export class ApprovalRequiredException extends ClientCallbackError {
	constructor(public readonly approvalRequest: ApprovalRequest) {
		super(`Approval required: ${approvalRequest.message}`);
		this.name = 'ApprovalRequiredException';
	}
}

/**
 * LangGraph-aware ATP Client
 *
 * Integrates ATP with LangGraph's production-ready interrupt system:
 * - atp.llm.call() → Routes to LangChain LLM (no interrupt)
 * - atp.approval.request() → Throws ApprovalRequiredException (triggers LangGraph interrupt)
 * - Supports checkpoint-based state persistence
 * - Enables async approval workflows
 */
export class LangGraphATPClient {
	private client: AgentToolProtocolClient;
	private llm: BaseChatModel;
	private embeddings?: Embeddings;
	private useLangGraphInterrupts: boolean;
	private directApprovalHandler?: (
		message: string,
		context?: Record<string, unknown>
	) => Promise<boolean>;

	private pendingApprovals = new Map<string, ApprovalRequest>();

	constructor(options: LangGraphATPClientOptions) {
		const {
			serverUrl,
			headers,
			llm,
			embeddings,
			tools,
			useLangGraphInterrupts = true,
			approvalHandler,
			hooks,
		} = options;

		this.client = new AgentToolProtocolClient({
			baseUrl: serverUrl,
			headers,
			hooks,
			serviceProviders: tools ? { tools } : undefined,
		});
		this.llm = llm;
		this.embeddings = embeddings;
		this.useLangGraphInterrupts = useLangGraphInterrupts;
		this.directApprovalHandler = approvalHandler;

		this.client.provideLLM({
			call: async (prompt: string, options?: any) => {
				return await this.handleLLMCall(prompt, options);
			},
			extract: async (prompt: string, schema: any, options?: any) => {
				return await this.handleLLMExtract(prompt, schema, options);
			},
			classify: async (text: string, categories: string[], options?: any) => {
				return await this.handleLLMClassify(text, categories, options);
			},
		});

		if (this.embeddings) {
			this.client.provideEmbedding({
				embed: async (text: string) => {
					return await this.handleEmbedding(text);
				},
			});
		}

		this.client.provideApproval({
			request: async (message: string, context?: Record<string, unknown>) => {
				return await this.handleApprovalRequest(message, context);
			},
		});
	}

	/**
	 * Initialize the client connection
	 */
	async connect(): Promise<void> {
		await this.client.init({ name: 'langgraph-atp-client', version: '1.0.0' });
		await this.client.connect();
	}

	/**
	 * Get TypeScript API definitions
	 */
	getTypeDefinitions(): string {
		return this.client.getTypeDefinitions();
	}

	/**
	 * Execute ATP code with LangGraph interrupt support
	 *
	 * When approval is needed:
	 * - If useLangGraphInterrupts=true: Throws ApprovalRequiredException
	 * - If useLangGraphInterrupts=false: Uses direct approval handler
	 *
	 * @throws ApprovalRequiredException when approval is needed (interrupt mode)
	 */
	async execute(code: string, config?: Partial<ExecutionConfig>): Promise<ATPExecutionResult> {
		const result = await this.client.execute(code, config);

		return {
			result,
			needsApproval: false,
		};
	}

	/**
	 * Resume execution after approval decision
	 *
	 * Call this after LangGraph resumes from interrupt with approval decision.
	 */
	async resumeWithApproval(
		executionId: string,
		approved: boolean,
		reason?: string
	): Promise<ExecutionResult> {
		const approvalResponse: ApprovalResponse = {
			approved,
			reason,
			timestamp: Date.now(),
		};

		this.pendingApprovals.delete(executionId);

		return await this.client.resume(executionId, approvalResponse);
	}

	/**
	 * Get pending approval request for an execution
	 */
	getPendingApproval(executionId: string): ApprovalRequest | undefined {
		return this.pendingApprovals.get(executionId);
	}

	/**
	 * Handle LLM call - route to LangChain LLM
	 */
	private async handleLLMCall(prompt: string, options?: any): Promise<string> {
		const messages: BaseMessage[] = [];

		if (options?.systemPrompt) {
			messages.push(new SystemMessage(options.systemPrompt));
		}

		messages.push(new HumanMessage(prompt));

		const response = await this.llm.invoke(messages);

		return typeof response.content === 'string'
			? response.content
			: JSON.stringify(response.content);
	}

	/**
	 * Handle LLM extract - route to LangChain LLM with structured output
	 */
	private async handleLLMExtract(prompt: string, schema: any, options?: any): Promise<any> {
		const structuredLLM = this.llm.withStructuredOutput(schema);

		const messages: BaseMessage[] = [];
		if (options?.systemPrompt) {
			messages.push(new SystemMessage(options.systemPrompt));
		}
		messages.push(new HumanMessage(prompt));

		const result = await structuredLLM.invoke(messages);

		return result;
	}

	/**
	 * Handle LLM classify - route to LangChain LLM
	 */
	private async handleLLMClassify(
		text: string,
		categories: string[],
		options?: any
	): Promise<string> {
		const prompt = `Classify the following text into one of these categories: ${categories.join(', ')}\n\nText: ${text}\n\nCategory:`;

		const messages: BaseMessage[] = [];
		if (options?.systemPrompt) {
			messages.push(new SystemMessage(options.systemPrompt));
		}
		messages.push(new HumanMessage(prompt));

		const response = await this.llm.invoke(messages);

		const result =
			typeof response.content === 'string'
				? response.content.trim()
				: JSON.stringify(response.content).trim();

		if (!categories.includes(result)) {
			for (const category of categories) {
				if (result.toLowerCase().includes(category.toLowerCase())) {
					return category;
				}
			}
			const fallback = categories[0];
			if (!fallback) {
				throw new Error('No categories provided for classification');
			}
			return fallback;
		}

		return result;
	}

	/**
	 * Handle embedding - route to LangChain embeddings model
	 */
	private async handleEmbedding(text: string): Promise<number[]> {
		if (!this.embeddings) {
			throw new Error(
				'Embeddings model not provided. Pass embeddings option when creating LangGraphATPClient.'
			);
		}

		return await this.embeddings.embedQuery(text);
	}

	/**
	 * Get the underlying ATP client for advanced usage
	 */
	getUnderlyingClient(): AgentToolProtocolClient {
		return this.client;
	}

	private async handleApprovalRequest(
		message: string,
		context?: Record<string, unknown>
	): Promise<{ approved: boolean; reason?: string; timestamp: number }> {
		const executionId = (context as any)?.executionId;
		const cleanContext = context ? { ...context } : undefined;
		if (cleanContext) {
			delete (cleanContext as any).executionId;
		}

		if (this.useLangGraphInterrupts) {
			if (typeof executionId !== 'string' || !executionId) {
				throw new Error('executionId is missing in approval request context');
			}

			const approvalRequest: ApprovalRequest = {
				message,
				context: cleanContext,
				executionId,
				timestamp: Date.now(),
			};

			this.pendingApprovals.set(executionId, approvalRequest);

			throw new ApprovalRequiredException(approvalRequest);
		}

		if (this.directApprovalHandler) {
			const approved = await this.directApprovalHandler(message, cleanContext);
			return {
				approved,
				timestamp: Date.now(),
			};
		}

		console.warn(`Approval request rejected (no handler): ${message}`);
		return {
			approved: false,
			timestamp: Date.now(),
		};
	}
}
