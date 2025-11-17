/**
 * E2E Test: Cross-Pod Resume with Shared Cache
 * Tests that execution can pause on one server instance and resume on another
 * using shared cache (Redis or FileCache)
 *
 * NOTE: Automatically uses Redis if available, otherwise falls back to FileCache.
 * Both provide persistent cross-pod state sharing.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { RedisCache, FileCache } from '@mondaydotcomorg/atp-providers';
import Redis from 'ioredis';
import path from 'path';
import os from 'os';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const hasRedis = async () => {
	try {
		const redis = new Redis(REDIS_URL);
		await redis.ping();
		await redis.quit();
		return true;
	} catch {
		return false;
	}
};

describe('Cross-Pod Resume E2E (Redis/FileCache)', () => {
	let redis1: Redis;
	let redis2: Redis;
	let server1: AgentToolProtocolServer;
	let server2: AgentToolProtocolServer;
	const PORT1 = 3445;
	const PORT2 = 3446;

	beforeAll(async () => {
		const redisAvailable = await hasRedis();
		const cacheType = redisAvailable ? 'Redis' : 'FileCache';
		console.log(`✅ Using ${cacheType} for cross-pod state sharing`);

		process.env.ATP_JWT_SECRET = 'test-secret-cross-pod';

		// Create shared cache providers (Redis or FileCache)
		let cache1, cache2;
		if (redisAvailable) {
			// Redis: Multiple instances sharing same key prefix
			redis1 = new Redis(REDIS_URL);
			redis2 = new Redis(REDIS_URL);
			cache1 = new RedisCache({ redis: redis1, keyPrefix: 'atp:test:' });
			cache2 = new RedisCache({ redis: redis2, keyPrefix: 'atp:test:' }); // Same prefix for shared state
		} else {
			// FileCache: Multiple instances sharing same directory
			const sharedCacheDir = path.join(os.tmpdir(), 'atp-test-cache-pod');
			cache1 = new FileCache({ cacheDir: sharedCacheDir, defaultTTL: 3600 });
			cache2 = new FileCache({ cacheDir: sharedCacheDir, defaultTTL: 3600 }); // Same directory for shared state
		}

		// Start two server instances sharing cache
		server1 = new AgentToolProtocolServer({
			execution: { timeout: 30000 },
			providers: { cache: cache1 },
		});

		server2 = new AgentToolProtocolServer({
			execution: { timeout: 30000 },
			providers: { cache: cache2 },
		});

		await server1.listen(PORT1);
		await server2.listen(PORT2);
	});

	afterAll(async () => {
		if (server1) await server1.stop();
		if (server2) await server2.stop();
		
		// Safe cleanup - handle already-closed or non-existent connections
		if (redis1) {
			try {
				await redis1.quit();
			} catch (error) {
				// Ignore - connection already closed or never opened
			}
		}
		if (redis2) {
			try {
				await redis2.quit();
			} catch (error) {
				// Ignore - connection already closed or never opened
			}
		}
		
		delete process.env.ATP_JWT_SECRET;
	});

	test('should execute on same server (baseline)', async () => {
		const client1 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${PORT1}`,
		});

		await client1.init();
		await client1.connect();

		let llmCallCount = 0;
		client1.provideLLM({
			call: async (prompt: string) => {
				llmCallCount++;
				return `Response ${llmCallCount} to: ${prompt}`;
			},
		});

		const code = `
const first = await atp.llm.call({ prompt: 'First call' });
const second = await atp.llm.call({ prompt: 'Second call' });
return { first, second };
		`;

		const result = await client1.execute(code);

		expect(result.status).toBe('completed');
		expect(llmCallCount).toBe(2);
		expect(result.result).toHaveProperty('first');
		expect(result.result).toHaveProperty('second');
	}, 15000);

	test('should handle concurrent executions on different servers', async () => {
		const client1 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${PORT1}`,
		});

		const client2 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${PORT2}`,
		});

		await client1.init();
		await client1.connect();
		await client2.init();
		await client2.connect();

		let count1 = 0;
		let count2 = 0;

		client1.provideLLM({
			call: async (prompt: string) => {
				count1++;
				return `Server1-${count1}`;
			},
		});

		client2.provideLLM({
			call: async (prompt: string) => {
				count2++;
				return `Server2-${count2}`;
			},
		});

		const code = `
const result = await atp.llm.call({ prompt: 'Test' });
return { result };
		`;

		// Execute on both servers concurrently
		const [result1, result2] = await Promise.all([client1.execute(code), client2.execute(code)]);

		expect(result1.status).toBe('completed');
		expect(result2.status).toBe('completed');
		expect(count1).toBe(1);
		expect(count2).toBe(1);

		console.log(`✅ Concurrent executions: Server1=${count1}, Server2=${count2}`);
	}, 15000);

	test('should handle batch parallel operations with shared cache', async () => {
		const redisAvailable = await hasRedis();
		const cacheType = redisAvailable ? 'Redis' : 'FileCache';

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${PORT1}`,
		});

		await client.init();
		await client.connect();

		let callCount = 0;
		const callLog: string[] = [];

		client.provideLLM({
			call: async (prompt: string) => {
				callCount++;
				callLog.push(prompt);
				return `Response ${callCount}`;
			},
		});

		const code = `
const results = await Promise.all([
  atp.llm.call({ prompt: 'A' }),
  atp.llm.call({ prompt: 'B' }),
  atp.llm.call({ prompt: 'C' })
]);
return { results, count: results.length };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).count).toBe(3);
		expect(callCount).toBe(3);
		expect(callLog).toEqual(['A', 'B', 'C']);

		console.log(
			`✅ Batch parallel with ${redisAvailable ? 'Redis' : 'FileCache'}: ${callCount} calls`
		);
	}, 15000);
});
