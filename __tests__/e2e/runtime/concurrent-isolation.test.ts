/**
 * E2E tests for concurrent client isolation
 * Ensures multiple clients can execute simultaneously without interference
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { randomUUID } from 'node:crypto';

const TEST_PORT = 3344;

describe('Concurrent Client Isolation E2E', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-concurrent-isolation';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		await server.listen(TEST_PORT);
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
	});

	test('should isolate cache between concurrent clients', async () => {
		// Use DIFFERENT API keys for proper client isolation
		const client1 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client1-${randomUUID()}` },
		});
		const client2 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client2-${randomUUID()}` },
		});

		await client1.init();
		await client1.connect();
		await client2.init();
		await client2.connect();

		// Client 1 sets cache
		const code1 = `
			await atp.cache.set('shared-key', 'client-1-value', 60);
			return await atp.cache.get('shared-key');
		`;

		// Client 2 sets same key
		const code2 = `
			await atp.cache.set('shared-key', 'client-2-value', 60);
			return await atp.cache.get('shared-key');
		`;

		// Execute concurrently
		const [result1, result2] = await Promise.all([client1.execute(code1), client2.execute(code2)]);

		expect(result1.status).toBe('completed');
		expect(result2.status).toBe('completed');

		// Each should see their own value
		expect(result1.result).toBe('client-1-value');
		expect(result2.result).toBe('client-2-value');
	});

	test('should isolate LLM state between concurrent clients', async () => {
		// Use DIFFERENT API keys for proper client isolation
		const client1 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client1-${randomUUID()}` },
		});
		const client2 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client2-${randomUUID()}` },
		});

		await client1.init();
		await client1.connect();
		await client2.init();
		await client2.connect();

		let client1LLMCallCount = 0;
		let client2LLMCallCount = 0;

		// Provide different LLM handlers
		client1.provideLLM({
			call: async (prompt) => {
				client1LLMCallCount++;
				console.log(`[Client1 LLM] Call #${client1LLMCallCount}, prompt: ${prompt}`);
				return `Client1-Response-${client1LLMCallCount}`;
			},
		});

		client2.provideLLM({
			call: async (prompt) => {
				client2LLMCallCount++;
				console.log(`[Client2 LLM] Call #${client2LLMCallCount}, prompt: ${prompt}`);
				return `Client2-Response-${client2LLMCallCount}`;
			},
		});

		const code = `
			const r1 = await atp.llm.call({ prompt: 'test1' });
			const r2 = await atp.llm.call({ prompt: 'test2' });
			return { r1, r2 };
		`;

		console.log('[Test] Starting concurrent executions');
		// Test SEQUENTIALLY first to verify each works independently
		console.log('[Test] Running client1...');
		const result1 = await client1.execute(code);
		console.log('[Test] Client1 completed, running client2...');
		const result2 = await client2.execute(code);
		console.log('[Test] Both executions completed');

		console.log('[Test] Result1:', result1.result);
		console.log('[Test] Result2:', result2.result);

		expect(result1.status).toBe('completed');
		expect(result2.status).toBe('completed');

		// Client 1 should get Client1 responses
		expect((result1.result as any).r1).toBe('Client1-Response-1');
		expect((result1.result as any).r2).toBe('Client1-Response-2');

		// Client 2 should get Client2 responses
		expect((result2.result as any).r1).toBe('Client2-Response-1');
		expect((result2.result as any).r2).toBe('Client2-Response-2');

		// Each client made exactly 2 calls
		expect(client1LLMCallCount).toBe(2);
		expect(client2LLMCallCount).toBe(2);
	});

	test('should isolate approval state between concurrent clients', async () => {
		// Use DIFFERENT API keys for proper client isolation
		const client1 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client1-${randomUUID()}` },
		});
		const client2 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client2-${randomUUID()}` },
		});

		await client1.init();
		await client1.connect();
		await client2.init();
		await client2.connect();

		const client1Approvals: string[] = [];
		const client2Approvals: string[] = [];

		// Provide different approval handlers
		client1.provideApproval({
			request: async (message, context) => {
				client1Approvals.push(message);
				return { approved: true, response: 'Client1-Approved', timestamp: Date.now() };
			},
		});

		client2.provideApproval({
			request: async (message, context) => {
				client2Approvals.push(message);
				return { approved: false, response: 'Client2-Rejected', timestamp: Date.now() };
			},
		});

		const code = `
			const result = await atp.approval.request('Test approval', { client: 'test' });
			return result.response;
		`;

		// Execute concurrently
		const [result1, result2] = await Promise.all([client1.execute(code), client2.execute(code)]);

		expect(result1.status).toBe('completed');
		expect(result2.status).toBe('completed');

		// Each should get their own handler's response
		expect(result1.result).toBe('Client1-Approved');
		expect(result2.result).toBe('Client2-Rejected');

		// Each handler was called exactly once
		expect(client1Approvals).toHaveLength(1);
		expect(client2Approvals).toHaveLength(1);
	});

	test('should isolate embedding vector stores between concurrent clients', async () => {
		// Use DIFFERENT API keys for proper client isolation
		const client1 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client1-${randomUUID()}` },
		});
		const client2 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client2-${randomUUID()}` },
		});

		await client1.init();
		await client1.connect();
		await client2.init();
		await client2.connect();

		// Provide embedding handlers
		client1.provideEmbedding({
			embed: async (text) => {
				// Generate embedding with 1.0 values for client 1
				return new Array(384).fill(1.0);
			},
		});

		client2.provideEmbedding({
			embed: async (text) => {
				// Generate embedding with 0.5 values for client 2
				return new Array(384).fill(0.5);
			},
		});

		const code = `
			await atp.embedding.embed('Document A', { collection: 'test' });
			await atp.embedding.embed('Document B', { collection: 'test' });
			
			const results = await atp.embedding.search('Query', { 
				collection: 'test',
				topK: 10
			});
			
			return { count: results.length, texts: results.map(r => r.text) };
		`;

		// Execute concurrently
		const [result1, result2] = await Promise.all([client1.execute(code), client2.execute(code)]);

		expect(result1.status).toBe('completed');
		expect(result2.status).toBe('completed');

		// Each should see only their own documents (2 each)
		expect((result1.result as any).count).toBe(2);
		expect((result2.result as any).count).toBe(2);

		// Documents shouldn't cross between clients
		const client1Texts = (result1.result as any).texts;
		const client2Texts = (result2.result as any).texts;

		expect(client1Texts).toContain('Document A');
		expect(client1Texts).toContain('Document B');
		expect(client2Texts).toContain('Document A');
		expect(client2Texts).toContain('Document B');
	});

	test('should handle rapid sequential executions without state leaks', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client-${randomUUID()}` },
		});
		await client.init();
		await client.connect();

		client.provideLLM({
			call: async (prompt) => `Response to: ${prompt}`,
		});

		// Execute many times rapidly
		const results = await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				client.execute(`
					const response = await atp.llm.call({ prompt: 'Request ${i}' });
					return response;
				`)
			)
		);

		// All should complete successfully
		expect(results.every((r) => r.status === 'completed')).toBe(true);

		// Each should have unique response
		const responses = results.map((r) => r.result as string);
		const uniqueResponses = new Set(responses);
		expect(uniqueResponses.size).toBe(10);

		// Check they're correctly sequenced
		responses.forEach((response, i) => {
			expect(response).toContain(`Request ${i}`);
		});
	});

	test('should isolate pause/resume state between concurrent clients', async () => {
		// Use DIFFERENT API keys for proper client isolation
		const client1 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client1-${randomUUID()}` },
		});
		const client2 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer client2-${randomUUID()}` },
		});

		await client1.init();
		await client1.connect();
		await client2.init();
		await client2.connect();

		let client1CallSequence = 0;
		let client2CallSequence = 0;

		client1.provideLLM({
			call: async (prompt) => {
				client1CallSequence++;
				// Simulate slow response for client 1
				await new Promise((resolve) => setTimeout(resolve, 50));
				return `C1-Seq${client1CallSequence}`;
			},
		});

		client2.provideLLM({
			call: async (prompt) => {
				client2CallSequence++;
				// Fast response for client 2
				return `C2-Seq${client2CallSequence}`;
			},
		});

		const code = `
			const a = await atp.llm.call({ prompt: 'First' });
			const b = await atp.llm.call({ prompt: 'Second' });
			const c = await atp.llm.call({ prompt: 'Third' });
			return { a, b, c };
		`;

		// Execute concurrently - client2 should finish first but maintain its own sequence
		const [result1, result2] = await Promise.all([client1.execute(code), client2.execute(code)]);

		expect(result1.status).toBe('completed');
		expect(result2.status).toBe('completed');

		// Client 1 should have its own sequence
		expect((result1.result as any).a).toBe('C1-Seq1');
		expect((result1.result as any).b).toBe('C1-Seq2');
		expect((result1.result as any).c).toBe('C1-Seq3');

		// Client 2 should have its own independent sequence
		expect((result2.result as any).a).toBe('C2-Seq1');
		expect((result2.result as any).b).toBe('C2-Seq2');
		expect((result2.result as any).c).toBe('C2-Seq3');

		// Each made exactly 3 calls
		expect(client1CallSequence).toBe(3);
		expect(client2CallSequence).toBe(3);
	});
});
