import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import type { ExecutionResult, ExecutionConfig } from '@mondaydotcomorg/atp-protocol';
import { generateObject, generateText } from 'ai';
import type {
	VercelAIATPClientOptions,
	ApprovalResponse,
	EmbeddingProvider,
	ApprovalHandler,
	GenerateTextFunction,
	GenerateObjectFunction,
} from './types.js';

export class VercelAIATPClient {
	private client: AgentToolProtocolClient;
	private model: any;
	private embeddings?: EmbeddingProvider;
	private approvalHandler?: ApprovalHandler;
	private generateTextFn: GenerateTextFunction;
	private generateObjectFn: GenerateObjectFunction;

	constructor(options: VercelAIATPClientOptions) {
		const {
			model,
			embeddings,
			tools,
			approvalHandler,
			hooks,
			generateTextFn,
			generateObjectFn,
		} = options;

		if ('server' in options && options.server) {
			this.client = new AgentToolProtocolClient({
				server: options.server,
				hooks,
				serviceProviders: tools ? { tools } : undefined,
			});
		} else if ('serverUrl' in options && options.serverUrl) {
			this.client = new AgentToolProtocolClient({
				baseUrl: options.serverUrl,
				headers: options.headers,
				hooks,
				serviceProviders: tools ? { tools } : undefined,
			});
		} else {
			throw new Error('Either serverUrl or server must be provided');
		}

		this.model = model;
		this.embeddings = embeddings;
		this.approvalHandler = approvalHandler;

		// Use provided functions or fallback to defaults from 'ai' package
		this.generateTextFn =
			generateTextFn ||
			(async (options) => {
				return await generateText(options);
			});

		this.generateObjectFn =
			generateObjectFn ||
			(async (options) => {
				return await generateObject(options);
			});

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
		const result = await this.generateTextFn({
			model: this.model,
			prompt,
			temperature: options?.temperature,
			maxOutputTokens: options?.maxTokens,
			system: options?.systemPrompt,
		});

		return result.text;
	}

	private async handleLLMExtract(prompt: string, schema: any, options?: any): Promise<any> {
		const result = await this.generateObjectFn({
			model: this.model,
			prompt,
			schema,
			system: options?.systemPrompt,
			temperature: options?.temperature,
			maxOutputTokens: options?.maxTokens,
		});

		return result.object;
	}

	private async handleLLMClassify(
		text: string,
		categories: string[],
		options?: any
	): Promise<string> {
		const promptText = `Classify the following text into one of these categories: ${categories.join(', ')}\n\nText: ${text}\n\nRespond with ONLY the category name, nothing else.`;

		const result = await this.generateTextFn({
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
