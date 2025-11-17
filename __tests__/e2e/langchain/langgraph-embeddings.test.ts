import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from '@mondaydotcomorg/atp-server';
import { LangGraphATPClient } from '@mondaydotcomorg/atp-langchain';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

const PORT = 3533;

async function waitForServer(port: number, maxAttempts = 30): Promise<void> {
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const response = await fetch(`http://localhost:${port}/api/definitions`);
			if (response.ok) return;
		} catch {
			// Server not ready
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Server on port ${port} did not start in time`);
}

describe('LangGraph: Embeddings Support', () => {
	let server: ReturnType<typeof createServer>;
	const createdClients: LangGraphATPClient[] = [];

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-embeddings';
		process.env.OPENAI_API_KEY = 'sk-fake-key-for-testing';
	});

	afterEach(async () => {
		for (const client of createdClients) {
			try {
				const internalClient = (client as any).client;
				if (internalClient?.close) {
					await internalClient.close();
				}
			} catch {
				// Ignore cleanup errors
			}
		}
		createdClients.length = 0;

		if (server) {
			try {
				await server.stop();
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	afterAll(async () => {
		createdClients.length = 0;
	});

	it('should handle atp.embedding.embed with embeddings model', async () => {
		server = createServer({
			execution: {
				timeout: 60000,
				memory: 64 * 1024 * 1024,
				llmCalls: 10,
			},
			logger: 'error',
		});
		await server.listen(PORT);
		await waitForServer(PORT);

		const llm = new ChatOpenAI({
			modelName: 'gpt-4o',
			openAIApiKey: process.env.OPENAI_API_KEY || 'sk-fake-key',
		});

		const embeddings = new OpenAIEmbeddings({
			openAIApiKey: process.env.OPENAI_API_KEY || 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			embeddings,
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const embeddingId = await atp.embedding.embed('hello world');

			return {
				embeddingId,
				isString: typeof embeddingId === 'string',
				hasValue: !!embeddingId,
				idLength: embeddingId.length
			};
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		const resultData = result.result.result as any;
		expect(resultData.isString).toBe(true);
		expect(resultData.hasValue).toBe(true);
		expect(resultData.idLength).toBeGreaterThan(0);
	}, 60000);

	it('should fail gracefully when embeddings not provided', async () => {
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 64 * 1024 * 1024,
				llmCalls: 10,
			},
			logger: 'error',
		});
		await server.listen(PORT);
		await waitForServer(PORT);

		const llm = new ChatOpenAI({
			modelName: 'gpt-4o',
			openAIApiKey: process.env.OPENAI_API_KEY || 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const embeddingId = await atp.embedding.embed('text');
			return { embeddingId };
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('failed');
		expect(result.result.error).toBeDefined();
		expect(result.result.error!.message).toContain('embedding service not provided by client');
	});
});
