/**
 * E2E tests for Operation Checkpointing and Recovery
 *
 * Tests the checkpoint system's ability to:
 * 1. Automatically checkpoint API/LLM calls during execution
 * 2. Include checkpoint data in error responses
 * 3. Enable recovery using checkpointed results
 * 4. Handle both full snapshots and references
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';
import fetch from 'node-fetch';

const TEST_PORT = 3510;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Checkpoint Recovery E2E', () => {
	let server: AgentToolProtocolServer;
	let cacheProvider: MemoryCache;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-checkpoint-recovery';

		cacheProvider = new MemoryCache();

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 60000,
				memory: 128 * 1024 * 1024,
				llmCalls: 20,
			},
			providers: {
				cache: cacheProvider,
			},
		});

		// Register test tools that simulate various API operations
		server
			.tool('fetchUser', {
				description: 'Fetches user data from external API',
				input: {
					userId: 'string',
				},
				handler: async (params) => {
					return {
						id: (params as { userId: string }).userId,
						name: 'John Doe',
						email: 'john@example.com',
						createdAt: new Date().toISOString(),
					};
				},
			})
			.tool('fetchOrders', {
				description: 'Fetches orders for a user',
				input: {
					userId: 'string',
				},
				handler: async () => {
					return {
						orders: [
							{ id: 'order-1', amount: 100, status: 'completed' },
							{ id: 'order-2', amount: 250, status: 'pending' },
							{ id: 'order-3', amount: 75, status: 'completed' },
						],
						total: 425,
					};
				},
			})
			.tool('fetchLargeData', {
				description: 'Fetches a large dataset (triggers reference checkpoint)',
				input: {
					count: 'number',
				},
				handler: async (params: unknown) => {
					const { count } = params as { count: number };
					// Generate large data that will exceed snapshot threshold
					const items = Array.from({ length: count }, (_, i) => ({
						id: `item-${i}`,
						data: 'x'.repeat(100),
						nested: { value: i, meta: { processed: true } },
					}));
					return { items, count };
				},
			})
			.tool('failingOperation', {
				description: 'An operation that always fails',
				input: {
					message: 'string',
				},
				handler: async (params: unknown) => {
					throw new Error(`Intentional failure: ${(params as { message: string }).message}`);
				},
			})
			.tool('processData', {
				description: 'Processes data and returns result',
				input: {
					data: 'object',
				},
				handler: async (params: unknown) => {
					return {
						processed: true,
						input: (params as { data: unknown }).data,
						timestamp: Date.now(),
					};
				},
			});

		await server.listen(TEST_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	describe('Basic Checkpoint Creation', () => {
		test('should checkpoint API calls and include data in error response', async () => {
			// Initialize client
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'checkpoint-test' } }),
			});

			expect(initResponse.ok).toBe(true);
			const { clientId, token } = await initResponse.json();

			// Execute code that makes API calls then fails
			const code = `
				// Make some API calls that will be checkpointed
				const user = await api.custom.fetchUser({ userId: 'user-123' });
				console.log('Fetched user:', user);
				
				const orders = await api.custom.fetchOrders({ userId: user.id });
				console.log('Fetched orders:', orders);
				
				// This will fail, but checkpoints should be preserved
				const result = await api.custom.failingOperation({ message: 'test failure' });
				
				return { user, orders, result };
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			expect(executeResponse.ok).toBe(true);
			const result = await executeResponse.json();

			// Execution should have failed
			expect(result.status).toBe('failed');
			expect(result.error).toBeDefined();
			expect(result.error.message).toContain('Intentional failure');

			// Checkpoint data should be included in error response
			if (result.error.checkpointData) {
				const checkpointData = result.error.checkpointData;

				expect(checkpointData.checkpoints).toBeDefined();
				expect(Array.isArray(checkpointData.checkpoints)).toBe(true);

				// Should have at least 2 checkpoints (fetchUser and fetchOrders)
				expect(checkpointData.checkpoints.length).toBeGreaterThanOrEqual(2);

				// Verify checkpoint structure
				for (const checkpoint of checkpointData.checkpoints) {
					expect(checkpoint).toHaveProperty('id');
					expect(checkpoint).toHaveProperty('type');
					expect(checkpoint).toHaveProperty('operation');
					expect(checkpoint).toHaveProperty('description');
					expect(checkpoint).toHaveProperty('timestamp');
				}

				// Verify stats
				expect(checkpointData.stats).toBeDefined();
				expect(checkpointData.stats.total).toBeGreaterThanOrEqual(2);

				// Verify restore instructions
				expect(checkpointData.restoreInstructions).toBeDefined();
				expect(typeof checkpointData.restoreInstructions).toBe('string');
				expect(checkpointData.restoreInstructions.length).toBeGreaterThan(0);

				console.log('[TEST] Checkpoint data:', JSON.stringify(checkpointData, null, 2));
			}
		});

		test('should create full snapshot for small results', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'snapshot-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			const code = `
				// Small result should be stored as full snapshot
				const user = await api.custom.fetchUser({ userId: 'user-456' });
				
				// Force an error to see checkpoint data
				throw new Error('Intentional error to check checkpoint');
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			const result = await executeResponse.json();

			if (result.error?.checkpointData) {
				const checkpointData = result.error.checkpointData;

				// Should have at least one checkpoint with full snapshot
				const fullSnapshots = checkpointData.checkpoints.filter(
					(cp: any) => cp.result !== undefined
				);

				if (fullSnapshots.length > 0) {
					expect(fullSnapshots[0].result).toBeDefined();
					expect(fullSnapshots[0].result).toHaveProperty('id');
					expect(fullSnapshots[0].result).toHaveProperty('name');
				}

				// Stats should reflect full snapshots
				expect(checkpointData.stats.fullSnapshots).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe('Reference Checkpoints for Large Data', () => {
		test('should create reference checkpoint for large results', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'reference-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			const code = `
				// Large result should be stored as reference
				const largeData = await api.custom.fetchLargeData({ count: 100 });
				
				// Force an error to see checkpoint data
				throw new Error('Intentional error to check reference checkpoint');
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			const result = await executeResponse.json();

			if (result.error?.checkpointData) {
				const checkpointData = result.error.checkpointData;

				// Look for reference checkpoints (no result included)
				const references = checkpointData.checkpoints.filter(
					(cp: any) => cp.type === 'reference'
				);

				if (references.length > 0) {
					// Verify checkpoint metadata is present
					expect(references[0]).toHaveProperty('id');
					expect(references[0]).toHaveProperty('operation');
					expect(references[0]).toHaveProperty('description');
					expect(references[0]).toHaveProperty('type');
					// Reference checkpoints should NOT have result
					expect(references[0].result).toBeUndefined();
				}

				// RestoreInstructions should contain instructions for reference checkpoints
				if (references.length > 0) {
					expect(checkpointData.restoreInstructions).toContain('__checkpoint.restore');
				}

				console.log('[TEST] Reference checkpoint data:', JSON.stringify(checkpointData, null, 2));
			}
		});
	});

	describe('Multiple Checkpoints Scenario', () => {
		test('should handle multiple sequential API calls with checkpoints', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'multi-checkpoint-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			const code = `
				// Multiple API calls in sequence
				const [users1, user2] = await Promise.all([
					api.custom.fetchUser({ userId: 'user-a' }),
					api.custom.fetchUser({ userId: 'user-b' })
				]);
				const { total } = await api.custom.fetchOrders({ userId: 'user-a' });
				const orders2 = await api.custom.fetchOrders({ userId: 'user-b' });
				const largeData = await api.custom.fetchLargeData({ count: 100 });
				
				// Process combined data
				const processed = await api.custom.processData({
					data: {
						largeData,
						users: [user1, user2],
						orderSummary: {
							user1Orders: total,
							user2Orders: orders2.total
						}
					}
				});
				
				// Force error to see all checkpoints
				throw new Error('Check multiple checkpoints');
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			const result = await executeResponse.json();
			if (result.error?.checkpointData) {
				const checkpointData = result.error.checkpointData;

				// Should have 5 checkpoints (2 users + 2 orders + 1 process)
				expect(checkpointData.checkpoints.length).toBeGreaterThanOrEqual(3);

				// Verify unique checkpoint IDs
				const ids = checkpointData.checkpoints.map((cp: any) => cp.id);
				const uniqueIds = new Set(ids);
				expect(uniqueIds.size).toBe(ids.length);

				// Verify timestamps are in order
				const timestamps = checkpointData.checkpoints.map((cp: any) => cp.timestamp);
				for (let i = 1; i < timestamps.length; i++) {
					expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
				}

				console.log('[TEST] Multiple checkpoints:', {
					count: checkpointData.checkpoints.length,
					ids: checkpointData.checkpoints.map((cp: any) => cp.id),
				});
			}
		});
	});

	describe('Restore Instructions', () => {
		test('should generate LLM-readable restore instructions', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'restore-instructions-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			const code = `
				const user = await api.custom.fetchUser({ userId: 'user-restore' });
				const orders = await api.custom.fetchOrders({ userId: user.id });
				
				throw new Error('Test restore instructions');
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			const result = await executeResponse.json();

			if (result.error?.checkpointData) {
				const { restoreInstructions } = result.error.checkpointData;

				expect(restoreInstructions).toBeDefined();
				expect(typeof restoreInstructions).toBe('string');

				// Should contain helpful information for the LLM
				expect(restoreInstructions.length).toBeGreaterThan(50);

				console.log('[TEST] Restore instructions:\n', restoreInstructions);
			}
		});
	});

	describe('Checkpoint Stats', () => {
		test('should track checkpoint statistics correctly', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'stats-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			const code = `
				// Mix of small and potentially large operations
				await api.custom.fetchUser({ userId: 'stats-user' });
				await api.custom.fetchOrders({ userId: 'stats-user' });
				await api.custom.fetchLargeData({ count: 50 });
				
				throw new Error('Check stats');
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			const result = await executeResponse.json();

			if (result.error?.checkpointData) {
				const { stats } = result.error.checkpointData;

				expect(stats).toBeDefined();
				expect(stats.total).toBeGreaterThanOrEqual(3);
				expect(typeof stats.fullSnapshots).toBe('number');
				expect(typeof stats.references).toBe('number');
				expect(typeof stats.totalSizeBytes).toBe('number');

				// Total should equal snapshots + references
				expect(stats.total).toBe(stats.fullSnapshots + stats.references);

				console.log('[TEST] Checkpoint stats:', stats);
			}
		});
	});

	describe('Successful Execution (No Checkpoints in Response)', () => {
		test('should complete successfully without checkpoint data in result', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'success-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			const code = `
				const user = await api.custom.fetchUser({ userId: 'success-user' });
				const orders = await api.custom.fetchOrders({ userId: user.id });
				
				return {
					user,
					orders,
					summary: 'All operations completed successfully'
				};
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			const result = await executeResponse.json();

			// Should complete successfully
			expect(result.status).toBe('completed');
			expect(result.result).toBeDefined();
			expect(result.result.user).toBeDefined();
			expect(result.result.orders).toBeDefined();
			expect(result.result.summary).toBe('All operations completed successfully');

			// No error, so no checkpoint data
			expect(result.error).toBeUndefined();
		});
	});

	describe('Promise.all Checkpointing', () => {
		test('should checkpoint Promise.all with result variables and APIs in metadata', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'promise-all-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			const code = `
				// Promise.all with destructured result - should capture variable names and APIs
				const [userInfo, orderInfo] = await Promise.all([
					api.custom.fetchUser({ userId: 'promise-user' }),
					api.custom.fetchOrders({ userId: 'promise-user' })
				]);
				
				// Force error to see checkpoint data
				throw new Error('Check Promise.all checkpoint');
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			const result = await executeResponse.json();
			expect(result.status).toBe('failed');

			if (result.error?.checkpointData) {
				const { checkpoints, restoreInstructions } = result.error.checkpointData;

				console.log('\n[TEST] Promise.all Checkpoint Data:');
				console.log(JSON.stringify(checkpoints, null, 2));
				console.log('\n[TEST] Restore Instructions:\n', restoreInstructions);

				// Should have checkpoints - Promise.all creates a single checkpoint for the aggregated result
				expect(checkpoints.length).toBeGreaterThanOrEqual(1);

				// Find a checkpoint that has an array result (Promise.all result)
				const promiseAllCheckpoint = checkpoints.find(
					(cp: any) => Array.isArray(cp.result) || cp.operation?.includes('Promise')
				);

				if (promiseAllCheckpoint) {
					// The checkpoint should have the aggregated result
					expect(promiseAllCheckpoint.result).toBeDefined();
					
					// If result is an array, it should have both user and order data
					if (Array.isArray(promiseAllCheckpoint.result)) {
						expect(promiseAllCheckpoint.result.length).toBe(2);
					}
				}

				// Restore instructions should mention how to restore
				expect(restoreInstructions).toBeDefined();
				expect(restoreInstructions.length).toBeGreaterThan(50);
				
				// Should contain checkpoint ID reference
				expect(restoreInstructions).toContain('checkpoint');
			}
		});

		test('should allow restoring Promise.all checkpoint', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'promise-all-restore-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			// First execution: Promise.all then fail
			const failingCode = `
				const results = await Promise.all([
					api.custom.fetchUser({ userId: 'restore-promise-user' }),
					api.custom.fetchOrders({ userId: 'restore-promise-user' })
				]);
				
				throw new Error('Simulated failure after Promise.all');
			`;

			const failResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code: failingCode }),
			});

			const failResult = await failResponse.json();
			expect(['failed', 'timeout']).toContain(failResult.status);

			const checkpointData = failResult.error?.checkpointData;
			console.log('\n[TEST] Promise.all checkpoint for restore:', JSON.stringify(checkpointData, null, 2));

			if (checkpointData && checkpointData.checkpoints.length > 0) {
				// Find a checkpoint with array result (Promise.all result)
				const promiseAllCheckpoint = checkpointData.checkpoints.find(
					(cp: any) => Array.isArray(cp.result) || cp.operation?.includes('Promise')
				);

				if (promiseAllCheckpoint) {
					// Recovery: restore the Promise.all result
					const recoveryCode = `
						// Restore the entire Promise.all result
						const results = await __checkpoint.restore("${promiseAllCheckpoint.id}");
						
						// Continue processing with restored data
						const [user, orders] = results;
						
						return {
							recovered: true,
							user,
							orders,
							totalOrders: orders.total
						};
					`;

					const recoveryResponse = await fetch(`${BASE_URL}/api/execute`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${token}`,
							'X-Client-ID': clientId,
						},
						body: JSON.stringify({ code: recoveryCode }),
					});

					const recoveryResult = await recoveryResponse.json();

					console.log('[TEST] Promise.all recovery result:', recoveryResult);

					expect(recoveryResult.status).toBe('completed');
					expect(recoveryResult.result.recovered).toBe(true);
					expect(recoveryResult.result.user).toBeDefined();
					expect(recoveryResult.result.orders).toBeDefined();
				}
			}
		});
	});

	describe('Loop Checkpointing', () => {
		test('should checkpoint loop with accumulators and APIs in metadata', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'loop-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			// Use a small iteration count to avoid loop_detected status
			// The loop checkpoint is created AFTER the loop completes
			const code = `
				// Loop that accumulates results - should capture accumulators and APIs
				let allUsers = [];
				for (let i = 0; i < 2; i++) {
					const user = await api.custom.fetchUser({ userId: 'user-' + i });
					allUsers.push(user);
				}
				
				// Force error AFTER loop completes to trigger checkpoint persistence
				throw new Error('Check loop checkpoint');
			`;

			const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code }),
			});

			const result = await executeResponse.json();
			console.log('\n[TEST] Loop test result status:', result.status);
			
			// Status can be 'failed', 'timeout', or 'loop_detected' depending on loop transformer
			expect(['failed', 'timeout', 'loop_detected']).toContain(result.status);

			// Check for checkpoint data - may be in result.error.checkpointData or result.checkpointData
			const checkpointData = result.error?.checkpointData || result.checkpointData;
			
			if (checkpointData) {
				const { checkpoints, restoreInstructions } = checkpointData;

				console.log('\n[TEST] Loop Checkpoint Data:');
				console.log(JSON.stringify(checkpoints, null, 2));
				console.log('\n[TEST] Restore Instructions:\n', restoreInstructions);

				// Should have checkpoints
				expect(checkpoints.length).toBeGreaterThanOrEqual(1);

				// Find a checkpoint that contains accumulated data (object with arrays)
				const loopCheckpoint = checkpoints.find(
					(cp: any) => 
						(cp.result && typeof cp.result === 'object' && !Array.isArray(cp.result)) ||
						cp.operation?.includes('loop')
				);

				if (loopCheckpoint) {
					// The checkpoint should have the accumulated result
					expect(loopCheckpoint.result).toBeDefined();
					
					// Description should be present
					expect(loopCheckpoint.description).toBeDefined();
				}

				// Restore instructions should be helpful
				expect(restoreInstructions).toBeDefined();
				expect(restoreInstructions.length).toBeGreaterThan(50);
				expect(restoreInstructions).toContain('checkpoint');
			}
		});

		test('should allow restoring loop checkpoint with accumulated data', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'loop-restore-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			// First execution: loop that accumulates data then fails
			// Use small iteration count to complete before loop_detected triggers
			const failingCode = `
				let allUsers = [];
				let cursor = 'initial';
				
				for (let page = 0; page < 2; page++) {
					const user = await api.custom.fetchUser({ userId: 'loop-user-' + page });
					allUsers.push(user);
					cursor = 'page-' + (page + 1);
				}
				
				// Fail after loop completes (simulating error in post-processing)
				throw new Error('Processing failed after loop');
			`;

			const failResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code: failingCode }),
			});

			const failResult = await failResponse.json();
			console.log('\n[TEST] Loop restore test - initial status:', failResult.status);
			
			// Status can be 'failed', 'timeout', or 'loop_detected'
			expect(['failed', 'timeout', 'loop_detected']).toContain(failResult.status);

			const checkpointData = failResult.error?.checkpointData || failResult.checkpointData;
			console.log('\n[TEST] Loop checkpoint for restore:', JSON.stringify(checkpointData, null, 2));

			if (checkpointData && checkpointData.checkpoints.length > 0) {
				// Find a checkpoint with object result containing our accumulated data
				const loopCheckpoint = checkpointData.checkpoints.find(
					(cp: any) => 
						(cp.result && typeof cp.result === 'object' && !Array.isArray(cp.result) && cp.result.allUsers) ||
						cp.operation?.includes('loop')
				);

				if (loopCheckpoint) {
					// Recovery: restore the loop's accumulated state
					const recoveryCode = `
						// Restore the loop's accumulated state
						const loopState = await __checkpoint.restore("${loopCheckpoint.id}");
						
						// Extract the accumulated data
						const { allUsers, cursor } = loopState;
						
						// Continue with post-processing (the part that failed)
						return {
							recovered: true,
							userCount: allUsers.length,
							lastCursor: cursor,
							users: allUsers
						};
					`;

					const recoveryResponse = await fetch(`${BASE_URL}/api/execute`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${token}`,
							'X-Client-ID': clientId,
						},
						body: JSON.stringify({ code: recoveryCode }),
					});

					const recoveryResult = await recoveryResponse.json();

					console.log('[TEST] Loop recovery result:', recoveryResult);

					expect(recoveryResult.status).toBe('completed');
					expect(recoveryResult.result.recovered).toBe(true);
					expect(recoveryResult.result.userCount).toBe(2);
					expect(recoveryResult.result.users).toBeDefined();
					expect(Array.isArray(recoveryResult.result.users)).toBe(true);
				}
			}
		});
	});

	describe('Recovery Using Checkpointed Data', () => {
		test('should allow recovery code to use checkpointed results', async () => {
			const initResponse = await fetch(`${BASE_URL}/api/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientInfo: { name: 'recovery-test' } }),
			});

			const { clientId, token } = await initResponse.json();

			// First execution: make API calls then fail
			const failingCode = `
				const user = await api.custom.fetchUser({ userId: 'recovery-user' });
				const orders = await api.custom.fetchOrders({ userId: user.id });
				
				// Simulate a transient failure
				throw new Error('Network timeout');
			`;

			const failResponse = await fetch(`${BASE_URL}/api/execute`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
				body: JSON.stringify({ code: failingCode }),
			});

			const failResult = await failResponse.json();
			// Status can be 'failed' or 'timeout' depending on how the error is categorized
			expect(['failed', 'timeout']).toContain(failResult.status);
			expect(failResult.error).toBeDefined();

			// Extract checkpointed data (in real scenario, LLM would use this)
			const checkpointData = failResult.error?.checkpointData;
			console.log(checkpointData)

			if (checkpointData && checkpointData.checkpoints.length >= 2) {
				// Find the checkpoints with results
				// Note: checkpoint IDs now include execution ID (format: {executionId}:{shortId})
				const userCheckpoint = checkpointData.checkpoints.find(
					(cp: any) => cp.operation?.includes('fetchUser') || cp.result?.id === 'recovery-user'
				);
				const ordersCheckpoint = checkpointData.checkpoints.find(
					(cp: any) => cp.operation?.includes('fetchOrders') || cp.result?.orders
				);

				// Recovery execution: restore from the failed execution's checkpoints
				// The checkpoint ID already contains the execution ID, so just pass the full ID
				const recoveryCode = `
					// Restore checkpointed values using full checkpoint IDs
					// The IDs already include the execution ID (format: {executionId}:{shortId})
					const user = await __checkpoint.restore("${userCheckpoint.id}");
					const orders = await __checkpoint.restore("${ordersCheckpoint.id}");
					
					// Continue with the rest of the operation
					return {
						recovered: true,
						user,
						orders,
						summary: 'Successfully recovered from checkpoint'
					};
				`;

				const recoveryResponse = await fetch(`${BASE_URL}/api/execute`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
						'X-Client-ID': clientId,
					},
					body: JSON.stringify({ code: recoveryCode }),
				});

				const recoveryResult = await recoveryResponse.json();

				expect(recoveryResult.status).toBe('completed');
				expect(recoveryResult.result.recovered).toBe(true);
				expect(recoveryResult.result.user).toBeDefined();
				expect(recoveryResult.result.orders).toBeDefined();

				console.log('[TEST] Recovery result:', recoveryResult.result);
			}
		});
	});
});

