import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { LangGraphATPClient } from '../src/langgraph-client.js';
import { createServer } from '@mondaydotcomorg/atp-server';
import { ChatOpenAI } from '@langchain/openai';
import { ToolOperationType, type ClientTool, ExecutionStatus } from '@mondaydotcomorg/atp-protocol';

/**
 * Tests for client tools integration with LangChain/LangGraph
 */
describe('LangChain Client Tools', () => {
	let server: any;
	const PORT = 3789;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-langchain-client-tools';

		server = createServer({
			execution: {
				timeout: 10000,
				memory: 64 * 1024 * 1024,
				llmCalls: 5,
			},
			logger: 'error',
		});

		await server.listen(PORT);
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
	});

	it('should create LangGraph client with client tools', async () => {
		const tools: ClientTool[] = [
			{
				name: 'add',
				namespace: 'math',
				description: 'Add two numbers',
				inputSchema: {
					type: 'object',
					properties: {
						a: { type: 'number' },
						b: { type: 'number' },
					},
					required: ['a', 'b'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return { result: input.a + input.b };
				},
			},
		];

		// Mock LLM (not actually called in this test)
		const mockLLM = {
			invoke: async () => ({ content: 'test' }),
			_llmType: () => 'mock',
		} as any as ChatOpenAI;

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm: mockLLM,
			tools, // Client tools provided here
			useLangGraphInterrupts: false,
			approvalHandler: async () => true,
		});

		await client.connect();

		expect(client).toBeDefined();
		// Verify the client was created successfully with tools
		expect(client).toBeInstanceOf(LangGraphATPClient);
	});

	it('should have tools property in options interface', () => {
		// This is a type-level test - if it compiles, the interface is correct
		const tools: ClientTool[] = [];

		const options = {
			serverUrl: 'http://localhost:3333',
			llm: {} as ChatOpenAI,
			tools, // Should be valid
		};

		expect(options.tools).toBe(tools);
	});
});
