import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { exploreApiInputSchema, createExploreApiTool } from '@mondaydotcomorg/atp-client';

describe('Explore API Tool', () => {
	let mockClient: any;

	beforeEach(() => {
		mockClient = {
			exploreAPI: jest.fn(),
		};
	});

	describe('Input Schema', () => {
		test('should accept a single string path', () => {
			const result = exploreApiInputSchema.safeParse({ paths: '/' });
			expect(result.success).toBe(true);
		});

		test('should accept an array of paths', () => {
			const result = exploreApiInputSchema.safeParse({
				paths: ['/openapi/github', '/mcp/filesystem'],
			});
			expect(result.success).toBe(true);
		});

		test('should accept array with single path', () => {
			const result = exploreApiInputSchema.safeParse({ paths: ['/'] });
			expect(result.success).toBe(true);
		});

		test('should reject empty array', () => {
			const result = exploreApiInputSchema.safeParse({ paths: [] });
			expect(result.success).toBe(false);
		});

		test('should reject missing paths', () => {
			const result = exploreApiInputSchema.safeParse({});
			expect(result.success).toBe(false);
		});
	});

	describe('Single Path Exploration', () => {
		test('should explore a directory path', async () => {
			mockClient.exploreAPI.mockResolvedValue({
				type: 'directory',
				path: '/',
				items: [
					{ name: 'openapi', type: 'directory' },
					{ name: 'mcp', type: 'directory' },
				],
			});

			const tool = createExploreApiTool(mockClient as any);
			const result = await tool.func({ paths: '/' });
			const parsed = JSON.parse(result);

			expect(parsed).toHaveLength(1);
			expect(parsed[0].success).toBe(true);
			expect(parsed[0].type).toBe('directory');
			expect(parsed[0].path).toBe('/');
			expect(parsed[0].items).toHaveLength(2);
		});

		test('should explore a function path', async () => {
			mockClient.exploreAPI.mockResolvedValue({
				type: 'function',
				name: 'createRepo',
				description: 'Create a new repository',
				definition: '(input: object) => Promise<void>',
				group: 'github',
				path: '/openapi/github/repos/createRepo',
			});

			const tool = createExploreApiTool(mockClient as any);
			const result = await tool.func({ paths: '/openapi/github/repos/createRepo' });
			const parsed = JSON.parse(result);

			expect(parsed).toHaveLength(1);
			expect(parsed[0].success).toBe(true);
			expect(parsed[0].type).toBe('function');
			expect(parsed[0].name).toBe('createRepo');
			expect(parsed[0].group).toBe('github');
		});

		test('should include documentation from the server response', async () => {
			mockClient.exploreAPI.mockResolvedValue({
				type: 'directory',
				path: '/custom/myapi',
				items: [
					{ name: 'listItems', type: 'function' },
					{ name: 'createItem', type: 'function' },
				],
				documentation: {
					description: 'API for managing items',
					examples: ['listItems()', 'createItem({ name: "test" })'],
					tips: ['Use listItems before creating duplicates'],
				},
			});

			const tool = createExploreApiTool(mockClient as any);
			const result = await tool.func({ paths: '/custom/myapi' });
			const parsed = JSON.parse(result);

			expect(parsed).toHaveLength(1);
			expect(parsed[0].success).toBe(true);
			expect(parsed[0].documentation).toBeDefined();
			expect(parsed[0].documentation.description).toBe('API for managing items');
			expect(parsed[0].documentation.examples).toHaveLength(2);
			expect(parsed[0].documentation.tips).toEqual(['Use listItems before creating duplicates']);
		});

		test('should handle errors gracefully', async () => {
			mockClient.exploreAPI.mockRejectedValue(new Error('Path not found'));

			const tool = createExploreApiTool(mockClient as any);
			const result = await tool.func({ paths: '/invalid/path' });
			const parsed = JSON.parse(result);

			expect(parsed).toHaveLength(1);
			expect(parsed[0].success).toBe(false);
			expect(parsed[0].error).toBe('Path not found');
			expect(parsed[0].path).toBe('/invalid/path');
		});
	});

	describe('Multiple Paths Exploration', () => {
		test('should explore multiple directory paths', async () => {
			mockClient.exploreAPI
				.mockResolvedValueOnce({
					type: 'directory',
					path: '/openapi',
					items: [{ name: 'github', type: 'directory' }],
				})
				.mockResolvedValueOnce({
					type: 'directory',
					path: '/mcp',
					items: [{ name: 'filesystem', type: 'directory' }],
				});

			const tool = createExploreApiTool(mockClient as any);
			const result = await tool.func({ paths: ['/openapi', '/mcp'] });
			const parsed = JSON.parse(result);

			expect(parsed).toHaveLength(2);
			expect(parsed[0].success).toBe(true);
			expect(parsed[0].path).toBe('/openapi');
			expect(parsed[1].success).toBe(true);
			expect(parsed[1].path).toBe('/mcp');
		});

		test('should handle mixed success and failure', async () => {
			mockClient.exploreAPI
				.mockResolvedValueOnce({
					type: 'directory',
					path: '/openapi',
					items: [{ name: 'github', type: 'directory' }],
				})
				.mockRejectedValueOnce(new Error('Not found'));

			const tool = createExploreApiTool(mockClient as any);
			const result = await tool.func({ paths: ['/openapi', '/invalid'] });
			const parsed = JSON.parse(result);

			expect(parsed).toHaveLength(2);
			expect(parsed[0].success).toBe(true);
			expect(parsed[0].path).toBe('/openapi');
			expect(parsed[1].success).toBe(false);
			expect(parsed[1].error).toBe('Not found');
		});

		test('should explore paths in parallel', async () => {
			const callOrder: string[] = [];

			mockClient.exploreAPI.mockImplementation(async (path: string) => {
				callOrder.push(`start:${path}`);
				await new Promise((resolve) => setTimeout(resolve, 10));
				callOrder.push(`end:${path}`);
				return {
					type: 'directory',
					path,
					items: [],
				};
			});

			const tool = createExploreApiTool(mockClient as any);
			await tool.func({ paths: ['/a', '/b', '/c'] });

			expect(callOrder[0]).toBe('start:/a');
			expect(callOrder[1]).toBe('start:/b');
			expect(callOrder[2]).toBe('start:/c');
		});
	});

	describe('Tool Metadata', () => {
		test('should have correct tool name', () => {
			const tool = createExploreApiTool(mockClient as any);
			expect(tool.name).toBe('explore_api');
		});

		test('should have description mentioning both single and array input', () => {
			const tool = createExploreApiTool(mockClient as any);
			expect(tool.description).toContain('string');
			expect(tool.description).toContain('array');
		});

		test('should have valid input schema', () => {
			const tool = createExploreApiTool(mockClient as any);
			expect(tool.inputSchema).toBeDefined();
			expect(tool.zodSchema).toBeDefined();
		});
	});
});

