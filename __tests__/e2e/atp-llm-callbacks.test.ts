/**
 * E2E Test: ATP LLM Callbacks
 * Tests that atp.llm.call() works correctly with pause/resume
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';

const TEST_PORT = 3345;

describe('ATP LLM Callbacks E2E', () => {
	let client: AgentToolProtocolClient;
	let server: InstanceType<typeof AgentToolProtocolServer>;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-llm-callbacks';

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

	test('should handle single atp.llm.call()', async () => {
		client.provideLLM({
			call: async (prompt: string) => {
				return 'Hello World';
			},
		});

		const code = `
const result = await atp.llm.call({ prompt: 'Say hello in 2 words' });
return { success: true, response: result };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('success', true);
		expect(result.result).toHaveProperty('response');
		expect(result.stats.llmCallsCount).toBe(1);
	});

	test('should handle multiple sequential atp.llm.call()', async () => {
		client.provideLLM({
			call: async (prompt: string) => {
				if (prompt.includes('one')) return 'One';
				if (prompt.includes('two')) return 'Two';
				return 'Response';
			},
		});

		const code = `
const first = await atp.llm.call({ prompt: 'Say one' });
const second = await atp.llm.call({ prompt: 'Say two' });
return { first, second };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('first');
		expect(result.result).toHaveProperty('second');
		expect(result.stats.llmCallsCount).toBe(2);
	});

	test('should handle Promise.all with atp.llm.call (batch parallel)', async () => {
		let callCount = 0;
		const callLog: string[] = [];

		client.provideLLM({
			call: async (prompt: string) => {
				callCount++;
				callLog.push(`Call ${callCount}: ${prompt}`);
				console.log(`[TEST] LLM Call #${callCount}: ${prompt}`);
				// Mock LLM response
				const response = prompt.includes('A') ? 'A' : prompt.includes('B') ? 'B' : 'C';
				console.log(`[TEST] LLM Response #${callCount}: ${response}`);
				return response;
			},
		});

		const code = `
const results = await Promise.all([
  atp.llm.call({ prompt: 'Say A' }),
  atp.llm.call({ prompt: 'Say B' }),
  atp.llm.call({ prompt: 'Say C' })
]);
return { results, count: results.length };
		`;

		console.log('[TEST] Starting execution test...');
		const startTime = Date.now();

		const result = await client.execute(code);

		const duration = Date.now() - startTime;
		console.log(`[TEST] Execution completed in ${(duration / 1000).toFixed(2)}s`);
		console.log(`[TEST] Call count: ${callCount}`);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('count', 3);
		expect(result.result).toHaveProperty('results');
		expect(Array.isArray((result.result as any).results)).toBe(true);
		expect(callCount).toBe(3);

		console.log(`✅ Promise.all with 3 LLM calls completed`);
	}, 180000);

	test('should handle Promise.all with map() and shorthand properties', async () => {
		let callCount = 0;

		client.provideLLM({
			call: async (_prompt: string) => {
				callCount++;
				return `Summary for item ${callCount}`;
			},
		});

		const code = `
const items = [
  { id: 1, subject: 'Email A', snippet: 'Content A' },
  { id: 2, subject: 'Email B', snippet: 'Content B' },
  { id: 3, subject: 'Email C', snippet: 'Content C' }
];

const results = await Promise.all(
  items.map(async (item) => {
    const subject = item.subject;
    const summary = await atp.llm.call({ prompt: \`Summarize: \${item.snippet}\` });
    return { subject, summary };
  })
);

return { results, count: results.length };
		`;

		console.log('[TEST] Starting shorthand property test...');
		const result = await client.execute(code);

		console.log('[TEST] Result:', JSON.stringify(result, null, 2));

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('count', 3);
		expect(result.result).toHaveProperty('results');
		const results = (result.result as any).results;
		expect(Array.isArray(results)).toBe(true);
		expect(results[0]).toHaveProperty('subject', 'Email A');
		expect(results[0]).toHaveProperty('summary');

		console.log(`✅ Shorthand properties work correctly`);
	}, 180000);

	test('should BATCH LLM calls while preserving object structure', async () => {
		let callCount = 0;
		const callTimes: number[] = [];

		client.provideLLM({
			call: async (prompt: string) => {
				callCount++;
				callTimes.push(Date.now());
				await new Promise(resolve => setTimeout(resolve, 50));
				return `Summary for: ${prompt.substring(0, 20)}`;
			},
		});

		const code = `
const items = [
  { id: 1, subject: 'Email A', snippet: 'Content A about meetings' },
  { id: 2, subject: 'Email B', snippet: 'Content B about projects' },
  { id: 3, subject: 'Email C', snippet: 'Content C about reviews' }
];

const results = await Promise.all(
  items.map(async (item) => {
    const subject = item.subject;
    const id = item.id;
    const summary = await atp.llm.call({ prompt: item.snippet });
    return { id, subject, summary };
  })
);

return { results, count: results.length };
		`;

		console.log('[TEST] Starting batch LLM with object preservation test...');
		const startTime = Date.now();
		const result = await client.execute(code);
		const duration = Date.now() - startTime;

		console.log('[TEST] Result:', JSON.stringify(result, null, 2));
		console.log(`[TEST] Total duration: ${duration}ms, LLM calls: ${callCount}`);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('count', 3);
		expect(result.result).toHaveProperty('results');
		
		const results = (result.result as any).results;
		expect(Array.isArray(results)).toBe(true);
		
		// Verify object structure is preserved
		expect(results[0]).toHaveProperty('id', 1);
		expect(results[0]).toHaveProperty('subject', 'Email A');
		expect(results[0]).toHaveProperty('summary');
		expect(typeof results[0].summary).toBe('string');

		// Verify all 3 LLM calls were made
		expect(callCount).toBe(3);

		console.log(`✅ Batch LLM with object preservation works!`);
	}, 180000);

	test('should handle multiple LLM calls per map callback (batch_reconstruct)', async () => {
		let callCount = 0;
		const callLog: string[] = [];

		client.provideLLM({
			call: async (prompt: string) => {
				callCount++;
				callLog.push(prompt);
				// Return different results based on prompt type
				if (prompt.includes('title')) {
					return `Title: ${prompt.split('for ')[1] || 'Unknown'}`;
				}
				if (prompt.includes('summary')) {
					return `Summary: ${prompt.split('of ')[1] || 'Unknown'}`;
				}
				return `Response ${callCount}`;
			},
		});

		const code = `
const items = [
  { id: 1, name: 'Alpha', content: 'Alpha content here' },
  { id: 2, name: 'Beta', content: 'Beta content here' },
  { id: 3, name: 'Gamma', content: 'Gamma content here' }
];

const results = await Promise.all(
  items.map(async (item) => {
    const title = await atp.llm.call({ prompt: 'Generate title for ' + item.name });
    const summary = await atp.llm.call({ prompt: 'Generate summary of ' + item.content });
    return { id: item.id, title, summary };
  })
);

return { results, count: results.length };
		`;

		console.log('[TEST] Starting multiple LLM calls per callback test...');
		const result = await client.execute(code);

		console.log('[TEST] Result:', JSON.stringify(result, null, 2));
		console.log('[TEST] Call log:', callLog);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('count', 3);
		expect(result.result).toHaveProperty('results');

		const results = (result.result as any).results;
		expect(Array.isArray(results)).toBe(true);
		expect(results).toHaveLength(3);

		// Verify each result has both title and summary from separate LLM calls
		for (let i = 0; i < results.length; i++) {
			expect(results[i]).toHaveProperty('id');
			expect(results[i]).toHaveProperty('title');
			expect(results[i]).toHaveProperty('summary');
			expect(typeof results[i].title).toBe('string');
			expect(typeof results[i].summary).toBe('string');
		}

		// Verify all 6 LLM calls were made (2 per item × 3 items)
		expect(callCount).toBe(6);

		// Verify batch_reconstruct transformation was applied by checking call order pattern
		// With batch_reconstruct, calls are grouped by type:
		// - First batch: all 3 title calls (indices 0, 1, 2)
		// - Second batch: all 3 summary calls (indices 3, 4, 5)
		console.log('[TEST] Verifying call grouping pattern for batch_reconstruct...');

		// Check that the first 3 calls are all "title" calls
		const titleCalls = callLog.slice(0, 3);
		expect(titleCalls.every((c) => c.includes('title'))).toBe(true);

		// Check that the next 3 calls are all "summary" calls
		const summaryCalls = callLog.slice(3, 6);
		expect(summaryCalls.every((c) => c.includes('summary'))).toBe(true);

		// Verify the correct order within each batch (Alpha, Beta, Gamma)
		expect(titleCalls[0]).toContain('Alpha');
		expect(titleCalls[1]).toContain('Beta');
		expect(titleCalls[2]).toContain('Gamma');
		expect(summaryCalls[0]).toContain('Alpha');
		expect(summaryCalls[1]).toContain('Beta');
		expect(summaryCalls[2]).toContain('Gamma');

		console.log(`✅ Multiple LLM calls per callback with batch_reconstruct works correctly`);
	}, 180000);

	test('should handle errors in atp.llm.call()', async () => {
		client.provideLLM({
			call: async (prompt: string) => {
				if (prompt.includes('fail')) {
					throw new Error('LLM error: intentional failure');
				}
				return 'success';
			},
		});

		const code = `
const result = await atp.llm.call({ prompt: 'fail please' });
// ATP wraps errors in { __error: true, message: '...' }
if (result && typeof result === 'object' && result.__error) {
  return { failed: true, message: result.message };
}
return { failed: false, result };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('failed', true);
		expect(result.result).toHaveProperty('message');
		expect((result.result as any).message).toContain('LLM error');
	});
});
