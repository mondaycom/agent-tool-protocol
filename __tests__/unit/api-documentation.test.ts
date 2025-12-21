/**
 * API Documentation Feature Test
 *
 * Validates the documentation feature for explore_api:
 * 1. Documentation is attached to API groups and shown when exploring
 * 2. Documentation includes examples, rules, and tips
 * 3. Token-efficient (only loaded when needed)
 * 4. Tool rules filtering works with documentation
 */

import { describe, test, expect, beforeAll } from '@jest/globals';
import { AgentToolProtocolServer, createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import type { APIGroupDocumentation, ExploreResult } from '@mondaydotcomorg/atp-protocol';
import { initializeCache, initializeLogger } from '@mondaydotcomorg/atp-runtime';

const TEST_DOCS: Record<string, APIGroupDocumentation> = {
	monday: {
		explorePaths: ['/monday', '/monday/query', '/monday/mutation'],
		examples: `### Find Board by Name
const pages = await Promise.all(
  Array.from({ length: 10 }, (_, i) => 
    api.monday.query_boards({ limit: 100, page: i + 1, _fields: 'id,name' })
  )
);
const board = pages.flat().find(b => b.name?.includes('Target'));`,
		rules: `## Monday.com Rules
1. ALWAYS use _fields parameter - never fetch entire objects
2. ColumnValue has: id, type, text, value (NOT "title"!)
3. items_page returns only ~25 items - use pagination!
4. Get board.columns first to find column IDs`,
		tips: `### Performance Tips
- Use Promise.all for page-based pagination
- Cursor-based pagination must be sequential`,
	},
	github: {
		explorePaths: ['/openapi/github'],
		examples: `### List user repos
const repos = await api.github.listRepos({ username: 'octocat' });
return repos.filter(r => r.stars > 100);`,
		rules: `## GitHub Rules
1. Rate limits: 5000 req/hour authenticated
2. Use pagination for large result sets`,
		tips: `### Tips
- Batch requests when possible`,
	},
	slack: {
		explorePaths: ['/openapi/slack', '/openapi/slack/conversations'],
		examples: `### Find channel
const result = await api.slack.conversations_list({ types: 'public_channel', limit: 1000 });
return result.channels?.find(c => c.name === 'general');`,
		rules: `## Slack Rules
1. Always check result.ok before using data
2. Use limit: 1000 for faster pagination`,
	},
};

describe('API Documentation Feature', () => {
	let server: ReturnType<typeof createServer>;
	let client: AgentToolProtocolClient;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-for-docs-' + Date.now();
		initializeLogger({ level: 'error', pretty: false });
		initializeCache({ type: 'memory', maxKeys: 1000, defaultTTL: 600 });

		server = createServer();

		server.use({
			name: 'monday',
			type: 'graphql',
			description: 'Monday.com project management API',
			documentation: TEST_DOCS.monday,
			functions: [
				{
					name: 'query_boards',
					description: 'Query boards from Monday.com',
					inputSchema: {
						type: 'object',
						properties: {
							ids: { type: 'array', items: { type: 'string' } },
							limit: { type: 'number' },
							page: { type: 'number' },
							_fields: { type: 'string' },
						},
					},
					handler: async () => [{ id: '123', name: 'Test Board' }],
				},
				{
					name: 'mutation_create_item',
					description: 'Create an item on a board',
					inputSchema: {
						type: 'object',
						properties: {
							board_id: { type: 'string' },
							item_name: { type: 'string' },
						},
						required: ['board_id', 'item_name'],
					},
					handler: async () => ({ id: '456', name: 'New Item' }),
				},
			],
		});

		server.use({
			name: 'github',
			type: 'openapi',
			description: 'GitHub REST API',
			documentation: TEST_DOCS.github,
			functions: [
				{
					name: 'getUser',
					description: 'Get a GitHub user by username',
					inputSchema: {
						type: 'object',
						properties: { username: { type: 'string' } },
						required: ['username'],
					},
					handler: async () => ({ id: 1, login: 'octocat' }),
				},
				{
					name: 'listRepos',
					description: 'List repositories for a user',
					inputSchema: {
						type: 'object',
						properties: { username: { type: 'string' } },
						required: ['username'],
					},
					handler: async () => [{ id: 1, name: 'hello-world' }],
				},
			],
		});

		server.use({
			name: 'slack',
			type: 'openapi',
			description: 'Slack Web API',
			documentation: TEST_DOCS.slack,
			functions: [
				{
					name: 'conversations_list',
					description: 'List conversations (channels)',
					inputSchema: {
						type: 'object',
						properties: {
							types: { type: 'string' },
							limit: { type: 'number' },
							cursor: { type: 'string' },
						},
					},
					handler: async () => ({ ok: true, channels: [] }),
				},
			],
		});

		server.use({
			name: 'nodocs',
			type: 'custom',
			description: 'API without documentation',
			functions: [
				{
					name: 'doSomething',
					description: 'Do something',
					inputSchema: { type: 'object', properties: {} },
					handler: async () => ({ done: true }),
				},
			],
		});

		client = new AgentToolProtocolClient({ server });
		await client.init({ name: 'doc-test', version: '1.0.0' });
	});

	describe('Root Exploration', () => {
		test('should return directory with items', async () => {
			const root = await client.exploreAPI('/');
			expect(root.type).toBe('directory');
			if (root.type === 'directory') {
				expect(root.items.length).toBeGreaterThan(0);
			}
		});

		test('should not have documentation at root', async () => {
			const root = (await client.exploreAPI('/')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(root.documentation).toBeUndefined();
		});
	});

	describe('GraphQL API Documentation (Monday)', () => {
		test('should return documentation when exploring /monday', async () => {
			const monday = (await client.exploreAPI('/monday')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(monday.type).toBe('directory');
			expect(monday.documentation).toBeDefined();
		});

		test('documentation should have examples', async () => {
			const monday = (await client.exploreAPI('/monday')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(monday.documentation?.examples).toBeDefined();
			expect(monday.documentation?.examples?.length).toBeGreaterThan(50);
			expect(monday.documentation?.examples).toContain('query_boards');
		});

		test('documentation should have rules', async () => {
			const monday = (await client.exploreAPI('/monday')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(monday.documentation?.rules).toBeDefined();
			expect(monday.documentation?.rules).toContain('_fields');
		});

		test('documentation should have tips', async () => {
			const monday = (await client.exploreAPI('/monday')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(monday.documentation?.tips).toBeDefined();
			expect(monday.documentation?.tips).toContain('Promise.all');
		});

		test('documentation should have explore paths', async () => {
			const monday = (await client.exploreAPI('/monday')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(monday.documentation?.explorePaths).toBeDefined();
			expect(monday.documentation?.explorePaths).toContain('/monday/query');
		});
	});

	describe('OpenAPI API Documentation (GitHub)', () => {
		test('should return documentation when exploring /openapi/github', async () => {
			const github = (await client.exploreAPI('/openapi/github')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(github.type).toBe('directory');
			expect(github.documentation).toBeDefined();
		});

		test('documentation should have examples', async () => {
			const github = (await client.exploreAPI('/openapi/github')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(github.documentation?.examples).toBeDefined();
			expect(github.documentation?.examples).toContain('listRepos');
		});

		test('documentation should have rules mentioning rate limits', async () => {
			const github = (await client.exploreAPI('/openapi/github')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(github.documentation?.rules).toContain('Rate');
		});
	});

	describe('Subdirectory Documentation Behavior', () => {
		test('subdirectory /monday/query should NOT have documentation', async () => {
			const mondayQuery = (await client.exploreAPI('/monday/query')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(mondayQuery.type).toBe('directory');
			expect(mondayQuery.documentation).toBeUndefined();
		});

		test('subdirectory should still be navigable', async () => {
			const mondayQuery = await client.exploreAPI('/monday/query');
			expect(mondayQuery.type).toBe('directory');
			if (mondayQuery.type === 'directory') {
				expect(mondayQuery.items.length).toBeGreaterThan(0);
				// GraphQL functions starting with query_ are placed under /query subdirectory
				// with the query_ prefix stripped in the tree
				expect(mondayQuery.items.some((i) => i.name === 'boards')).toBe(true);
			}
		});
	});

	describe('API Without Documentation', () => {
		test('should not have documentation field', async () => {
			const nodocs = (await client.exploreAPI('/custom/nodocs')) as ExploreResult & {
				documentation?: APIGroupDocumentation;
			};
			expect(nodocs.documentation).toBeUndefined();
		});
	});

	describe('Tool Rules Filtering with Documentation', () => {
		test('filtered explore should only show allowed APIs', async () => {
			const filteredClient = new AgentToolProtocolClient({ server });
			await filteredClient.init({ name: 'filtered-test', version: '1.0.0' });

			const mondayOnly = await filteredClient.exploreAPI('/', {
				toolRules: { allowOnlyApiGroups: ['monday'] },
			});

			expect(mondayOnly.type).toBe('directory');
			if (mondayOnly.type === 'directory') {
				expect(mondayOnly.items.some((i) => i.name === 'monday')).toBe(true);
				expect(mondayOnly.items.some((i) => i.name === 'openapi')).toBe(false);
				expect(mondayOnly.items.some((i) => i.name === 'custom')).toBe(false);
			}
		});

		test('filtered API should still have documentation', async () => {
			const filteredClient = new AgentToolProtocolClient({ server });
			await filteredClient.init({ name: 'filtered-test', version: '1.0.0' });

			const mondayFiltered = (await filteredClient.exploreAPI('/monday', {
				toolRules: { allowOnlyApiGroups: ['monday'] },
			})) as ExploreResult & { documentation?: APIGroupDocumentation };

			expect(mondayFiltered.documentation).toBeDefined();
			expect(mondayFiltered.documentation?.examples).toBeDefined();
		});
	});

	describe('Token Efficiency', () => {
		test('root response should be under 500 tokens', async () => {
			const root = await client.exploreAPI('/');
			const rootJson = JSON.stringify(root);
			const rootTokenEstimate = Math.ceil(rootJson.length / 4);
			expect(rootTokenEstimate).toBeLessThan(500);
		});

		test('API with documentation should be under 2000 tokens', async () => {
			const monday = await client.exploreAPI('/monday');
			const mondayJson = JSON.stringify(monday);
			const mondayTokenEstimate = Math.ceil(mondayJson.length / 4);
			expect(mondayTokenEstimate).toBeLessThan(2000);
		});
	});

	describe('Function Exploration', () => {
		test('should return function type for function paths', async () => {
			// GraphQL functions under /query have the query_ prefix stripped
			// so query_boards becomes /monday/query/boards
			const func = await client.exploreAPI('/monday/query/boards');
			expect(func.type).toBe('function');
		});

		test('function should have definition and schema', async () => {
			const func = await client.exploreAPI('/monday/query/boards');
			expect(func.type).toBe('function');
			if (func.type === 'function') {
				expect(func.definition).toContain('query_boards');
				expect((func as { inputSchema?: unknown }).inputSchema).toBeDefined();
			}
		});
	});
});
