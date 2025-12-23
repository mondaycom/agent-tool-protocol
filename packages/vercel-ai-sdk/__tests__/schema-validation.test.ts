/**
 * Schema Validation Tests
 *
 * Tests that verify the fix for the "type: None" schema bug.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { tool } from 'ai';
import { createATPTools } from '../src/index.js';
import { createServer } from '@mondaydotcomorg/atp-server';
import {
	ToolNames,
	executeCodeInputSchema,
	exploreApiInputSchema,
	searchApiInputSchema,
	fetchAllApisInputSchema,
} from '@mondaydotcomorg/atp-client';

// Helper type for JSON Schema
interface JsonSchema {
	type?: string;
	properties?: Record<string, any>;
	required?: string[];
	[key: string]: any;
}

/**
 * TOOL_SCHEMAS mirrors what's in tools.ts - importing from client package.
 * This ensures schemas are the single source of truth and stay in sync.
 */
const TOOL_SCHEMAS = {
	[ToolNames.EXECUTE_CODE]: executeCodeInputSchema.pick({ code: true }),
	[ToolNames.EXPLORE_API]: exploreApiInputSchema,
	[ToolNames.SEARCH_API]: searchApiInputSchema,
	[ToolNames.FETCH_ALL_APIS]: fetchAllApisInputSchema,
} as const;

const mockModel = {
	specificationVersion: 'v1',
	provider: 'mock-provider',
	modelId: 'mock-model',
	defaultObjectGenerationMode: 'tool',
	doGenerate: async () => ({
		text: 'Mock LLM response',
		finishReason: 'stop',
		usage: { promptTokens: 10, completionTokens: 20 },
	}),
	doStream: async () => ({
		stream: (async function* () {
			yield { type: 'text-delta', textDelta: 'Mock response' };
		})(),
	}),
};

describe('Schema Validation - Fix for type:None Bug', () => {
	describe('Explicit TOOL_SCHEMAS are valid Zod schemas', () => {
		test('execute_code schema is a valid Zod object schema', () => {
			const schema = TOOL_SCHEMAS[ToolNames.EXECUTE_CODE];

			// Verify it's a real Zod schema with shape
			expect(schema).toBeDefined();
			expect(schema._def).toBeDefined();
			expect(schema._def.typeName).toBe('ZodObject');

			// Verify the shape contains expected properties
			expect(schema.shape).toBeDefined();
			expect(schema.shape.code).toBeDefined();
			expect(schema.shape.code._def.typeName).toBe('ZodString');
		});

		test('explore_api schema is a valid Zod object schema', () => {
			const schema = TOOL_SCHEMAS[ToolNames.EXPLORE_API];

			expect(schema).toBeDefined();
			expect(schema._def).toBeDefined();
			expect(schema._def.typeName).toBe('ZodObject');
			expect(schema.shape).toBeDefined();
			expect(schema.shape.paths).toBeDefined();
			expect(schema.shape.paths._def.typeName).toBe('ZodUnion');
		});

		test('search_api schema is a valid Zod object schema', () => {
			const schema = TOOL_SCHEMAS[ToolNames.SEARCH_API];

			expect(schema).toBeDefined();
			expect(schema._def).toBeDefined();
			expect(schema._def.typeName).toBe('ZodObject');
			expect(schema.shape).toBeDefined();
			expect(schema.shape.query).toBeDefined();
			expect(schema.shape.query._def.typeName).toBe('ZodString');
		});

		test('fetch_all_apis schema is a valid Zod object schema', () => {
			const schema = TOOL_SCHEMAS[ToolNames.FETCH_ALL_APIS];

			expect(schema).toBeDefined();
			expect(schema._def).toBeDefined();
			expect(schema._def.typeName).toBe('ZodObject');
		});

		test('all schemas convert to JSON Schema with type: object (not None)', () => {
			for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
				const jsonSchema = zodToJsonSchema(schema) as JsonSchema;

				// The mock returns type: 'object', which is correct
				// The real library would also return type: 'object'
				expect(jsonSchema.type).toBe('object');

				// Verify it's not the buggy 'None' value
				expect(jsonSchema.type).not.toBe('None');
				expect(jsonSchema.type).not.toBe('none');
				expect(jsonSchema.type).not.toBeUndefined();
				expect(jsonSchema.type).not.toBeNull();
			}
		});
	});

	describe('Reproducing the bug scenario - corrupted zodSchema', () => {
		test('demonstrates what happens with undefined zodSchema (fallback works)', () => {
			// This simulates what would happen if zodSchema was undefined
			const corruptedSchema = undefined;
			const fallbackSchema = corruptedSchema || z.object({});

			// Verify fallback is a real Zod schema
			expect(fallbackSchema._def.typeName).toBe('ZodObject');

			const jsonSchema = zodToJsonSchema(fallbackSchema) as JsonSchema;
			expect(jsonSchema.type).toBe('object');
		});

		test('corrupted value would fail Zod typeName check', () => {
			// This simulates the corruption scenario
			const corruptedValue = { type: 'None' } as any;

			// The fix relies on using known-good Zod schemas
			// A corrupted value doesn't have proper Zod internals
			expect(corruptedValue._def).toBeUndefined();

			// Real Zod schema has proper internals
			const realSchema = z.object({});
			expect(realSchema._def).toBeDefined();
			expect(realSchema._def.typeName).toBe('ZodObject');
		});

		test('truthy non-Zod value lacks required Zod internals', () => {
			// Simulate a corrupted zodSchema - truthy but not a real Zod schema
			const mockCorruptedTool = {
				name: 'search_api',
				description: 'Search API',
				zodSchema: Object.create(null), // Empty object - truthy but corrupted
			};

			// The old code would do: atpTool.zodSchema || z.object({})
			// Since Object.create(null) is truthy, it would be used as-is
			const usedSchema = mockCorruptedTool.zodSchema || z.object({});

			// The corrupted value lacks Zod internals
			expect(usedSchema._def).toBeUndefined();

			// The fix uses explicit schemas which always have proper internals
			expect(TOOL_SCHEMAS[ToolNames.SEARCH_API]._def).toBeDefined();
			expect(TOOL_SCHEMAS[ToolNames.SEARCH_API]._def.typeName).toBe('ZodObject');
		});
	});

	describe('Vercel AI SDK tool() function with schemas', () => {
		test('tool() accepts valid Zod schema and creates proper tool definition', () => {
			const validSchema = z.object({
				query: z.string().describe('Search query'),
			});

			const testTool = tool({
				description: 'Test tool',
				parameters: validSchema,
				execute: async ({ query }) => ({ result: query }),
			});

			expect(testTool).toBeDefined();
			expect(testTool.parameters).toBeDefined();

			// Verify the parameters is a real Zod schema
			expect(testTool.parameters._def).toBeDefined();
			expect(testTool.parameters._def.typeName).toBe('ZodObject');
		});

		test('tool() with explicit TOOL_SCHEMAS creates valid tools', () => {
			const searchTool = tool({
				description: 'Search API',
				parameters: TOOL_SCHEMAS[ToolNames.SEARCH_API],
				execute: async ({ query }: { query: string }) => ({ results: [query] }),
			});

			const executeTool = tool({
				description: 'Execute code',
				parameters: TOOL_SCHEMAS[ToolNames.EXECUTE_CODE],
				execute: async ({ code }: { code: string }) => ({ executed: code }),
			});

			expect(searchTool).toBeDefined();
			expect(executeTool).toBeDefined();

			// Verify parameters are valid Zod schemas
			expect(searchTool.parameters._def.typeName).toBe('ZodObject');
			expect(executeTool.parameters._def.typeName).toBe('ZodObject');

			// Verify JSON Schema conversion produces type: object
			const searchJsonSchema = zodToJsonSchema(searchTool.parameters) as JsonSchema;
			const executeJsonSchema = zodToJsonSchema(executeTool.parameters) as JsonSchema;

			expect(searchJsonSchema.type).toBe('object');
			expect(executeJsonSchema.type).toBe('object');
		});
	});

	describe('Integration with createATPTools - HTTP mode', () => {
		let serverUrl: string;
		let server: ReturnType<typeof createServer>;

		beforeAll(async () => {
			const port = 14337;
			serverUrl = `http://localhost:${port}`;
			server = createServer();
			await server.listen(port);
		});

		afterAll(async () => {
			if (server) {
				await server.stop();
			}
		});

		test('createATPTools produces tools with valid Zod schemas', async () => {
			const { tools } = await createATPTools({
				serverUrl,
				headers: { Authorization: 'Bearer test-key' },
				model: mockModel,
				approvalHandler: async () => true,
			});

			expect(tools).toBeDefined();

			// Verify all expected tools exist
			expect(tools.atp_execute_code).toBeDefined();
			expect(tools.atp_explore_api).toBeDefined();
			expect(tools.atp_search_api).toBeDefined();
			expect(tools.atp_get_type_definitions).toBeDefined();

			// Verify each tool has valid Zod schema parameters
			expect(tools.atp_execute_code.parameters._def.typeName).toBe('ZodObject');
			expect(tools.atp_explore_api.parameters._def.typeName).toBe('ZodObject');
			expect(tools.atp_search_api.parameters._def.typeName).toBe('ZodObject');
			expect(tools.atp_get_type_definitions.parameters._def.typeName).toBe('ZodObject');
		});

		test('createATPTools tools convert to JSON Schema with type: object (not None)', async () => {
			const { tools } = await createATPTools({
				serverUrl,
				headers: { Authorization: 'Bearer test-key' },
				model: mockModel,
				approvalHandler: async () => true,
			});

			// Convert to JSON Schema and verify type: object
			const executeCodeJsonSchema = zodToJsonSchema(
				tools.atp_execute_code.parameters
			) as JsonSchema;
			const searchApiJsonSchema = zodToJsonSchema(
				tools.atp_search_api.parameters
			) as JsonSchema;
			const exploreApiJsonSchema = zodToJsonSchema(
				tools.atp_explore_api.parameters
			) as JsonSchema;

			// Verify type is 'object' - THE KEY FIX
			expect(executeCodeJsonSchema.type).toBe('object');
			expect(searchApiJsonSchema.type).toBe('object');
			expect(exploreApiJsonSchema.type).toBe('object');

			// Verify none are 'None' - the bug we fixed
			expect(executeCodeJsonSchema.type).not.toBe('None');
			expect(searchApiJsonSchema.type).not.toBe('None');
			expect(exploreApiJsonSchema.type).not.toBe('None');
		});

		test('tools execute correctly with valid input', async () => {
			const { tools } = await createATPTools({
				serverUrl,
				headers: { Authorization: 'Bearer test-key' },
				model: mockModel,
				approvalHandler: async () => true,
			});

			const result = await tools.atp_execute_code.execute({
				code: 'return { hello: "world" };',
			});

			expect(result).toBeDefined();
			expect(result.success).toBe(true);
			expect(result.result).toEqual({ hello: 'world' });
		});
	});

	describe('Integration with createATPTools - In-process mode (where bug manifested)', () => {
		test('createATPTools produces tools with valid Zod schemas in in-process mode', async () => {
			const server = createServer();

			const { tools } = await createATPTools({
				server,
				model: mockModel,
				approvalHandler: async () => true,
			});

			expect(tools).toBeDefined();

			// The key test: verify schemas are valid Zod objects in in-process mode
			// This is where the bug originally manifested
			expect(tools.atp_execute_code.parameters._def.typeName).toBe('ZodObject');
			expect(tools.atp_search_api.parameters._def.typeName).toBe('ZodObject');
			expect(tools.atp_explore_api.parameters._def.typeName).toBe('ZodObject');
		});

		test('JSON Schema conversion produces type: object (not None) in in-process mode', async () => {
			const server = createServer();

			const { tools } = await createATPTools({
				server,
				model: mockModel,
				approvalHandler: async () => true,
			});

			const executeCodeJsonSchema = zodToJsonSchema(
				tools.atp_execute_code.parameters
			) as JsonSchema;
			const searchApiJsonSchema = zodToJsonSchema(
				tools.atp_search_api.parameters
			) as JsonSchema;
			const exploreApiJsonSchema = zodToJsonSchema(
				tools.atp_explore_api.parameters
			) as JsonSchema;

			// Verify type is 'object' - not 'None'
			expect(executeCodeJsonSchema.type).toBe('object');
			expect(searchApiJsonSchema.type).toBe('object');
			expect(exploreApiJsonSchema.type).toBe('object');

			// Explicitly verify NOT 'None' - the original bug
			expect(executeCodeJsonSchema.type).not.toBe('None');
			expect(searchApiJsonSchema.type).not.toBe('None');
			expect(exploreApiJsonSchema.type).not.toBe('None');
		});

		test('tools execute correctly in in-process mode', async () => {
			const server = createServer();

			server.tool('testAdd', {
				description: 'Add two numbers',
				input: { a: 'number', b: 'number' },
				handler: async (input: any) => ({ result: input.a + input.b }),
			});

			const { tools } = await createATPTools({
				server,
				model: mockModel,
				approvalHandler: async () => true,
			});

			const result = await tools.atp_execute_code.execute({
				code: 'return await api.custom.testAdd({ a: 5, b: 3 });',
			});

			expect(result).toBeDefined();
			expect(result.success).toBe(true);
			expect(result.result).toEqual({ result: 8 });
		});
	});

	describe('Regression prevention', () => {
		test('TOOL_SCHEMAS keys match ToolNames constants', () => {
			// Ensure the schemas are defined for all expected tools
			expect(TOOL_SCHEMAS[ToolNames.EXECUTE_CODE]).toBeDefined();
			expect(TOOL_SCHEMAS[ToolNames.EXPLORE_API]).toBeDefined();
			expect(TOOL_SCHEMAS[ToolNames.SEARCH_API]).toBeDefined();
			expect(TOOL_SCHEMAS[ToolNames.FETCH_ALL_APIS]).toBeDefined();
		});

		test('schemas cannot be accidentally undefined or null', () => {
			for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
				expect(schema).not.toBeUndefined();
				expect(schema).not.toBeNull();
				expect(schema).toBeTruthy();
				// Verify it's a real Zod schema, not just any truthy value
				expect(schema._def).toBeDefined();
				expect(schema._def.typeName).toBe('ZodObject');
			}
		});
	});
});

/**
 * Summary of the fix tested here:
 *
 * 1. TOOL_SCHEMAS are defined at module level with explicit Zod schemas
 * 2. Each schema has proper Zod internals (_def.typeName === 'ZodObject')
 * 3. When converted to JSON Schema, type is always 'object' (never 'None')
 * 4. Works correctly in both HTTP and in-process modes
 *
 * If any test fails with type: "None" or invalid Zod internals, the bug has regressed.
 */
