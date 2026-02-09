/**
 * E2E tests for isolate VM limits (memory and timeout)
 * Ensures that the isolate properly enforces limits and handles exceeding them gracefully
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { randomUUID } from 'node:crypto';

const TEST_PORT = 3355;

describe('Isolate VM Limits E2E', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-isolate-limits';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024, // 128MB
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

	describe('Memory Limit Tests', () => {
		test('should enforce memory limit and fail gracefully when exceeded', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			// Code that tries to allocate more memory than the 128MB limit
			const memoryExceedingCode = `
				// Try to allocate ~150MB of memory (exceeding 128MB limit)
				const arrays = [];
				try {
					for (let i = 0; i < 35; i++) {
						// Each array is ~4MB (1M * 4 bytes per number)
						const largeArray = new Array(1000000).fill(i);
						arrays.push(largeArray);
						
						// Log progress to help debug
						if (i % 5 === 0) {
							console.log(\`Allocated array \${i}, total arrays: \${arrays.length}\`);
						}
					}
					return 'Memory allocation succeeded unexpectedly';
				} catch (error) {
					return \`Memory limit enforced: \${error.message}\`;
				}
			`;

			const result = await client.execute(memoryExceedingCode);

			console.log('----------------- ISOLATED HERE')
			// Should fail due to memory limit
			expect(result.status).toMatch(/^(failed|memory_exceeded)$/);
			expect(result.error).toBeDefined();
			expect(result.error?.message).toMatch(/memory|limit|exceeded|disposed/i);
			
			// Should have some memory usage recorded
			expect(result.stats?.memoryUsed).toBeDefined();
			expect(typeof result.stats?.memoryUsed).toBe('number');
		}, 15000);

		test('should handle memory limit with different allocation patterns', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			// Try rapid small allocations that accumulate beyond limit
			const rapidAllocationCode = `
				const objects = [];
				try {
					// Create many objects that accumulate to exceed memory limit
					for (let i = 0; i < 200000; i++) {
						objects.push({
							id: i,
							data: new Array(500).fill(\`item-\${i}\`),
							timestamp: Date.now(),
							random: Math.random()
						});
						
						if (i % 50000 === 0) {
							console.log(\`Created \${i} objects\`);
						}
					}
					return \`Created \${objects.length} objects\`;
				} catch (error) {
					return \`Caught error after \${objects.length} objects: \${error.message}\`;
				}
			`;

			const result = await client.execute(rapidAllocationCode);

			// Should either complete with fewer objects or fail with memory error
			expect(result.status).toMatch(/^(completed|failed|memory_exceeded)$/);
			
			if (result.status === 'failed' || result.status === 'memory_exceeded') {
				expect(result.error?.message).toMatch(/memory|limit|exceeded|disposed/i);
			} else {
				// If completed, should have created fewer than expected objects
				expect(result.result).toMatch(/Created \d+ objects/);
				const match = (result.result as string).match(/Created (\d+) objects/);
				if (match) {
					const objectCount = parseInt(match[1]);
					expect(objectCount).toBeLessThan(200000);
				}
			}
		}, 15000);

		test('should allow execution within memory limits', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			// Code that stays well within the 128MB limit
			const withinLimitCode = `
				// Allocate ~50MB (well within 128MB limit)
				const arrays = [];
				for (let i = 0; i < 12; i++) {
					// Each array is ~4MB
					const array = new Array(1000000).fill(i);
					arrays.push(array);
				}
				
				return {
					arraysCreated: arrays.length,
					totalElements: arrays.reduce((sum, arr) => sum + arr.length, 0),
					sampleValue: arrays[0][0]
				};
			`;

			const result = await client.execute(withinLimitCode);

			expect(result.status).toBe('completed');
			expect(result.result).toEqual({
				arraysCreated: 12,
				totalElements: 12000000,
				sampleValue: 0
			});
			
			// Should have reasonable memory usage recorded
			expect(result.stats?.memoryUsed).toBeDefined();
			expect(result.stats?.memoryUsed).toBeGreaterThan(0);
		});
	});

	describe('Timeout Limit Tests', () => {
		test('should enforce timeout and terminate execution', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			// Code that runs longer than timeout (using 5 second timeout)
			const longRunningCode = `
				const startTime = Date.now();
				let iterations = 0;
				
				// Busy loop that runs for ~10 seconds (longer than 5s timeout)
				while (Date.now() - startTime < 10000) {
					iterations++;
					// Add some work to prevent optimization
					Math.sqrt(iterations);
				}
				
				return \`Completed \${iterations} iterations\`;
			`;

			const startTime = Date.now();
			const result = await client.execute(longRunningCode, {
				timeout: 5000, // 5 second timeout
			});
			const duration = Date.now() - startTime;

			// Should timeout
			expect(result.status).toBe('timeout');
			expect(result.error).toBeDefined();
			expect(result.error?.message).toMatch(/timeout|time.*out|exceeded/i);
			
			// Should have terminated around the timeout duration
			expect(duration).toBeGreaterThanOrEqual(4500); // Allow some variance
			expect(duration).toBeLessThan(8000); // Should not run to completion
			
			// Should have duration stats
			expect(result.stats?.duration).toBeDefined();
			expect(result.stats?.duration).toBeGreaterThanOrEqual(5000);
		}, 10000);

		test('should allow execution within timeout limits', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			// Code that completes well within timeout
			const withinTimeoutCode = `
				let sum = 0;
				const startTime = Date.now();
				
				// Run for ~1 second (well within 5s timeout)
				while (Date.now() - startTime < 1000) {
					sum += Math.random();
				}
				
				return {
					sum: Math.floor(sum),
					duration: Date.now() - startTime,
					completed: true
				};
			`;

			const result = await client.execute(withinTimeoutCode, {
				timeout: 5000,
			});

			expect(result.status).toBe('completed');
			expect(result.result).toMatchObject({
				completed: true
			});
			expect((result.result as any).duration).toBeGreaterThan(900);
			expect((result.result as any).duration).toBeLessThan(1500);
			
			// Should have reasonable duration stats
			expect(result.stats?.duration).toBeGreaterThan(900);
			expect(result.stats?.duration).toBeLessThan(2000);
		});
	});

	describe('Combined Limit Tests', () => {
		test('should handle scripts that could exceed both limits', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			// Code that tries to exceed both memory and time limits
			const combinedLimitCode = `
				const arrays = [];
				const startTime = Date.now();
				let iterations = 0;
				
				try {
					// Try to allocate memory while also running for a long time
					while (Date.now() - startTime < 8000) { // 8 seconds
						iterations++;
						
						// Allocate memory every 100 iterations
						if (iterations % 100 === 0) {
							arrays.push(new Array(100000).fill(iterations));
						}
						
						// Some computation
						Math.sqrt(iterations);
					}
					
					return \`Completed \${iterations} iterations with \${arrays.length} arrays\`;
				} catch (error) {
					return \`Failed after \${iterations} iterations: \${error.message}\`;
				}
			`;

			const result = await client.execute(combinedLimitCode, {
				timeout: 3000, // 3 second timeout
			});

			// Should fail due to either timeout or memory limit
			expect(result.status).toMatch(/^(timeout|failed|memory_exceeded)$/);
			expect(result.error).toBeDefined();

			if (result.status === 'timeout') {
				expect(result.error?.message).toMatch(/timeout|time.*out/i);
			} else {
				expect(result.error?.message).toMatch(/memory|limit|exceeded|disposed/i);
			}
		}, 8000);

		test('should properly clean up resources after limit exceeded', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			// First execution that exceeds memory limit
			const memoryCode = `
				const arrays = [];
				for (let i = 0; i < 35; i++) {
					arrays.push(new Array(1000000).fill(i));
				}
				return 'Should not complete';
			`;

			const result1 = await client.execute(memoryCode);
			expect(result1.status).toMatch(/^(failed|memory_exceeded)$/);

			// Second execution should work normally (resources cleaned up)
			const normalCode = `
				const small = [1, 2, 3, 4, 5];
				return small.reduce((a, b) => a + b, 0);
			`;

			const result2 = await client.execute(normalCode);
			expect(result2.status).toBe('completed');
			expect(result2.result).toBe(15);
		}, 15000);
	});

	describe('Error Handling and Recovery', () => {
		test('should provide meaningful error messages for memory limits', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			const code = `
			// Try to allocate ~150MB of memory (exceeding 128MB limit)
				const arrays = [];
				try {
					for (let i = 0; i < 35; i++) {
						// Each array is ~4MB (1M * 4 bytes per number)
						const largeArray = new Array(1000000).fill(i);
						arrays.push(largeArray);
						
						// Log progress to help debug
						if (i % 5 === 0) {
							console.log(\`Allocated array \${i}, total arrays: \${arrays.length}\`);
						}
					}
					return 'Memory allocation succeeded unexpectedly';
				} catch (error) {
					return \`Memory limit enforced: \${error.message}\`;
				}
			`;

			const result = await client.execute(code);

			expect(result.status).toMatch(/^(failed|memory_exceeded)$/);
			expect(result.error).toBeDefined();
			expect(result.error?.message).toBeTruthy();
			expect(typeof result.error?.message).toBe('string');

			// Should have execution metadata
			expect(result.executionId).toBeDefined();
			expect(result.stats).toBeDefined();
		});

		test('should provide meaningful error messages for timeout limits', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${TEST_PORT}`,
				headers: { Authorization: `Bearer test-${randomUUID()}` },
			});

			await client.init();
			await client.connect();

			const code = `
				// Infinite loop
				while (true) {
					Math.random();
				}
			`;

			const result = await client.execute(code, { timeout: 2000 });

			expect(result.status).toBe('timeout');
			expect(result.error).toBeDefined();
			expect(result.error?.message).toBeTruthy();
			expect(typeof result.error?.message).toBe('string');

			// Should have execution metadata
			expect(result.executionId).toBeDefined();
			expect(result.stats).toBeDefined();
			expect(result.stats?.duration).toBeGreaterThanOrEqual(2000);
		}, 5000);
	});
});
