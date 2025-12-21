/**
 * Comprehensive Tool Rules Filtering Integration Test
 *
 * This test validates that toolRules.allowOnlyApiGroups filtering works correctly
 * for all three ATP tools with a real in-process server:
 * 1. execute_code - Code execution should only access allowed API groups
 * 2. explore_api - API exploration should only show allowed API groups
 * 3. search_api - API search should only return results from allowed API groups
 */

import { createServer, type AgentToolProtocolServer } from '../../packages/server/src/index';
import { AgentToolProtocolClient } from '../../packages/client/src/index';

describe('Tool Rules Comprehensive Integration Test', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;

	beforeAll(async () => {
		// Create server with two API groups
		server = createServer();

		// Register "math" API group with multiple functions
		server.use({
			name: 'math',
			type: 'custom',
			functions: [
				{
					name: 'add',
					description: 'Add two numbers together',
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
				{
					name: 'multiply',
					description: 'Multiply two numbers together',
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
						return { result: a * b };
					},
				},
			],
		});

		// Register "text" API group with multiple functions
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
				{
					name: 'lowercase',
					description: 'Convert text to lowercase',
					inputSchema: {
						type: 'object',
						properties: {
							text: { type: 'string' },
						},
						required: ['text'],
					},
					handler: async (input: unknown) => {
						const { text } = input as { text: string };
						return { result: text.toLowerCase() };
					},
				},
			],
		});

		await server.start();

		// Create in-process client
		client = new AgentToolProtocolClient({ server: server as any });
		await client.init({ name: 'tool-rules-integration-test', version: '1.0.0' });
		await client.connect();
	});

	afterAll(async () => {
		// Cleanup
	});

	describe('execute_code filtering', () => {
		describe('baseline without toolRules', () => {
			it('allows math.add without toolRules', async () => {
				const result = await client.execute('return await api.math.add({ a: 2, b: 3 });');
				expect(result.status).toBe('completed');
				expect((result.result as any)?.result).toBe(5);
			});

			it('allows math.multiply without toolRules', async () => {
				const result = await client.execute('return await api.math.multiply({ a: 4, b: 5 });');
				expect(result.status).toBe('completed');
				expect((result.result as any)?.result).toBe(20);
			});

			it('allows text.uppercase without toolRules', async () => {
				const result = await client.execute(
					'return await api.text.uppercase({ text: "hello" });'
				);
				expect(result.status).toBe('completed');
				expect((result.result as any)?.result).toBe('HELLO');
			});

			it('allows text.lowercase without toolRules', async () => {
				const result = await client.execute(
					'return await api.text.lowercase({ text: "WORLD" });'
				);
				expect(result.status).toBe('completed');
				expect((result.result as any)?.result).toBe('world');
			});
		});

		describe('with toolRules filtering to math only', () => {
			it('allows math.add when toolRules allows math', async () => {
				const result = await client.execute('return await api.math.add({ a: 10, b: 20 });', {
					toolRules: { allowOnlyApiGroups: ['math'] },
				});
				expect(result.status).toBe('completed');
				expect((result.result as any)?.result).toBe(30);
			});

			it('allows math.multiply when toolRules allows math', async () => {
				const result = await client.execute('return await api.math.multiply({ a: 6, b: 7 });', {
					toolRules: { allowOnlyApiGroups: ['math'] },
				});
				expect(result.status).toBe('completed');
				expect((result.result as any)?.result).toBe(42);
			});

			it('BLOCKS text.uppercase when toolRules only allows math', async () => {
				const result = await client.execute(
					'return await api.text.uppercase({ text: "blocked" });',
					{
						toolRules: { allowOnlyApiGroups: ['math'] },
					}
				);
				expect(result.status).toBe('failed');
			});

			it('BLOCKS text.lowercase when toolRules only allows math', async () => {
				const result = await client.execute(
					'return await api.text.lowercase({ text: "BLOCKED" });',
					{
						toolRules: { allowOnlyApiGroups: ['math'] },
					}
				);
				expect(result.status).toBe('failed');
			});
		});

		describe('with toolRules filtering to text only', () => {
			it('allows text.uppercase when toolRules allows text', async () => {
				const result = await client.execute(
					'return await api.text.uppercase({ text: "allowed" });',
					{
						toolRules: { allowOnlyApiGroups: ['text'] },
					}
				);
				expect(result.status).toBe('completed');
				expect((result.result as any)?.result).toBe('ALLOWED');
			});

			it('allows text.lowercase when toolRules allows text', async () => {
				const result = await client.execute(
					'return await api.text.lowercase({ text: "ALLOWED" });',
					{
						toolRules: { allowOnlyApiGroups: ['text'] },
					}
				);
				expect(result.status).toBe('completed');
				expect((result.result as any)?.result).toBe('allowed');
			});

			it('BLOCKS math.add when toolRules only allows text', async () => {
				const result = await client.execute('return await api.math.add({ a: 5, b: 5 });', {
					toolRules: { allowOnlyApiGroups: ['text'] },
				});
				expect(result.status).toBe('failed');
			});

			it('BLOCKS math.multiply when toolRules only allows text', async () => {
				const result = await client.execute('return await api.math.multiply({ a: 3, b: 3 });', {
					toolRules: { allowOnlyApiGroups: ['text'] },
				});
				expect(result.status).toBe('failed');
			});
		});
	});

	describe('explore_api filtering', () => {
		it('shows both math and text without toolRules', async () => {
			const result = await client.exploreAPI('/custom');
			const items = (result as any).items?.map((i: any) => i.name) || [];
			expect(items).toContain('math');
			expect(items).toContain('text');
		});

		it('shows ONLY math when toolRules allows math', async () => {
			const result = await client.exploreAPI('/custom', {
				toolRules: { allowOnlyApiGroups: ['math'] },
			});
			const items = (result as any).items?.map((i: any) => i.name) || [];
			expect(items).toContain('math');
			expect(items).not.toContain('text');
		});

		it('shows ONLY text when toolRules allows text', async () => {
			const result = await client.exploreAPI('/custom', {
				toolRules: { allowOnlyApiGroups: ['text'] },
			});
			const items = (result as any).items?.map((i: any) => i.name) || [];
			expect(items).toContain('text');
			expect(items).not.toContain('math');
		});

		it('shows math functions when exploring /custom/math with math filter', async () => {
			const result = await client.exploreAPI('/custom/math', {
				toolRules: { allowOnlyApiGroups: ['math'] },
			});
			const items = (result as any).items?.map((i: any) => i.name) || [];
			expect(items).toContain('add');
			expect(items).toContain('multiply');
		});

		it('shows text functions when exploring /custom/text with text filter', async () => {
			const result = await client.exploreAPI('/custom/text', {
				toolRules: { allowOnlyApiGroups: ['text'] },
			});
			const items = (result as any).items?.map((i: any) => i.name) || [];
			expect(items).toContain('uppercase');
			expect(items).toContain('lowercase');
		});
	});

	describe('search_api filtering', () => {
		it('finds math.add without toolRules', async () => {
			const results = await client.searchAPI('add');
			expect(results.length).toBeGreaterThan(0);
			expect(results.some((r) => r.functionName === 'add')).toBe(true);
		});

		it('finds text.uppercase without toolRules', async () => {
			const results = await client.searchAPI('uppercase');
			expect(results.length).toBeGreaterThan(0);
			expect(results.some((r) => r.functionName === 'uppercase')).toBe(true);
		});

		it('finds math.add when toolRules allows math', async () => {
			const results = await client.searchAPI('add', {
				query: 'add',
				toolRules: { allowOnlyApiGroups: ['math'] },
			});
			expect(results.length).toBeGreaterThan(0);
			expect(results.some((r) => r.functionName === 'add')).toBe(true);
		});

		it('does NOT find text.uppercase when toolRules only allows math', async () => {
			const results = await client.searchAPI('uppercase', {
				query: 'uppercase',
				toolRules: { allowOnlyApiGroups: ['math'] },
			});
			expect(results.length).toBe(0);
		});

		it('finds text.lowercase when toolRules allows text', async () => {
			const results = await client.searchAPI('lowercase', {
				query: 'lowercase',
				toolRules: { allowOnlyApiGroups: ['text'] },
			});
			expect(results.length).toBeGreaterThan(0);
			expect(results.some((r) => r.functionName === 'lowercase')).toBe(true);
		});

		it('does NOT find math.multiply when toolRules only allows text', async () => {
			const results = await client.searchAPI('multiply', {
				query: 'multiply',
				toolRules: { allowOnlyApiGroups: ['text'] },
			});
			expect(results.length).toBe(0);
		});
	});
});

