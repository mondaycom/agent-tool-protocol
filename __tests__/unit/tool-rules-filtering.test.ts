/**
 * Test to verify toolRules.allowOnlyApiGroups filtering works correctly.
 */

import { createServer, type AgentToolProtocolServer } from '../../packages/server/src/index';
import { AgentToolProtocolClient } from '../../packages/client/src/index';
import { runInRequestScope } from '../../packages/server/src/core/request-scope';

describe('toolRules.allowOnlyApiGroups filtering', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;

	beforeAll(async () => {
		server = createServer();

		// Register "math" API group
		server.use({
			name: 'math',
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
					handler: async (input: unknown) => {
						const { a, b } = input as { a: number; b: number };
						return { result: a + b };
					},
				},
			],
		});

		// Register "text" API group
		server.use({
			name: 'text',
			type: 'custom',
			functions: [
				{
					name: 'uppercase',
					description: 'Convert text to uppercase',
					inputSchema: {
						type: 'object',
						properties: {
							text: { type: 'string' },
						},
						required: ['text'],
					},
					handler: async (input: unknown) => {
						const { text } = input as { text: string };
						return { result: text.toUpperCase() };
					},
				},
			],
		});

		await server.start();

		client = new AgentToolProtocolClient({
			server: server as any,
		});

		await client.init({ name: 'test-client', version: '1.0.0' });
		await client.connect();
	});

	afterAll(async () => {
		// Cleanup if needed
	});

	it('should allow math API when toolRules.allowOnlyApiGroups includes math', async () => {
		const result = await client.execute('return await api.math.add({ a: 2, b: 3 });', {
			toolRules: {
				allowOnlyApiGroups: ['math'],
			},
		});

		expect(result.status).toBe('completed');
		expect((result.result as any)?.result).toBe(5);
	});

	it('should block text API when toolRules.allowOnlyApiGroups only includes math', async () => {
		const result = await client.execute('return await api.text.uppercase({ text: "hello" });', {
			toolRules: {
				allowOnlyApiGroups: ['math'],
			},
		});

		// When text API is blocked, the code should fail because api.text is undefined
		expect(result.status).toBe('failed');
	});

	it('should allow both APIs when no toolRules are specified', async () => {
		const mathResult = await client.execute('return await api.math.add({ a: 1, b: 2 });');
		expect(mathResult.status).toBe('completed');
		expect((mathResult.result as any)?.result).toBe(3);

		const textResult = await client.execute('return await api.text.uppercase({ text: "hello" });');
		expect(textResult.status).toBe('completed');
		expect((textResult.result as any)?.result).toBe('HELLO');
	});

	it('should allow text API when toolRules.allowOnlyApiGroups includes text', async () => {
		const result = await client.execute('return await api.text.uppercase({ text: "world" });', {
			toolRules: {
				allowOnlyApiGroups: ['text'],
			},
		});

		expect(result.status).toBe('completed');
		expect((result.result as any)?.result).toBe('WORLD');
	});

	it('should block math API when toolRules.allowOnlyApiGroups only includes text', async () => {
		const result = await client.execute('return await api.math.add({ a: 5, b: 5 });', {
			toolRules: {
				allowOnlyApiGroups: ['text'],
			},
		});

		expect(result.status).toBe('failed');
	});

	describe('explore_api filtering', () => {
		it('should show all API groups at root when no toolRules', async () => {
			const result = await client.exploreAPI('/');

			// Should see 'custom' directory at root
			expect(result).toHaveProperty('items');
			expect(Array.isArray((result as any).items)).toBe(true);
		});

		it('should show both math and text when exploring /custom without toolRules', async () => {
			const result = await client.exploreAPI('/custom');

			const items = (result as any).items || [];
			const itemNames = items.map((i: any) => i.name);

			// Both APIs should be visible without filtering
			expect(itemNames).toContain('math');
			expect(itemNames).toContain('text');
		});

		it('should filter explore results when runInRequestScope is used with toolRules', async () => {
			// Test that the filtering mechanism works when request scope is set
			const result = await runInRequestScope(
				{ toolRules: { allowOnlyApiGroups: ['math'] } },
				async () => {
					return await client.exploreAPI('/custom');
				}
			);

			const items = (result as any).items || [];
			const itemNames = items.map((i: any) => i.name);

			// Only math should be visible when toolRules filters to math only
			expect(itemNames).toContain('math');
			expect(itemNames).not.toContain('text');
		});

		it('should filter explore results when toolRules passed directly to exploreAPI', async () => {
			const result = await client.exploreAPI('/custom', {
				toolRules: { allowOnlyApiGroups: ['math'] },
			});

			const items = (result as any).items || [];
			const itemNames = items.map((i: any) => i.name);

			// Only math should be visible when toolRules filters to math only
			expect(itemNames).toContain('math');
			expect(itemNames).not.toContain('text');
		});
	});

	describe('search_api filtering', () => {
		it('should return results from all APIs when no options', async () => {
			const results = await client.searchAPI('add');

			expect(Array.isArray(results)).toBe(true);
			expect(results.length).toBeGreaterThan(0);
		});

		it('should find text API uppercase when no options', async () => {
			const results = await client.searchAPI('uppercase');

			expect(results.length).toBeGreaterThan(0);
			expect(results.some((r) => r.functionName === 'uppercase')).toBe(true);
		});

		it('should only return math results when apiGroups filter includes only math', async () => {
			// searchAPI accepts apiGroups option for filtering
			const results = await client.searchAPI('uppercase', {
				query: 'uppercase',
				apiGroups: ['math'],
			});

			// When filtering by apiGroups, searching for "uppercase" with math-only filter
			// should return no results because uppercase belongs to text API
			expect(results.length).toBe(0);
		});

		it('should filter search results when toolRules passed directly to searchAPI', async () => {
			// searchAPI with toolRules.allowOnlyApiGroups
			const results = await client.searchAPI('uppercase', {
				query: 'uppercase',
				toolRules: { allowOnlyApiGroups: ['math'] },
			});

			// When filtering by toolRules, searching for "uppercase" with math-only filter
			// should return no results because uppercase belongs to text API
			expect(results.length).toBe(0);
		});
	});
});
