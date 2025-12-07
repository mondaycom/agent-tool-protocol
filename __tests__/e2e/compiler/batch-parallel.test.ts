/**
 * E2E Test: ATP Compiler Batch Parallel Execution
 * Tests that the compiler correctly transforms Promise.all into batch parallel operations
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';

const TEST_PORT = 3344;

describe('ATP Compiler Batch Parallel E2E', () => {
	let client: AgentToolProtocolClient;
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-compiler';

		// Start server with compiler enabled (default)
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 60000,
			},
		});
		await server.listen(TEST_PORT);

		// Create client
		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
		});

		await client.init();
		await client.connect();
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
	});

	test('should handle Promise.all with atp.llm.call (batch parallel)', async () => {
		const callLog: Array<{ timestamp: number; prompt: string }> = [];

		client.provideLLM({
			call: async (prompt: string) => {
				callLog.push({ timestamp: Date.now(), prompt });
				// Mock LLM response
				if (prompt.includes('Say A')) return 'A';
				if (prompt.includes('Say B')) return 'B';
				if (prompt.includes('Say C')) return 'C';
				return `Response to: ${prompt}`;
			},
		});

		// Compiler transforms Promise.all into batch parallel
		const code = `
const results = await Promise.all([
  atp.llm.call({ prompt: 'Say A' }),
  atp.llm.call({ prompt: 'Say B' }),
  atp.llm.call({ prompt: 'Say C' })
]);
return { results, count: results.length };
		`;

		const startTime = Date.now();
		const result = await client.execute(code);
		const duration = Date.now() - startTime;

		// Verify execution completed
		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('count', 3);
		expect(result.result).toHaveProperty('results');
		expect(Array.isArray((result.result as any).results)).toBe(true);

		// Verify all 3 LLM calls were made
		expect(callLog.length).toBe(3);

		// Verify calls were batched (all started within 100ms of each other)
		const timestamps = callLog.map((c) => c.timestamp);
		const timeSpread = Math.max(...timestamps) - Math.min(...timestamps);
		expect(timeSpread).toBeLessThan(100); // Batched calls should start nearly simultaneously

		// Verify execution was fast (< 2s for 3 parallel calls)
		expect(duration).toBeLessThan(2000);

		console.log(`✅ Batch parallel execution: ${duration}ms, time spread: ${timeSpread}ms`);
	}, 30000);

	test('should handle multiple sequential batch operations', async () => {
		let callCount = 0;
		client.provideLLM({
			call: async (prompt: string) => {
				callCount++;
				// Mock LLM response
				return `Response ${callCount}`;
			},
		});

		// Two separate Promise.all operations
		const code = `
const batch1 = await Promise.all([
  atp.llm.call({ prompt: 'Batch1-A' }),
  atp.llm.call({ prompt: 'Batch1-B' })
]);

const batch2 = await Promise.all([
  atp.llm.call({ prompt: 'Batch2-A' }),
  atp.llm.call({ prompt: 'Batch2-B' })
]);

return { batch1Count: batch1.length, batch2Count: batch2.length, totalCalls: 4 };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).batch1Count).toBe(2);
		expect((result.result as any).batch2Count).toBe(2);
		expect(callCount).toBe(4);

		console.log(`✅ Multiple sequential batches completed`);
	}, 120000);

	test('should handle large batch (10+ calls)', async () => {
		client.provideLLM({
			call: async (prompt: string) => {
				// Mock LLM response - extract number from prompt
				const match = prompt.match(/Item (\d+)/);
				return match ? `Response ${match[1]}` : 'Response';
			},
		});

		// Generate 15 parallel calls
		const calls = Array.from(
			{ length: 15 },
			(_, i) => `atp.llm.call({ prompt: 'Call ${i + 1}' })`
		).join(',\n  ');

		const code = `
const results = await Promise.all([
  ${calls}
]);
return { count: results.length };
		`;

		const startTime = Date.now();
		const result = await client.execute(code);
		const duration = Date.now() - startTime;

		expect(result.status).toBe('completed');
		expect((result.result as any).count).toBe(15);

		console.log(`✅ Large batch (15 calls): ${duration}ms`);
	}, 180000);

	test('should handle Promise.all with api.client.* calls (batch parallel)', async () => {
		const toolsCalled: string[] = [];

		// Register client tools
		const clientWithTools = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			serviceProviders: {
				tools: [
					{
						name: 'toolA',
						description: 'Tool A',
						inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
						handler: async (input: any) => {
							toolsCalled.push('toolA');
							return { result: input.value * 2 };
						},
					},
					{
						name: 'toolB',
						description: 'Tool B',
						inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
						handler: async (input: any) => {
							toolsCalled.push('toolB');
							return { result: input.value * 3 };
						},
					},
				],
			},
		});

		await clientWithTools.init();
		await clientWithTools.connect();

		const code = `
const results = await Promise.all([
  api.client.toolA({ value: 10 }),
  api.client.toolB({ value: 10 })
]);
return { a: results[0].result, b: results[1].result };
		`;

		const result = await clientWithTools.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).a).toBe(20);
		expect((result.result as any).b).toBe(30);

		// Verify both tools were called
		expect(toolsCalled).toContain('toolA');
		expect(toolsCalled).toContain('toolB');
		expect(toolsCalled.length).toBe(2);
	}, 30000);
});
