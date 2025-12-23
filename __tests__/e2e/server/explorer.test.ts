import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { initializeCache, initializeLogger } from '@mondaydotcomorg/atp-runtime';

describe('ATP Server Explorer - Filesystem-like API navigation', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;
	const TEST_PORT = 3339;

	beforeAll(async () => {
		// Set JWT secret for testing
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-explorer-tests-' + Date.now();

		// Initialize runtime
		initializeLogger({ level: 'error', pretty: false });
		initializeCache({ type: 'memory', maxKeys: 1000, defaultTTL: 600 });

		// Create server with multiple API groups
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 5,
			},
		});

		// Add OpenAPI-style group
		server.use({
			name: 'github',
			type: 'openapi',
			functions: [
				{
					name: 'getUser',
					description: 'Get a GitHub user by username',
					inputSchema: {
						type: 'object',
						properties: {
							username: { type: 'string' },
						},
						required: ['username'],
					},
					handler: async (input: any) => ({ username: input.username, id: 123 }),
				},
				{
					name: 'listRepos',
					description: 'List repositories for a user',
					inputSchema: {
						type: 'object',
						properties: {
							username: { type: 'string' },
						},
						required: ['username'],
					},
					handler: async (input: any) => ({ repos: [] }),
				},
				{
					name: 'createRepo',
					description: 'Create a new repository',
					inputSchema: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							private: { type: 'boolean' },
						},
						required: ['name'],
					},
					handler: async (input: any) => ({ id: 1, name: input.name }),
				},
			],
		});

		// Add MCP-style group
		server.use({
			name: 'filesystem',
			type: 'mcp',
			functions: [
				{
					name: 'read_file',
					description: 'Read a file from disk',
					inputSchema: {
						type: 'object',
						properties: {
							path: { type: 'string' },
						},
						required: ['path'],
					},
					handler: async (input: any) => ({ content: 'file content' }),
				},
				{
					name: 'write_file',
					description: 'Write a file to disk',
					inputSchema: {
						type: 'object',
						properties: {
							path: { type: 'string' },
							content: { type: 'string' },
						},
						required: ['path', 'content'],
					},
					handler: async (input: any) => ({ success: true }),
				},
			],
		});

		// Add custom API group
		server.use({
			name: 'utilities',
			type: 'custom',
			functions: [
				{
					name: 'formatDate',
					description: 'Format a date string',
					inputSchema: {
						type: 'object',
						properties: {
							date: { type: 'string' },
							format: { type: 'string' },
						},
						required: ['date'],
					},
					handler: async (input: any) => ({ formatted: '2024-01-01' }),
				},
			],
		});

		// Start server
		await server.listen(TEST_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));

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

	describe('Root directory exploration', () => {
		test('should list top-level API types', async () => {
			const result = await client.exploreAPI('/');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				expect(result.path).toBe('/');
				expect(result.items).toEqual(
					expect.arrayContaining([
						{ name: 'openapi', type: 'directory' },
						{ name: 'mcp', type: 'directory' },
						{ name: 'custom', type: 'directory' },
					])
				);
			}
		});

		test('should handle root path without slash', async () => {
			const result = await client.exploreAPI('');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				expect(result.path).toBe('/');
			}
		});
	});

	describe('OpenAPI group exploration', () => {
		test('should list OpenAPI groups', async () => {
			const result = await client.exploreAPI('/openapi');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				expect(result.path).toBe('/openapi');
				expect(result.items).toContainEqual({ name: 'github', type: 'directory' });
			}
		});

		test('should list functions in OpenAPI group', async () => {
			const result = await client.exploreAPI('/openapi/github');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				expect(result.path).toBe('/openapi/github');
				expect(result.items.length).toBeGreaterThan(0);
				const functionNames = result.items.map((item) => item.name);
				expect(functionNames).toContain('getUser');
				expect(functionNames).toContain('listRepos');
				expect(functionNames).toContain('createRepo');
			}
		});

		test('should return function definition', async () => {
			const result = await client.exploreAPI('/openapi/github/getUser');

			expect(result.type).toBe('function');
			if (result.type === 'function') {
				expect(result.name).toBe('getUser');
				expect(result.description).toBe('Get a GitHub user by username');
				expect(result.definition).toContain('getUser');
				expect(result.definition).toContain('username');
				expect(result.definition).toContain('string');
				expect(result.group).toBe('github');
			}
		});
	});

	describe('MCP group exploration', () => {
		test('should list MCP groups', async () => {
			const result = await client.exploreAPI('/mcp');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				expect(result.items).toContainEqual({ name: 'filesystem', type: 'directory' });
			}
		});

		test('should list MCP functions', async () => {
			const result = await client.exploreAPI('/mcp/filesystem');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				const functionNames = result.items.map((item) => item.name);
				expect(functionNames).toContain('read_file');
				expect(functionNames).toContain('write_file');
			}
		});

		test('should return MCP function definition', async () => {
			const result = await client.exploreAPI('/mcp/filesystem/read_file');

			expect(result.type).toBe('function');
			if (result.type === 'function') {
				expect(result.name).toBe('read_file');
				expect(result.description).toBe('Read a file from disk');
				expect(result.definition).toContain('read_file');
				expect(result.definition).toContain('path');
			}
		});
	});

	describe('Custom API exploration', () => {
		test('should list custom API groups', async () => {
			const result = await client.exploreAPI('/custom');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				expect(result.items).toContainEqual({ name: 'utilities', type: 'directory' });
			}
		});

		test('should list custom functions', async () => {
			const result = await client.exploreAPI('/custom/utilities');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				const functionNames = result.items.map((item) => item.name);
				expect(functionNames).toContain('formatDate');
			}
		});

		test('should return custom function definition', async () => {
			const result = await client.exploreAPI('/custom/utilities/formatDate');

			expect(result.type).toBe('function');
			if (result.type === 'function') {
				expect(result.name).toBe('formatDate');
				expect(result.description).toBe('Format a date string');
				expect(result.definition).toContain('formatDate');
			}
		});
	});

	describe('Error handling', () => {
		test('should handle non-existent paths', async () => {
			await expect(client.exploreAPI('/nonexistent')).rejects.toThrow();
		});

		test('should handle invalid nested paths', async () => {
			await expect(client.exploreAPI('/openapi/nonexistent/path')).rejects.toThrow();
		});
	});

	describe('Client tool integration', () => {
		test('should create explore_api tool', () => {
			const tools = require('@mondaydotcomorg/atp-client').createToolsFromATPClient(client);
			const exploreApiTool = tools.find((t: any) => t.name === 'explore_api');

			expect(exploreApiTool).toBeDefined();
			expect(exploreApiTool.description).toContain('filesystem');
			expect(exploreApiTool.inputSchema).toBeDefined();
		});

		test('explore_api tool should work correctly', async () => {
			const tools = require('@mondaydotcomorg/atp-client').createToolsFromATPClient(client);
			const exploreApiTool = tools.find((t: any) => t.name === 'explore_api');

			const result = await exploreApiTool.func({ paths: '/' });
			const parsed = JSON.parse(result);

			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed[0].success).toBe(true);
			expect(parsed[0].type).toBe('directory');
			expect(parsed[0].items).toBeDefined();
		});

		test('explore_api tool should handle errors gracefully', async () => {
			const tools = require('@mondaydotcomorg/atp-client').createToolsFromATPClient(client);
			const exploreApiTool = tools.find((t: any) => t.name === 'explore_api');

			const result = await exploreApiTool.func({ paths: '/invalid/path' });
			const parsed = JSON.parse(result);

			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed[0].success).toBe(false);
			expect(parsed[0].error).toBeDefined();
		});
	});

	describe('Directory ordering', () => {
		test('should sort items with directories first, then alphabetically', async () => {
			const result = await client.exploreAPI('/openapi/github');

			expect(result.type).toBe('directory');
			if (result.type === 'directory') {
				// Check that if there are directories, they come before functions
				const firstDirectory = result.items.findIndex((item) => item.type === 'directory');
				const firstFunction = result.items.findIndex((item) => item.type === 'function');

				if (firstDirectory !== -1 && firstFunction !== -1) {
					expect(firstDirectory).toBeLessThan(firstFunction);
				}

				// Check alphabetical ordering within same type
				const functions = result.items.filter((item) => item.type === 'function');
				const functionNames = functions.map((item) => item.name);
				const sortedNames = [...functionNames].sort();
				expect(functionNames).toEqual(sortedNames);
			}
		});
	});

	describe('HTTP endpoint', () => {
		test('POST /api/explore should work directly', async () => {
			const response = await fetch(`http://localhost:${TEST_PORT}/api/explore`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ path: '/' }),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.type).toBe('directory');
			expect(data.items).toBeDefined();
		});

		test('should return 404 for invalid paths', async () => {
			const response = await fetch(`http://localhost:${TEST_PORT}/api/explore`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ path: '/invalid' }),
			});

			expect(response.status).toBe(404);
		});
	});
});
