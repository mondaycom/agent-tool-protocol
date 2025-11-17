/**
 * Unit test to verify API call caching during resume
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';

describe('API Call Caching During Resume', () => {
	let server: AgentToolProtocolServer;
	const TEST_PORT = 3450 + Math.floor(Math.random() * 1000);

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-api-caching';

		const cacheProvider = new MemoryCache();
		server = new AgentToolProtocolServer({
			execution: { timeout: 10000 },
			providers: { cache: cacheProvider }, // Required for state caching
		});

		// Note: API groups will be registered in each test before server.listen()
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		// Give some time for all connections to close
		await new Promise(resolve => setTimeout(resolve, 100));
	});

	it('should cache API calls during resume', async () => {
		console.log('[TEST] Starting test: should cache API calls during resume');
		let callCount = 0;

		// Create a new server instance for this test
		console.log('[TEST] Creating server instance');
		const cacheProvider = new MemoryCache();
		const testServer = new AgentToolProtocolServer({
			execution: { timeout: 10000 },
			providers: { cache: cacheProvider },
		});

		// Register API group before starting server
		console.log('[TEST] Registering API group');
		testServer.use({
			name: 'test',
			type: 'custom',
			functions: [
				{
					name: 'add',
					description: 'Add two numbers',
					inputSchema: {
						type: 'object',
						properties: {
							a: { type: 'number' },
							b: { type: 'number' },
						},
						required: ['a', 'b'],
					},
					handler: async (params: any) => {
						callCount++;
						console.log(`[TEST] add() called: callCount=${callCount}, params=`, params);
						const { a, b } = params as { a: number; b: number };
						return { result: a + b, callNumber: callCount };
					},
				},
			],
		});

		console.log(`[TEST] Starting server on port ${TEST_PORT}`);
		await testServer.listen(TEST_PORT);
		console.log('[TEST] Server started successfully');

		console.log('[TEST] Creating client');
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: 'Bearer test-key' },
		});

		console.log('[TEST] Initializing client');
		await client.init();
		console.log('[TEST] Client initialized');
		
		console.log('[TEST] Connecting client');
		await client.connect();
		console.log('[TEST] Client connected');

		// Don't provide approval handler - execution will pause and wait for manual resume
		// This allows us to test that API calls are cached on resume
		// Code that makes API calls before pause
		const code = `
			const r1 = await api.test.add({ a: 1, b: 2 });
			const r2 = await api.test.add({ a: 3, b: 4 });
			await atp.approval.request('Pause', {});
			return { r1: r1.result, r2: r2.result };
		`;

		callCount = 0;
		console.log('[TEST] Executing code...');
		const result = await client.execute(code, {
			clientServices: {
				hasLLM: false,
				hasApproval: true,
				hasEmbedding: false,
				hasTools: false,
			},
		});
		console.log(`[TEST] Execution completed with status: ${result.status}, callCount=${callCount}`);

		if (result.status !== 'paused') {
			console.error('[TEST] Execution failed:', result.error);
			throw new Error(`Expected paused but got ${result.status}: ${JSON.stringify(result.error)}`);
		}
		expect(result.status).toBe('paused');
		const callsBeforeResume = callCount;
		console.log(`[TEST] Calls before resume: ${callsBeforeResume}`);
		expect(callsBeforeResume).toBe(2); // Both API calls should execute

		// Resume execution with approval
		console.log('[TEST] Resuming execution...');
		const resumeResult = await client.resume(result.executionId, { approved: true });
		console.log(`[TEST] Resume completed with status: ${resumeResult.status}, callCount=${callCount}`);

		const callsAfterResume = callCount;
		const newCalls = callsAfterResume - callsBeforeResume;
		console.log(`[TEST] New calls during resume: ${newCalls} (should be 0)`);

		// On resume, code restarts from beginning
		// API calls use cached results (0 new calls)
		expect(newCalls).toBe(0);
		expect(callsAfterResume).toBe(2);
		expect(resumeResult.status).toBe('completed');
		expect(resumeResult.result).toEqual({ r1: 3, r2: 7 });

		console.log('[TEST] Stopping server...');
		await testServer.stop();
		// Wait for cleanup
		await new Promise(resolve => setTimeout(resolve, 100));
		console.log('[TEST] Test completed successfully!');
	});

	it('should handle multiple calls to same API function', async () => {
		console.log('[TEST2] Starting test: should handle multiple calls to same API function');
		let callCount = 0;

		// Create a new server instance for this test
		console.log('[TEST2] Creating server instance');
		const cacheProvider = new MemoryCache();
		const testServer = new AgentToolProtocolServer({
			execution: { timeout: 10000 },
			providers: { cache: cacheProvider },
		});

		// Register API group before starting server
		testServer.use({
			name: 'test',
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
					handler: async (params: any) => {
						callCount++;
						const { a, b } = params as { a: number; b: number };
						return { result: a * b, callNumber: callCount };
					},
				},
			],
		});

		await testServer.listen(TEST_PORT + 1);

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT + 1}`,
			headers: { Authorization: 'Bearer test-key' },
		});

		await client.init();
		await client.connect();

		// Don't provide approval handler - execution will pause and wait for manual resume
		// Same API called multiple times
		const code = `
			const r1 = await api.test.multiply({ a: 2, b: 3 });
			const r2 = await api.test.multiply({ a: 4, b: 5 });
			const r3 = await api.test.multiply({ a: 6, b: 7 });
			await atp.approval.request('Pause', {});
			return { r1: r1.result, r2: r2.result, r3: r3.result };
		`;

		callCount = 0;
		const result = await client.execute(code, {
			clientServices: {
				hasLLM: false,
				hasApproval: true,
				hasEmbedding: false,
				hasTools: false,
			},
		});

		expect(result.status).toBe('paused');
		expect(callCount).toBe(3);

		// Resume execution with approval
		const resumeResult = await client.resume(result.executionId, { approved: true });

		// All 3 calls use cached results on resume (0 new calls)
		expect(callCount).toBe(3);
		expect(resumeResult.result).toEqual({ r1: 6, r2: 20, r3: 42 });

		console.log('[TEST2] Stopping server...');
		await testServer.stop();
		// Wait for cleanup
		await new Promise(resolve => setTimeout(resolve, 100));
		console.log('[TEST2] Test completed successfully!');
	});
});

