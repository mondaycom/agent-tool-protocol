/**
 * E2E tests for runtime progress API
 * Tests progress reporting from sandboxed execution
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { randomUUID } from 'node:crypto';

const TEST_PORT = 3342;
const TEST_API_KEY = `test-key-${randomUUID()}`;

describe('Runtime Progress E2E', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-progress';
		// Create ATP server
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 5,
			},
		});

		await server.listen(TEST_PORT);

		// Create ATP client
		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer ${TEST_API_KEY}` },
		});
		await client.init();
		await client.connect();
	});

	afterAll(async () => {
		delete process.env.ATP_JWT_SECRET;
		if (server) {
			await server.stop();
		}
	});

	test('should report progress during execution', async () => {
		const code = `
			// Report progress at different stages
			atp.progress.report('Starting task', 0);
			
			// Simulate some work
			let sum = 0;
			for (let i = 0; i < 1000; i++) {
				sum += i;
			}
			atp.progress.report('Processing data', 0.5);
			
			// More work
			for (let i = 0; i < 1000; i++) {
				sum += i * 2;
			}
			atp.progress.report('Almost done', 0.9);
			
			atp.progress.report('Complete', 1.0);
			
			return { sum, completed: true };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).completed).toBe(true);
	});

	test('should handle progress without callback', async () => {
		const code = `
			atp.progress.report('No callback provided', 0.5);
			return { success: true };
		`;

		// Execute without progress callback - should not throw
		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).success).toBe(true);
	});

	test('should report progress in async operations', async () => {
		const code = `
			atp.progress.report('Starting async operations', 0);
			
			// Simulate async work
			await new Promise(resolve => setTimeout(resolve, 10));
			atp.progress.report('First async done', 0.33);
			
			await new Promise(resolve => setTimeout(resolve, 10));
			atp.progress.report('Second async done', 0.66);
			
			await new Promise(resolve => setTimeout(resolve, 10));
			atp.progress.report('All async done', 1.0);
			
			return { asyncCompleted: true };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).asyncCompleted).toBe(true);
	});
});
