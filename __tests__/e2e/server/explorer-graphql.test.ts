import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { initializeCache, initializeLogger } from '@mondaydotcomorg/atp-runtime';

describe('ATP Server Explorer - GraphQL path structure', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;
	const TEST_PORT = 3340;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-graphql-explorer-' + Date.now();

		initializeLogger({ level: 'error', pretty: false });
		initializeCache({ type: 'memory', maxKeys: 1000, defaultTTL: 600 });

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 5,
			},
		});

		// Add GraphQL group mimicking Monday.com structure
		server.use({
			name: 'monday',
			type: 'graphql',
			functions: [
				{
					name: 'query_me',
					description: 'Get current user information',
					inputSchema: {
						type: 'object',
						properties: {
							fields: { type: 'string' },
						},
					},
					handler: async () => ({ id: 123, name: 'Test User' }),
				},
				{
					name: 'query_users',
					description: 'Get users in workspace',
					inputSchema: {
						type: 'object',
						properties: {
							limit: { type: 'number' },
						},
					},
					handler: async () => ({ users: [] }),
				},
				{
					name: 'mutation_create_item',
					description: 'Create a new item',
					inputSchema: {
						type: 'object',
						properties: {
							board_id: { type: 'string' },
							item_name: { type: 'string' },
						},
						required: ['board_id', 'item_name'],
					},
					handler: async () => ({ id: 456 }),
				},
			],
		});

		await server.listen(TEST_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));

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

	describe('GraphQL flat path structure', () => {
		test('should list monday group with flat function names', async () => {
			const result = await client.exploreAPI('/monday');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				const functionNames = result.items.map((item) => item.name);
				// Functions should be flat with underscores, not nested
				expect(functionNames).toContain('query_me');
				expect(functionNames).toContain('query_users');
				expect(functionNames).toContain('mutation_create_item');
				// Should NOT have nested directories like 'query' or 'mutation'
				expect(functionNames).not.toContain('query');
				expect(functionNames).not.toContain('mutation');
			}
		});

		test('should access query_me with flat path', async () => {
			const result = await client.exploreAPI('/monday/query_me');

			expect(result.type).toBe('function');
			if (result.type === 'function') {
				expect(result.name).toBe('query_me');
				expect(result.path).toBe('/monday/query_me');
				expect(result.usage).toBe('api.monday.query_me({})');
			}
		});

		test('should access mutation_create_item with flat path', async () => {
			const result = await client.exploreAPI('/monday/mutation_create_item');

			expect(result.type).toBe('function');
			if (result.type === 'function') {
				expect(result.name).toBe('mutation_create_item');
				expect(result.path).toBe('/monday/mutation_create_item');
				expect(result.usage).toBe("api.monday.mutation_create_item({ board_id: '...', item_name: '...' })");
			}
		});

		test('should NOT have nested query/mutation directories', async () => {
			// These paths should no longer exist
			await expect(client.exploreAPI('/monday/query')).rejects.toThrow();
			await expect(client.exploreAPI('/monday/mutation')).rejects.toThrow();
		});

		test('path and usage should match', async () => {
			const result = await client.exploreAPI('/monday/query_users');

			expect(result.type).toBe('function');
			if (result.type === 'function') {
				// Path should match the function name
				expect(result.path).toBe('/monday/query_users');
				// Usage should show the same name
				expect(result.usage).toBe('api.monday.query_users({})');
				// Both should use underscores, not slashes
				expect(result.name).toBe('query_users');
			}
		});
	});
});

