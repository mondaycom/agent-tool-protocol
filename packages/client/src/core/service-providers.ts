import { CallbackType, ToolOperation } from '@mondaydotcomorg/atp-protocol';
import type {
	ClientLLMHandler,
	ClientApprovalHandler,
	ClientEmbeddingHandler,
	ClientServiceProviders,
	ClientTool,
	ClientToolDefinition,
	ClientToolHandler,
} from '@mondaydotcomorg/atp-protocol';

const LLMOperation = {
	CALL: 'call',
	EXTRACT: 'extract',
	CLASSIFY: 'classify',
} as const;

const EmbeddingOperation = {
	EMBED: 'embed',
	SEARCH: 'search',
} as const;

export class ServiceProviders {
	private providers: ClientServiceProviders = {};
	private toolHandlers: Map<string, ClientToolHandler> = new Map();

	constructor(providers?: ClientServiceProviders) {
		this.providers = providers || {};

		if (providers?.tools) {
			for (const tool of providers.tools) {
				this.toolHandlers.set(tool.name, tool.handler);
			}
		}
	}

	provideLLM(handler: ClientLLMHandler): void {
		this.providers.llm = handler;
	}

	provideApproval(handler: ClientApprovalHandler): void {
		this.providers.approval = handler;
	}

	provideEmbedding(handler: ClientEmbeddingHandler): void {
		this.providers.embedding = handler;
	}

	provideTools(tools: ClientTool[]): void {
		this.providers.tools = tools;
		for (const tool of tools) {
			this.toolHandlers.set(tool.name, tool.handler);
		}
	}

	getLLM(): ClientLLMHandler | undefined {
		return this.providers.llm;
	}

	getApproval(): ClientApprovalHandler | undefined {
		return this.providers.approval;
	}

	getEmbedding(): ClientEmbeddingHandler | undefined {
		return this.providers.embedding;
	}

	getTools(): ClientTool[] | undefined {
		return this.providers.tools;
	}

	/**
	 * Get tool definitions (without handlers) for sending to server
	 */
	getToolDefinitions(): ClientToolDefinition[] {
		if (!this.providers.tools) {
			return [];
		}

		return this.providers.tools.map((tool) => {
			const { handler, ...definition } = tool;
			return definition;
		});
	}

	/**
	 * Check if client has tools
	 */
	hasTools(): boolean {
		return !!(this.providers.tools && this.providers.tools.length > 0);
	}

	/**
	 * Check if client has any services or tools
	 */
	hasAnyServices(): boolean {
		return !!(
			this.providers.llm ||
			this.providers.approval ||
			this.providers.embedding ||
			this.hasTools()
		);
	}

	/**
	 * Check if client has a service for a specific callback type
	 */
	hasServiceForCallback(callbackType: CallbackType): boolean {
		switch (callbackType) {
			case CallbackType.LLM:
				return !!this.providers.llm;
			case CallbackType.APPROVAL:
				return !!this.providers.approval;
			case CallbackType.EMBEDDING:
				return !!this.providers.embedding;
			case CallbackType.TOOL:
				return this.hasTools();
			default:
				return false;
		}
	}

	async handleCallback(callbackType: CallbackType, payload: any): Promise<any> {
		if (payload.operation === 'batch_parallel' && payload.calls) {
			return await Promise.all(
				payload.calls.map(async (call: any) => {
					return await this.handleCallback(call.type, {
						...call.payload,
						operation: call.operation,
					});
				})
			);
		}

		switch (callbackType) {
			case CallbackType.LLM:
				if (!this.providers.llm) {
					throw new Error('LLM service not provided by client');
				}
				if (payload.operation === LLMOperation.CALL) {
					return await this.providers.llm.call(payload.prompt, payload.options);
				} else if (payload.operation === LLMOperation.EXTRACT && this.providers.llm.extract) {
					return await this.providers.llm.extract(payload.prompt, payload.schema, payload.options);
				} else if (payload.operation === LLMOperation.CLASSIFY && this.providers.llm.classify) {
					return await this.providers.llm.classify(
						payload.text,
						payload.categories,
						payload.options
					);
				}
				throw new Error(`Unsupported LLM operation: ${payload.operation}`);

			case CallbackType.APPROVAL:
				if (!this.providers.approval) {
					throw new Error('Approval service not provided by client');
				}
				const contextWithExecutionId = payload.context
					? { ...payload.context, executionId: payload.executionId }
					: { executionId: payload.executionId };
				return await this.providers.approval.request(payload.message, contextWithExecutionId);

			case CallbackType.EMBEDDING:
				if (!this.providers.embedding) {
					throw new Error('Embedding service not provided by client');
				}
				if (payload.operation === EmbeddingOperation.EMBED) {
					return await this.providers.embedding.embed(payload.text);
				} else if (payload.operation === EmbeddingOperation.SEARCH) {
					const queryEmbedding = await this.providers.embedding.embed(payload.query);
					return queryEmbedding;
				} else if (payload.operation === 'similarity' && this.providers.embedding.similarity) {
					return await this.providers.embedding.similarity(payload.text1, payload.text2);
				}
				throw new Error(`Unsupported embedding operation: ${payload.operation}`);

			case CallbackType.TOOL:
				if (payload.operation === ToolOperation.CALL) {
					const toolName = payload.toolName;
					const handler = this.toolHandlers.get(toolName);

					if (!handler) {
						throw new Error(`Tool '${toolName}' not found in client tools`);
					}

					const result = await handler(payload.input);
					return result;
				}
				throw new Error(`Unsupported tool operation: ${payload.operation}`);

			default:
				throw new Error(`Unknown callback type: ${callbackType}`);
		}
	}
}
