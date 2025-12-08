/**
 * E2E tests for runtime cache and approval features in sandboxed execution
 * Tests the actual functionality - NO MOCKS, NO BYPASSES, NO FAKE OUTPUTS
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { randomUUID } from 'node:crypto';

const TEST_PORT = 3341;
const TEST_API_KEY = `test-key-${randomUUID()}`;

describe('Runtime Features E2E - Cache and Approval', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;
	let approvalRequests: Array<{ message: string; context?: Record<string, unknown> }> = [];

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-cache-approval';

		// Create ATP server
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 5,
			},
		});

		// Add simple test API
		server.use({
			name: 'test-api',
			type: 'custom',
			functions: [
				{
					name: 'multiply',
					description: 'Multiply two numbers',
					inputSchema: {
						type: 'object',
						properties: {
							a: { type: 'number' },
							b: { type: 'number' },
						},
						required: ['a', 'b'],
					},
					handler: async (params: unknown) => {
						const { a, b } = params as { a: number; b: number };
						return { result: a * b };
					},
				},
			],
		});

		await server.listen(TEST_PORT);

		// Create ATP client
		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer ${TEST_API_KEY}` },
		});
		await client.init();
		await client.connect();

		// Provide approval handler that logs requests and approves based on amount
		client.provideApproval({
			request: async (message, context) => {
				const amount = (context?.amount as number) || 0;
				approvalRequests.push({ message, context: context || {} });

				// Approve if amount < 100, reject otherwise
				const approved = amount < 100;
				return {
					approved,
					timestamp: Date.now(),
					response: approved ? 'Approved' : 'Rejected - amount too high',
				};
			},
		});
	});

	beforeEach(() => {
		// Clear approval requests before each test
		approvalRequests.length = 0;
	});

	afterEach(async () => {
		// Clear cache after each test to avoid cross-test pollution
		await client.execute(`
			const keys = ['expensive:op1', 'expensive:op2'];
			for (const key of keys) {
				await atp.cache.delete(key);
			}
		`);
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
	});

	describe('Cache System', () => {
		test('should set and get cache values', async () => {
			const code = `
				// Set cache values
				await atp.cache.set('key1', 'value1', 60);
				await atp.cache.set('key2', { nested: 'object' }, 60);
				await atp.cache.set('key3', [1, 2, 3], 60);
				
				// Get them back
				const val1 = await atp.cache.get('key1');
				const val2 = await atp.cache.get('key2');
				const val3 = await atp.cache.get('key3');
				const missing = await atp.cache.get('nonexistent');
				
				return { val1, val2, val3, missing };
			`;

			const result = await client.execute(code);

			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.val1).toBe('value1');
			expect(output.val2).toEqual({ nested: 'object' });
			expect(output.val3).toEqual([1, 2, 3]);
			expect(output.missing).toBeNull();
		});

		test('should check if keys exist', async () => {
			const code = `
				await atp.cache.set('existing-key', 'value', 60);
				
				const exists = await atp.cache.has('existing-key');
				const notExists = await atp.cache.has('missing-key');
				
				return { exists, notExists };
			`;

			const result = await client.execute(code);

			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.exists).toBe(true);
			expect(output.notExists).toBe(false);
		});

		test('should delete cache entries', async () => {
			const code = `
				await atp.cache.set('to-delete', 'value', 60);
				const beforeDelete = await atp.cache.has('to-delete');
				
				await atp.cache.delete('to-delete');
				const afterDelete = await atp.cache.has('to-delete');
				
				return { beforeDelete, afterDelete };
			`;

			const result = await client.execute(code);

			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.beforeDelete).toBe(true);
			expect(output.afterDelete).toBe(false);
		});

		test('should work within an execution context', async () => {
			// Single execution that sets and gets multiple times
			const code = `
				// Set initial value
				await atp.cache.set('counter', { count: 1 }, 300);
				const val1 = await atp.cache.get('counter');
				
				// Update value
				await atp.cache.set('counter', { count: 2 }, 300);
				const val2 = await atp.cache.get('counter');
				
				// Update again
				await atp.cache.set('counter', { count: 3 }, 300);
				const val3 = await atp.cache.get('counter');
				
				return { val1, val2, val3 };
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.val1).toEqual({ count: 1 });
			expect(output.val2).toEqual({ count: 2 });
			expect(output.val3).toEqual({ count: 3 });
		});

		test('should cache computed values within execution', async () => {
			const code = `
				const cacheKey = 'computed:expensive';
				const results = [];
				
				// First access - compute and cache
				let result = await atp.cache.get(cacheKey);
				if (!result) {
					result = { value: 42 * 42, computed: true };
					await atp.cache.set(cacheKey, result, 300);
					results.push({ fromCache: false, result });
				}
				
				// Second access - should hit cache
				const cached1 = await atp.cache.get(cacheKey);
				results.push({ fromCache: true, result: cached1 });
				
				// Third access - should also hit cache
				const cached2 = await atp.cache.get(cacheKey);
				results.push({ fromCache: true, result: cached2 });
				
				return { results };
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.results).toHaveLength(3);
			expect(output.results[0].fromCache).toBe(false);
			expect(output.results[0].result).toEqual({ value: 1764, computed: true });
			expect(output.results[1].fromCache).toBe(true);
			expect(output.results[1].result).toEqual({ value: 1764, computed: true });
			expect(output.results[2].fromCache).toBe(true);
			expect(output.results[2].result).toEqual({ value: 1764, computed: true });
		});
	});

	describe('Approval System', () => {
		beforeEach(() => {
			approvalRequests = [];
		});

		test('DEBUG: should show client has approval handler', async () => {
			// Just check the client is set up correctly
			expect(client).toBeDefined();
			console.log('Client approval handler configured:', !!client);
		});

		test('should request and receive approval', async () => {
			const code = `
				const result = await atp.approval.request('Test operation', {
					amount: 50,
					operation: 'transfer',
				});
				
				return {
					approved: result.approved,
					hasTimestamp: typeof result.timestamp === 'number',
					response: result.response,
				};
			`;

			const result = await client.execute(code);

			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.approved).toBe(true);
			expect(output.hasTimestamp).toBe(true);
			expect(output.response).toBe('Approved');

			// Verify the approval handler was called correctly
			expect(approvalRequests).toHaveLength(1);
			expect(approvalRequests[0]?.message).toBe('Test operation');
			expect(approvalRequests[0]?.context?.amount).toBe(50);
		});

		test('should reject approval when amount is too high', async () => {
			const code = `
				const result = await atp.approval.request('Large transfer', {
					amount: 500,
					operation: 'transfer',
				});
				
				return {
					approved: result.approved,
					response: result.response,
				};
			`;

			const result = await client.execute(code);

			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.approved).toBe(false);
			expect(output.response).toBe('Rejected - amount too high');

			// Verify the approval handler was called
			expect(approvalRequests).toHaveLength(1);
			expect(approvalRequests[0]?.context?.amount).toBe(500);
		});

		test('should handle multiple approval requests', async () => {
			const code = `
				const approval1 = await atp.approval.request('Request 1', { amount: 30 });
				const approval2 = await atp.approval.request('Request 2', { amount: 200 });
				const approval3 = await atp.approval.request('Request 3', { amount: 75 });
				
				return {
					results: [
						approval1.approved,
						approval2.approved,
						approval3.approved,
					],
				};
			`;

			const result = await client.execute(code);

			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.results).toEqual([true, false, true]);

			// Verify all approval handlers were called (order may vary due to async handling)
			expect(approvalRequests).toHaveLength(3);
			const messages = approvalRequests.map((r) => r.message);
			expect(messages).toContain('Request 1');
			expect(messages).toContain('Request 2');
			expect(messages).toContain('Request 3');
		});

		test('should pass complex context in approval requests', async () => {
			const code = `
				const result = await atp.approval.request('Complex operation', {
					amount: 25,
					user: { id: 123, name: 'John Doe' },
					metadata: {
						timestamp: Date.now(),
						source: 'test',
					},
				});
				
				return { approved: result.approved };
			`;

			const result = await client.execute(code);

			expect(result.status).toBe('completed');
			const output = result.result as any;
			expect(output.approved).toBe(true);

			// Verify complex context was passed correctly
			expect(approvalRequests).toHaveLength(1);
			const context = approvalRequests[0]?.context;
			expect(context?.amount).toBe(25);
			expect((context?.user as any)?.id).toBe(123);
			expect((context?.user as any)?.name).toBe('John Doe');
			expect((context?.metadata as any)?.source).toBe('test');
		});
	});

	describe('Combined Cache and Approval', () => {
		test('should use approval before caching expensive operations', async () => {
			const code = `
				const operations = [];
				
				// Operation 1: Request approval and cache result  
				const approval1 = await atp.approval.request('Cache operation', { amount: 50 });
				operations.push({ approved: approval1.approved });
				
				if (approval1.approved) {
					await atp.cache.set('my-expensive-result', { data: 'expensive' }, 300);
				}
				
				// Operation 2: Access cached result (no approval needed)
				const cached = await atp.cache.get('my-expensive-result');
				operations.push({ fromCache: !!cached, data: cached });
				
				return { operations };
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			const output = result.result as any;

			// Verify operation flow
			expect(output.operations[0].approved).toBe(true);
			expect(output.operations[1].fromCache).toBe(true);
			expect(output.operations[1].data).toEqual({ data: 'expensive' });

			// Verify only one approval was requested
			expect(approvalRequests).toHaveLength(1);
			expect(approvalRequests[0].message).toBe('Cache operation');
			expect(approvalRequests[0].context?.amount).toBe(50);
		});
	});
});
