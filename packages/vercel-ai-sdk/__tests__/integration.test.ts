import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createATPTools } from '../src/index.js';
import { createServer } from '@mondaydotcomorg/atp-server';

const mockModel = {
	specificationVersion: 'v1',
	provider: 'mock-provider',
	modelId: 'mock-model',
	defaultObjectGenerationMode: 'tool',
	doGenerate: async ({ prompt }: any) => {
		return {
			text: 'Mock LLM response',
			finishReason: 'stop',
			usage: { promptTokens: 10, completionTokens: 20 },
		};
	},
	doStream: async ({ prompt }: any) => {
		return {
			stream: (async function* () {
				yield { type: 'text-delta', textDelta: 'Mock ' };
				yield { type: 'text-delta', textDelta: 'streaming ' };
				yield { type: 'text-delta', textDelta: 'response' };
			})(),
		};
	},
};

const mockEmbeddings = {
	embed: async (text: string) => {
		return Array.from({ length: 384 }, (_, i) => Math.random());
	},
};

describe('Vercel AI SDK Integration', () => {
	let serverUrl: string;
	let server: any;

	beforeAll(async () => {
		const port = 13337;
		serverUrl = `http://localhost:${port}`;

		server = createServer();

		await server.listen(port);
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
	});

	test('should create ATP tools for Vercel AI SDK', async () => {
		const { tools, client } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			approvalHandler: async () => true,
		});

		expect(tools).toBeDefined();
		expect(client).toBeDefined();
		expect(tools.atp_execute_code).toBeDefined();
		expect(tools.atp_get_type_definitions).toBeDefined();
	});

	test('should execute ATP code successfully', async () => {
		const { tools } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			approvalHandler: async () => true,
		});

		const result = await tools.atp_execute_code.execute({
			code: 'return { message: "Hello from ATP" };',
		});

		expect(result).toBeDefined();
		expect(result.success).toBe(true);
		expect(result.result).toEqual({ message: 'Hello from ATP' });
	});

	test('should handle LLM calls within ATP code', async () => {
		const { tools } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			approvalHandler: async () => true,
		});

		const result = await tools.atp_execute_code.execute({
			code: `
				const response = await atp.llm.call("Test prompt");
				return { llmResponse: response };
			`,
		});

		expect(result).toBeDefined();
		expect(result.success).toBe(true);
		expect(result.result.llmResponse).toBe('Mock LLM response');
	});

	test('should handle approval requests', async () => {
		let approvalRequested = false;
		let approvalMessage = '';

		const { tools } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			approvalHandler: async (message) => {
				approvalRequested = true;
				approvalMessage = message;
				return true;
			},
		});

		const result = await tools.atp_execute_code.execute({
			code: `
				const approval = await atp.approval.request("Test approval message");
				return { approved: approval.approved };
			`,
		});

		expect(result).toBeDefined();
		expect(result.success).toBe(true);
		expect(result.result.approved).toBe(true);
		expect(approvalRequested).toBe(true);
		expect(approvalMessage).toBe('Test approval message');
	});

	test('should handle embeddings when provider configured', async () => {
		const { tools } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			embeddings: mockEmbeddings,
			approvalHandler: async () => true,
		});

		const result = await tools.atp_execute_code.execute({
			code: `
				const embedding = await atp.embedding.embed("Test text");
				return { embeddingLength: embedding.length };
			`,
		});

		expect(result).toBeDefined();
		expect(result.success).toBe(true);
		expect(result.result.embeddingLength).toBeGreaterThan(0);
	});

	test('should handle errors gracefully', async () => {
		const { tools } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			approvalHandler: async () => true,
		});

		const result = await tools.atp_execute_code.execute({
			code: 'throw new Error("Test error");',
		});

		expect(result).toBeDefined();
		expect(result.success).toBe(false);
		expect(result.error.message).toContain('Test error');
	});

	test('should get type definitions', async () => {
		const { tools } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			approvalHandler: async () => true,
		});

		const result = await tools.atp_get_type_definitions.execute({});

		expect(result).toBeDefined();
		expect(result.success).toBe(true);
		expect(result.types).toBeDefined();
		expect(typeof result.types).toBe('string');
		expect(result.types).toContain('atp');
	});

	test('should use default execution config', async () => {
		const { tools } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			approvalHandler: async () => true,
			defaultExecutionConfig: {
				timeout: 5000,
			},
		});

		const result = await tools.atp_execute_code.execute({
			code: 'return { success: true };',
		});

		expect(result).toBeDefined();
		expect(result.success).toBe(true);
	});

	test('should handle denial from approval handler', async () => {
		const { tools } = await createATPTools({
			serverUrl,
			headers: { Authorization: 'Bearer test-key' },
			model: mockModel,
			approvalHandler: async () => false,
		});

		const result = await tools.atp_execute_code.execute({
			code: `
				const approval = await atp.approval.request("Test denial");
				return { approved: approval.approved };
			`,
		});

		expect(result).toBeDefined();
		expect(result.success).toBe(true);
		expect(result.result.approved).toBe(false);
	});
});

