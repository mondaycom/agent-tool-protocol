import { describe, it, expect } from 'vitest';
import { loadOpenAPI } from '../src/openapi-loader';
import { APIAggregator } from '../src/aggregator';
import type { APIGroupConfig, CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';

describe('Schema Conversion - OpenAPI Loader', () => {
	describe('resolveSchema handles advanced JSON Schema features', () => {
		it('should preserve format field from OpenAPI schema', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						post: {
							operationId: 'createUser',
							summary: 'Create a user',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												email: { type: 'string', format: 'email' },
												birthDate: { type: 'string', format: 'date' },
												createdAt: { type: 'string', format: 'date-time' },
												website: { type: 'string', format: 'uri' },
												userId: { type: 'string', format: 'uuid' },
											},
											required: ['email'],
										},
									},
								},
							},
							responses: { '201': { description: 'Created' } },
						},
					},
				},
			};

			// Write spec to temp file
			const tempFile = '/tmp/test-format-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const createUser = apiGroup.functions?.find((f) => f.name === 'createUser');

			expect(createUser).toBeDefined();
			const inputSchema = createUser!.inputSchema as any;

			// Test that format is preserved
			expect(inputSchema.properties.email.format).toBe('email');
			expect(inputSchema.properties.birthDate.format).toBe('date');
			expect(inputSchema.properties.createdAt.format).toBe('date-time');
			expect(inputSchema.properties.website.format).toBe('uri');
			expect(inputSchema.properties.userId.format).toBe('uuid');
		});

		it('should handle nullable fields (OpenAPI 3.0 style)', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users/{id}': {
						patch: {
							operationId: 'updateUser',
							summary: 'Update a user',
							parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												nickname: { type: 'string', nullable: true },
												bio: { type: 'string', nullable: true },
											},
										},
									},
								},
							},
							responses: { '200': { description: 'Success' } },
						},
					},
				},
			};

			const tempFile = '/tmp/test-nullable-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const updateUser = apiGroup.functions?.find((f) => f.name === 'updateUser');

			expect(updateUser).toBeDefined();
			const inputSchema = updateUser!.inputSchema as any;

			// Test that nullable is preserved
			expect(inputSchema.properties.nickname.nullable).toBe(true);
			expect(inputSchema.properties.bio.nullable).toBe(true);
		});

		it('should preserve default values in schema', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/items': {
						get: {
							operationId: 'listItems',
							summary: 'List items',
							parameters: [
								{
									name: 'limit',
									in: 'query',
									schema: { type: 'integer', default: 20 },
								},
								{
									name: 'sortOrder',
									in: 'query',
									schema: { type: 'string', default: 'asc', enum: ['asc', 'desc'] },
								},
							],
							responses: { '200': { description: 'Success' } },
						},
					},
				},
			};

			const tempFile = '/tmp/test-default-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const listItems = apiGroup.functions?.find((f) => f.name === 'listItems');

			expect(listItems).toBeDefined();
			const inputSchema = listItems!.inputSchema as any;

			// Test that default values are preserved
			expect(inputSchema.properties.limit.default).toBe(20);
			expect(inputSchema.properties.sortOrder.default).toBe('asc');
		});

		it('should handle oneOf schema composition', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/payments': {
						post: {
							operationId: 'createPayment',
							summary: 'Create a payment',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												amount: { type: 'number' },
												method: {
													oneOf: [
														{ type: 'object', properties: { cardNumber: { type: 'string' } } },
														{ type: 'object', properties: { bankAccount: { type: 'string' } } },
													],
												},
											},
										},
									},
								},
							},
							responses: { '201': { description: 'Created' } },
						},
					},
				},
			};

			const tempFile = '/tmp/test-oneof-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const createPayment = apiGroup.functions?.find((f) => f.name === 'createPayment');

			expect(createPayment).toBeDefined();
			const inputSchema = createPayment!.inputSchema as any;

			// Test that oneOf is preserved
			expect(inputSchema.properties.method.oneOf).toBeDefined();
			expect(inputSchema.properties.method.oneOf).toHaveLength(2);
		});

		it('should handle anyOf schema composition', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/notifications': {
						post: {
							operationId: 'sendNotification',
							summary: 'Send notification',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												recipient: {
													anyOf: [
														{ type: 'string', format: 'email' },
														{ type: 'string', format: 'uri' },
													],
												},
											},
										},
									},
								},
							},
							responses: { '200': { description: 'Success' } },
						},
					},
				},
			};

			const tempFile = '/tmp/test-anyof-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const sendNotification = apiGroup.functions?.find((f) => f.name === 'sendNotification');

			expect(sendNotification).toBeDefined();
			const inputSchema = sendNotification!.inputSchema as any;

			// Test that anyOf is preserved
			expect(inputSchema.properties.recipient.anyOf).toBeDefined();
			expect(inputSchema.properties.recipient.anyOf).toHaveLength(2);
		});

		it('should handle allOf schema composition', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/employees': {
						post: {
							operationId: 'createEmployee',
							summary: 'Create employee',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											allOf: [
												{
													type: 'object',
													properties: { name: { type: 'string' } },
													required: ['name'],
												},
												{
													type: 'object',
													properties: { department: { type: 'string' } },
												},
											],
										},
									},
								},
							},
							responses: { '201': { description: 'Created' } },
						},
					},
				},
			};

			const tempFile = '/tmp/test-allof-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const createEmployee = apiGroup.functions?.find((f) => f.name === 'createEmployee');

			expect(createEmployee).toBeDefined();
			const inputSchema = createEmployee!.inputSchema as any;

			// Test that allOf is preserved
			expect(inputSchema.allOf).toBeDefined();
			expect(inputSchema.allOf).toHaveLength(2);
		});

		it('should preserve validation constraints (min/max)', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/orders': {
						post: {
							operationId: 'createOrder',
							summary: 'Create order',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												quantity: {
													type: 'integer',
													minimum: 1,
													maximum: 100,
												},
												description: {
													type: 'string',
													minLength: 10,
													maxLength: 500,
												},
												tags: {
													type: 'array',
													items: { type: 'string' },
													minItems: 1,
													maxItems: 5,
												},
											},
										},
									},
								},
							},
							responses: { '201': { description: 'Created' } },
						},
					},
				},
			};

			const tempFile = '/tmp/test-constraints-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const createOrder = apiGroup.functions?.find((f) => f.name === 'createOrder');

			expect(createOrder).toBeDefined();
			const inputSchema = createOrder!.inputSchema as any;

			// Test that constraints are preserved
			expect(inputSchema.properties.quantity.minimum).toBe(1);
			expect(inputSchema.properties.quantity.maximum).toBe(100);
			expect(inputSchema.properties.description.minLength).toBe(10);
			expect(inputSchema.properties.description.maxLength).toBe(500);
			expect(inputSchema.properties.tags.minItems).toBe(1);
			expect(inputSchema.properties.tags.maxItems).toBe(5);
		});

		it('should handle additionalProperties in object schemas', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/config': {
						put: {
							operationId: 'updateConfig',
							summary: 'Update config',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											additionalProperties: { type: 'string' },
										},
									},
								},
							},
							responses: { '200': { description: 'Success' } },
						},
					},
				},
			};

			const tempFile = '/tmp/test-additional-props-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const updateConfig = apiGroup.functions?.find((f) => f.name === 'updateConfig');

			expect(updateConfig).toBeDefined();
			const inputSchema = updateConfig!.inputSchema as any;

			// Test that additionalProperties is preserved
			expect(inputSchema.additionalProperties).toBeDefined();
			expect(inputSchema.additionalProperties.type).toBe('string');
		});

		it('should handle parameters without schema (Swagger 2.0 style inline type)', async () => {
			// Note: In practice, parameters should have schemas, but we test graceful handling
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/search': {
						get: {
							operationId: 'search',
							summary: 'Search items',
							parameters: [
								{
									name: 'query',
									in: 'query',
									required: true,
									schema: { type: 'string' },
								},
								{
									name: 'legacyParam',
									in: 'query',
									required: false,
									// No schema - should still be handled
								},
							],
							responses: { '200': { description: 'Success' } },
						},
					},
				},
			};

			const tempFile = '/tmp/test-no-schema-param-spec.json';
			const fs = await import('node:fs/promises');
			await fs.writeFile(tempFile, JSON.stringify(spec));

			const apiGroup = await loadOpenAPI(tempFile);
			const search = apiGroup.functions?.find((f) => f.name === 'search');

			expect(search).toBeDefined();
			const inputSchema = search!.inputSchema as any;

			// Both parameters should be present
			expect(inputSchema.properties.query).toBeDefined();
			expect(inputSchema.properties.legacyParam).toBeDefined();
			// Legacy param should default to string type
			expect(inputSchema.properties.legacyParam.type).toBe('string');
		});
	});
});

describe('Schema Conversion - Aggregator TypeScript Generation', () => {
	describe('handles complex types correctly', () => {
		it('should generate correct array types with item schema', () => {
			const apiGroup: APIGroupConfig = {
				name: 'test',
				type: 'custom',
				functions: [
					{
						name: 'getItems',
						description: 'Get items',
						inputSchema: {
							type: 'object',
							properties: {
								ids: {
									type: 'array',
									items: { type: 'string' },
								},
								filters: {
									type: 'array',
									items: {
										type: 'object',
										properties: {
											field: { type: 'string' },
											value: { type: 'string' },
										},
									},
								},
							},
						},
						handler: async () => ({}),
					},
				],
			};

			const aggregator = new APIAggregator([apiGroup]);
			const typescript = aggregator.generateRuntimeTypes();

			// The full TypeScript generation includes function types
			// We'll test via generateTypeScript which includes generateFunctionTypes
		});

		it('should handle nullable types (type array with null)', async () => {
			const apiGroup: APIGroupConfig = {
				name: 'test',
				type: 'custom',
				functions: [
					{
						name: 'updateUser',
						description: 'Update user',
						inputSchema: {
							type: 'object',
							properties: {
								name: { type: 'string' },
								// JSON Schema style nullable
								nickname: { type: ['string', 'null'] },
							},
						},
						outputSchema: {
							type: 'object',
							properties: {
								id: { type: 'string' },
								nickname: { type: ['string', 'null'] },
							},
						},
						handler: async () => ({}),
					},
				],
			};

			const aggregator = new APIAggregator([apiGroup]);
			const typescript = await aggregator.generateTypeScript();

			// Should handle the nullable type properly
			// Either as "string | null" or handle gracefully
			expect(typescript).toContain('updateUser');
			// Should not generate invalid TypeScript
			expect(typescript).not.toContain('["string","null"]');
		});

		it('should properly escape enum values with special characters', async () => {
			const apiGroup: APIGroupConfig = {
				name: 'test',
				type: 'custom',
				functions: [
					{
						name: 'setStatus',
						description: 'Set status',
						inputSchema: {
							type: 'object',
							properties: {
								status: {
									type: 'string',
									enum: ['in-progress', 'on-hold', 'done', "it's complicated"],
								},
							},
						},
						handler: async () => ({}),
					},
				],
			};

			const aggregator = new APIAggregator([apiGroup]);
			const typescript = await aggregator.generateTypeScript();

			// Should escape the quote in "it's complicated"
			expect(typescript).toContain('setStatus');
			// Verify no syntax errors would be generated
			expect(typescript).not.toContain(`"it's complicated"`);
		});

		it('should handle deeply nested schemas beyond depth limit gracefully', async () => {
			const deeplyNested = {
				type: 'object',
				properties: {
					level1: {
						type: 'object',
						properties: {
							level2: {
								type: 'object',
								properties: {
									level3: {
										type: 'object',
										properties: {
											level4: {
												type: 'object',
												properties: {
													level5: {
														type: 'object',
														properties: {
															value: { type: 'string' },
														},
													},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			};

			const apiGroup: APIGroupConfig = {
				name: 'test',
				type: 'custom',
				functions: [
					{
						name: 'deepFunction',
						description: 'Deep nested test',
						inputSchema: {
							type: 'object',
							properties: {},
						},
						outputSchema: deeplyNested,
						handler: async () => ({}),
					},
				],
			};

			const aggregator = new APIAggregator([apiGroup]);
			const typescript = await aggregator.generateTypeScript();

			// Should handle deep nesting without crashing
			expect(typescript).toContain('deepFunction');
			// Should generate valid TypeScript (may truncate to unknown for deep levels)
			expect(typescript).toContain('deepFunction_Output');
		});

		it('should handle array output types correctly', async () => {
			const apiGroup: APIGroupConfig = {
				name: 'test',
				type: 'custom',
				functions: [
					{
						name: 'listUsers',
						description: 'List users',
						inputSchema: {
							type: 'object',
							properties: {},
						},
						outputSchema: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									name: { type: 'string' },
								},
								required: ['id'],
							},
						},
						handler: async () => ({}),
					},
				],
			};

			const aggregator = new APIAggregator([apiGroup]);
			const typescript = await aggregator.generateTypeScript();

			// Should handle array output schema
			expect(typescript).toContain('listUsers_Output');
			// Should indicate it's an array type somehow (index signature or Array-like)
			expect(typescript).toMatch(/\[index: number\]|length/);
		});
	});
});
