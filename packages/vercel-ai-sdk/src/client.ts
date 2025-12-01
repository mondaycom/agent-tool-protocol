import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import type { ExecutionResult, ExecutionConfig } from '@mondaydotcomorg/atp-protocol';
import { generateObject, generateText } from 'ai';
import type {
	VercelAIATPClientOptions,
	ApprovalResponse,
	EmbeddingProvider,
	ApprovalHandler,
} from './types.js';

export class VercelAIATPClient {
	private client: AgentToolProtocolClient;
	private model: any;
	private embeddings?: EmbeddingProvider;
	private approvalHandler?: ApprovalHandler;

	constructor(options: VercelAIATPClientOptions) {
		const { serverUrl, headers, model, embeddings, tools, approvalHandler, hooks } = options;

		this.client = new AgentToolProtocolClient({
			baseUrl: serverUrl,
			headers,
			hooks,
			serviceProviders: tools ? { tools } : undefined,
		});
		this.model = model;
		this.embeddings = embeddings;
		this.approvalHandler = approvalHandler;

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

	async connect(): Promise<void> {
		await this.client.init({ name: 'vercel-ai-sdk-atp-client', version: '1.0.0' });
		await this.client.connect();
	}

	getTypeDefinitions(): string {
		return this.client.getTypeDefinitions();
	}

	async execute(code: string, config?: Partial<ExecutionConfig>): Promise<ExecutionResult> {
		return await this.client.execute(code, config);
	}

	getUnderlyingClient(): AgentToolProtocolClient {
		return this.client;
	}

	private async handleLLMCall(prompt: string, options?: any): Promise<string> {
		const result = await generateText({
			model: this.model,
			prompt,
			temperature: options?.temperature,
			maxTokens: options?.maxTokens,
			system: options?.systemPrompt,
		});

		return result.text;
	}

	private async handleLLMExtract(prompt: string, schema: any, options?: any): Promise<any> {
		const result = await generateObject({
			model: this.model,
			prompt,
			schema,
			system: options?.systemPrompt,
			temperature: options?.temperature,
			maxTokens: options?.maxTokens,
		});

		return result.object;
	}

	private async handleLLMClassify(
		text: string,
		categories: string[],
		options?: any
	): Promise<string> {
		const promptText = `Classify the following text into one of these categories: ${categories.join(', ')}\n\nText: ${text}\n\nRespond with ONLY the category name, nothing else.`;

		const result = await generateText({
			model: this.model,
			prompt: promptText,
			system: options?.systemPrompt,
			temperature: 0,
		});

		const classification = result.text.trim();

		if (categories.includes(classification)) {
			return classification;
		}

		for (const category of categories) {
			if (classification.toLowerCase().includes(category.toLowerCase())) {
				return category;
			}
		}

		const fallback = categories[0];
		if (!fallback) {
			throw new Error('No categories provided for classification');
		}
		return fallback;
	}

	private async handleEmbedding(text: string): Promise<number[]> {
		if (!this.embeddings) {
			throw new Error(
				'Embeddings provider not configured. Pass embeddings option when creating VercelAIATPClient.'
			);
		}

		return await this.embeddings.embed(text);
	}

	private async handleApprovalRequest(
		message: string,
		context?: Record<string, unknown>
	): Promise<ApprovalResponse> {
		if (!this.approvalHandler) {
			throw new Error(
				'No approval handler configured. Pass approvalHandler option when creating VercelAIATPClient.'
			);
		}

		const approved = await this.approvalHandler(message, context);
		return {
			approved,
			timestamp: Date.now(),
		};
	}
}
