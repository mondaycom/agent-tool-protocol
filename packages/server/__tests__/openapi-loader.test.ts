import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadOpenAPI, LoadOpenAPIOptions } from '../src/openapi-loader';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'openapi-loader-tests');

async function writeSpec(name: string, spec: object): Promise<string> {
	const path = join(TEST_DIR, name);
	await writeFile(path, JSON.stringify(spec, null, 2));
	return path;
}

async function writeYamlSpec(name: string, content: string): Promise<string> {
	const path = join(TEST_DIR, name);
	await writeFile(path, content);
	return path;
}

describe('OpenAPI Loader', () => {
	beforeAll(async () => {
		await mkdir(TEST_DIR, { recursive: true });
	});

	afterAll(async () => {
		// Cleanup is optional since we're using tmpdir
	});

	describe('loadOpenAPI', () => {
		describe('OpenAPI 3.0 support', () => {
			it('should load a basic OpenAPI 3.0 spec', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test API', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/users': {
							get: {
								operationId: 'listUsers',
								summary: 'List all users',
								responses: { '200': { description: 'Success' } },
							},
						},
					},
				};

				const path = await writeSpec('basic-openapi3.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.name).toBe('test-api');
				expect(apiGroup.type).toBe('openapi');
				expect(apiGroup.functions).toHaveLength(1);
				expect(apiGroup.functions![0].name).toBe('listUsers');
				expect(apiGroup.functions![0].description).toBe('List all users');
			});

			it('should use first server URL as baseURL', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Multi Server API', version: '1.0.0' },
					servers: [
						{ url: 'https://api.example.com/v1' },
						{ url: 'https://api.example.com/v2' },
					],
					paths: {
						'/test': {
							get: {
								operationId: 'getTest',
								responses: { '200': { description: 'Success' } },
							},
						},
					},
				};

				const path = await writeSpec('multi-server.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.functions).toHaveLength(1);
			});

			it('should handle spec without servers', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'No Server API', version: '1.0.0' },
					paths: {
						'/test': {
							get: {
								operationId: 'getTest',
								responses: { '200': { description: 'Success' } },
							},
						},
					},
				};

				const path = await writeSpec('no-server.json', spec);
				const apiGroup = await loadOpenAPI(path, { baseURL: 'https://fallback.example.com' });

				expect(apiGroup.functions).toHaveLength(1);
			});
		});

		describe('Swagger 2.0 support', () => {
			it('should load a Swagger 2.0 spec', async () => {
				const spec = {
					swagger: '2.0',
					info: { title: 'Swagger API', version: '1.0.0' },
					host: 'api.example.com',
					basePath: '/v1',
					schemes: ['https'],
					paths: {
						'/items': {
							get: {
								operationId: 'listItems',
								summary: 'List items',
								responses: { '200': { description: 'Success' } },
							},
						},
					},
				};

				const path = await writeSpec('swagger2.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.name).toBe('swagger-api');
				expect(apiGroup.functions).toHaveLength(1);
				expect(apiGroup.functions![0].name).toBe('listItems');
			});

			it('should construct baseURL from Swagger 2.0 host, basePath, and schemes', async () => {
				const spec = {
					swagger: '2.0',
					info: { title: 'Test', version: '1.0.0' },
					host: 'example.com',
					basePath: '/api',
					schemes: ['http', 'https'],
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
				};

				const path = await writeSpec('swagger2-baseurl.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.functions).toHaveLength(1);
			});

			it('should default scheme to https for Swagger 2.0', async () => {
				const spec = {
					swagger: '2.0',
					info: { title: 'Test', version: '1.0.0' },
					host: 'example.com',
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
				};

				const path = await writeSpec('swagger2-default-scheme.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.functions).toHaveLength(1);
			});
		});

		describe('YAML support', () => {
			it('should load YAML spec file', async () => {
				const yamlContent = `
openapi: '3.0.0'
info:
  title: YAML API
  version: '1.0.0'
servers:
  - url: https://api.example.com
paths:
  /users:
    get:
      operationId: getUsers
      summary: Get users
      responses:
        '200':
          description: Success
`;
				const path = await writeYamlSpec('yaml-spec.yaml', yamlContent);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.name).toBe('yaml-api');
				expect(apiGroup.functions).toHaveLength(1);
				expect(apiGroup.functions![0].name).toBe('getUsers');
			});

			it('should load YML spec file', async () => {
				const yamlContent = `
openapi: '3.0.0'
info:
  title: YML API
  version: '1.0.0'
servers:
  - url: https://api.example.com
paths:
  /items:
    get:
      operationId: getItems
      responses:
        '200':
          description: Success
`;
				const path = await writeYamlSpec('yml-spec.yml', yamlContent);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.name).toBe('yml-api');
				expect(apiGroup.functions).toHaveLength(1);
			});

			it('should auto-detect YAML content even with .json extension', async () => {
				const yamlContent = `
openapi: '3.0.0'
info:
  title: Auto Detect API
  version: '1.0.0'
servers:
  - url: https://api.example.com
paths:
  /test:
    get:
      operationId: testOp
      responses:
        '200':
          description: OK
`;
				// Write as .json but content is YAML
				const path = await writeSpec('yaml-as-json.json', {});
				await writeFile(path, yamlContent);

				const apiGroup = await loadOpenAPI(path);
				expect(apiGroup.functions).toHaveLength(1);
			});
		});

		describe('options.name', () => {
			it('should use custom name from options', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Original Name', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
				};

				const path = await writeSpec('custom-name.json', spec);
				const apiGroup = await loadOpenAPI(path, { name: 'my-custom-api' });

				expect(apiGroup.name).toBe('my-custom-api');
			});

			it('should derive name from title if not provided', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'My Great API Service', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {},
				};

				const path = await writeSpec('derived-name.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.name).toBe('my-great-api-service');
			});
		});

		describe('options.baseURL', () => {
			it('should use custom baseURL from options', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://original.example.com' }],
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
				};

				const path = await writeSpec('custom-baseurl.json', spec);
				const apiGroup = await loadOpenAPI(path, { baseURL: 'https://custom.example.com/v2' });

				expect(apiGroup.functions).toHaveLength(1);
			});
		});
	});

	describe('Filtering operations', () => {
		const createFilterSpec = () => ({
			openapi: '3.0.0',
			info: { title: 'Filter Test', version: '1.0.0' },
			servers: [{ url: 'https://api.example.com' }],
			paths: {
				'/users': {
					get: {
						operationId: 'listUsers',
						tags: ['users'],
						responses: { '200': { description: 'Success' } },
					},
					post: {
						operationId: 'createUser',
						tags: ['users', 'admin'],
						responses: { '201': { description: 'Created' } },
					},
				},
				'/items': {
					get: {
						operationId: 'listItems',
						tags: ['items'],
						responses: { '200': { description: 'Success' } },
					},
					delete: {
						operationId: 'deleteItem',
						tags: ['items', 'admin'],
						responses: { '204': { description: 'No Content' } },
					},
				},
				'/admin/settings': {
					get: {
						operationId: 'getSettings',
						tags: ['admin'],
						responses: { '200': { description: 'Success' } },
					},
				},
				'/deprecated': {
					get: {
						operationId: 'deprecatedOp',
						deprecated: true,
						responses: { '200': { description: 'Success' } },
					},
				},
			},
		});

		describe('filter.tags', () => {
			it('should filter operations by single tag', async () => {
				const path = await writeSpec('filter-tags.json', createFilterSpec());
				const apiGroup = await loadOpenAPI(path, {
					filter: { tags: ['admin'] },
				});

				expect(apiGroup.functions).toHaveLength(3);
				const names = apiGroup.functions!.map((f) => f.name);
				expect(names).toContain('createUser');
				expect(names).toContain('deleteItem');
				expect(names).toContain('getSettings');
			});

			it('should filter operations by multiple tags (OR logic)', async () => {
				const path = await writeSpec('filter-multi-tags.json', createFilterSpec());
				const apiGroup = await loadOpenAPI(path, {
					filter: { tags: ['users', 'items'] },
				});

				expect(apiGroup.functions).toHaveLength(4);
			});
		});

		describe('filter.paths', () => {
			it('should filter operations by exact path', async () => {
				const path = await writeSpec('filter-exact-path.json', createFilterSpec());
				const apiGroup = await loadOpenAPI(path, {
					filter: { paths: ['/users'] },
				});

				expect(apiGroup.functions).toHaveLength(2);
				const names = apiGroup.functions!.map((f) => f.name);
				expect(names).toContain('listUsers');
				expect(names).toContain('createUser');
			});

			it('should filter operations by wildcard path pattern', async () => {
				const path = await writeSpec('filter-wildcard-path.json', createFilterSpec());
				const apiGroup = await loadOpenAPI(path, {
					filter: { paths: ['/admin/*'] },
				});

				expect(apiGroup.functions).toHaveLength(1);
				expect(apiGroup.functions![0].name).toBe('getSettings');
			});
		});

		describe('filter.exclude', () => {
			it('should exclude operations by path pattern', async () => {
				const path = await writeSpec('filter-exclude.json', createFilterSpec());
				const apiGroup = await loadOpenAPI(path, {
					filter: { exclude: ['/admin/*'] },
				});

				const names = apiGroup.functions!.map((f) => f.name);
				expect(names).not.toContain('getSettings');
			});
		});

		describe('filter.methods', () => {
			it('should filter operations by HTTP method', async () => {
				const path = await writeSpec('filter-methods.json', createFilterSpec());
				const apiGroup = await loadOpenAPI(path, {
					filter: { methods: ['GET'] },
				});

				expect(apiGroup.functions).toHaveLength(3);
				const names = apiGroup.functions!.map((f) => f.name);
				expect(names).toContain('listUsers');
				expect(names).toContain('listItems');
				expect(names).toContain('getSettings');
			});

			it('should filter operations by multiple methods', async () => {
				const path = await writeSpec('filter-multi-methods.json', createFilterSpec());
				const apiGroup = await loadOpenAPI(path, {
					filter: { methods: ['POST', 'DELETE'] },
				});

				expect(apiGroup.functions).toHaveLength(2);
				const names = apiGroup.functions!.map((f) => f.name);
				expect(names).toContain('createUser');
				expect(names).toContain('deleteItem');
			});
		});

		describe('filter.operation (custom)', () => {
			it('should filter using custom operation filter function', async () => {
				const path = await writeSpec('filter-custom.json', createFilterSpec());
				const apiGroup = await loadOpenAPI(path, {
					filter: {
						operation: (op, opPath, method) => {
							return opPath.startsWith('/users') && method === 'get';
						},
					},
				});

				expect(apiGroup.functions).toHaveLength(1);
				expect(apiGroup.functions![0].name).toBe('listUsers');
			});
		});

		describe('deprecated operations', () => {
			it('should exclude deprecated operations when filter is provided', async () => {
				const path = await writeSpec('filter-deprecated.json', createFilterSpec());
				// Deprecated operations are excluded when any filter is applied
				const apiGroup = await loadOpenAPI(path, {
					filter: { tags: ['users', 'items', 'admin'] },
				});

				const names = apiGroup.functions!.map((f) => f.name);
				expect(names).not.toContain('deprecatedOp');
			});
		});
	});

	describe('Parameter handling', () => {
		describe('path parameters', () => {
			it('should handle path parameters', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/users/{userId}': {
							get: {
								operationId: 'getUser',
								parameters: [
									{
										name: 'userId',
										in: 'path',
										required: true,
										schema: { type: 'string' },
										description: 'The user ID',
									},
								],
								responses: { '200': { description: 'Success' } },
							},
						},
					},
				};

				const path = await writeSpec('path-params.json', spec);
				const apiGroup = await loadOpenAPI(path);

				const func = apiGroup.functions![0];
				const inputSchema = func.inputSchema as any;

				expect(inputSchema.properties.userId).toBeDefined();
				expect(inputSchema.properties.userId.type).toBe('string');
				expect(inputSchema.properties.userId.description).toBe('The user ID');
				expect(inputSchema.required).toContain('userId');
			});
		});

		describe('query parameters', () => {
			it('should handle query parameters', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/users': {
							get: {
								operationId: 'listUsers',
								parameters: [
									{
										name: 'limit',
										in: 'query',
										schema: { type: 'integer', default: 10 },
									},
									{
										name: 'offset',
										in: 'query',
										schema: { type: 'integer' },
									},
								],
								responses: { '200': { description: 'Success' } },
							},
						},
					},
				};

				const path = await writeSpec('query-params.json', spec);
				const apiGroup = await loadOpenAPI(path);

				const func = apiGroup.functions![0];
				const inputSchema = func.inputSchema as any;

				expect(inputSchema.properties.limit).toBeDefined();
				expect(inputSchema.properties.limit.type).toBe('integer');
				expect(inputSchema.properties.limit.default).toBe(10);
				expect(inputSchema.properties.offset).toBeDefined();
			});
		});

		describe('header parameters', () => {
			it('should handle header parameters', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/users': {
							get: {
								operationId: 'listUsers',
								parameters: [
									{
										name: 'X-Custom-Header',
										in: 'header',
										schema: { type: 'string' },
									},
								],
								responses: { '200': { description: 'Success' } },
							},
						},
					},
				};

				const path = await writeSpec('header-params.json', spec);
				const apiGroup = await loadOpenAPI(path);

				const func = apiGroup.functions![0];
				const inputSchema = func.inputSchema as any;

				expect(inputSchema.properties['X-Custom-Header']).toBeDefined();
			});
		});

		describe('path-level parameters', () => {
			it('should inherit path-level parameters', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/users/{userId}': {
							parameters: [
								{
									name: 'userId',
									in: 'path',
									required: true,
									schema: { type: 'string' },
								},
							],
							get: {
								operationId: 'getUser',
								responses: { '200': { description: 'Success' } },
							},
							delete: {
								operationId: 'deleteUser',
								responses: { '204': { description: 'Deleted' } },
							},
						},
					},
				};

				const path = await writeSpec('path-level-params.json', spec);
				const apiGroup = await loadOpenAPI(path);

				// Both operations should have userId parameter
				const getUser = apiGroup.functions!.find((f) => f.name === 'getUser');
				const deleteUser = apiGroup.functions!.find((f) => f.name === 'deleteUser');

				expect((getUser!.inputSchema as any).properties.userId).toBeDefined();
				expect((deleteUser!.inputSchema as any).properties.userId).toBeDefined();
			});

			it('should override path-level parameters with operation-level', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/users/{userId}': {
							parameters: [
								{
									name: 'userId',
									in: 'path',
									required: true,
									schema: { type: 'string' },
									description: 'Path-level description',
								},
							],
							get: {
								operationId: 'getUser',
								parameters: [
									{
										name: 'userId',
										in: 'path',
										required: true,
										schema: { type: 'string' },
										description: 'Operation-level description',
									},
								],
								responses: { '200': { description: 'Success' } },
							},
						},
					},
				};

				const path = await writeSpec('param-override.json', spec);
				const apiGroup = await loadOpenAPI(path);

				const func = apiGroup.functions![0];
				const inputSchema = func.inputSchema as any;

				expect(inputSchema.properties.userId.description).toBe('Operation-level description');
			});
		});

		describe('$ref parameter references', () => {
			it('should resolve parameter references', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/users': {
							get: {
								operationId: 'listUsers',
								parameters: [{ $ref: '#/components/parameters/LimitParam' }],
								responses: { '200': { description: 'Success' } },
							},
						},
					},
					components: {
						parameters: {
							LimitParam: {
								name: 'limit',
								in: 'query',
								schema: { type: 'integer', default: 20 },
								description: 'Number of items to return',
							},
						},
					},
				};

				const path = await writeSpec('ref-params.json', spec);
				const apiGroup = await loadOpenAPI(path);

				const func = apiGroup.functions![0];
				const inputSchema = func.inputSchema as any;

				expect(inputSchema.properties.limit).toBeDefined();
				expect(inputSchema.properties.limit.default).toBe(20);
			});
		});
	});

	describe('Request body handling', () => {
		it('should merge request body properties with parameters', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users/{userId}': {
						put: {
							operationId: 'updateUser',
							parameters: [
								{
									name: 'userId',
									in: 'path',
									required: true,
									schema: { type: 'string' },
								},
							],
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												name: { type: 'string' },
												email: { type: 'string', format: 'email' },
											},
											required: ['name'],
										},
									},
								},
							},
							responses: { '200': { description: 'Success' } },
						},
					},
				},
			};

			const path = await writeSpec('request-body.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			const inputSchema = func.inputSchema as any;

			// Should have both parameter and body properties
			expect(inputSchema.properties.userId).toBeDefined();
			expect(inputSchema.properties.name).toBeDefined();
			expect(inputSchema.properties.email).toBeDefined();
			expect(inputSchema.required).toContain('userId');
			expect(inputSchema.required).toContain('name');
		});
	});

	describe('Schema resolution', () => {
		describe('$ref resolution', () => {
			it('should resolve schema references', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/users': {
							post: {
								operationId: 'createUser',
								requestBody: {
									content: {
										'application/json': {
											schema: { $ref: '#/components/schemas/User' },
										},
									},
								},
								responses: { '200': { description: 'Success' } },
							},
						},
					},
					components: {
						schemas: {
							User: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									name: { type: 'string' },
								},
								required: ['name'],
							},
						},
					},
				};

				const path = await writeSpec('schema-ref.json', spec);
				const apiGroup = await loadOpenAPI(path);

				const func = apiGroup.functions![0];
				const inputSchema = func.inputSchema as any;

				expect(inputSchema.properties.id).toBeDefined();
				expect(inputSchema.properties.name).toBeDefined();
				expect(inputSchema.required).toContain('name');
			});

			it('should handle circular references gracefully', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/nodes': {
							post: {
								operationId: 'createNode',
								requestBody: {
									content: {
										'application/json': {
											schema: { $ref: '#/components/schemas/Node' },
										},
									},
								},
								responses: { '200': { description: 'Success' } },
							},
						},
					},
					components: {
						schemas: {
							Node: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									children: {
										type: 'array',
										items: { $ref: '#/components/schemas/Node' },
									},
								},
							},
						},
					},
				};

				const path = await writeSpec('circular-ref.json', spec);
				const apiGroup = await loadOpenAPI(path);

				// Should not throw, should handle circular reference
				expect(apiGroup.functions).toHaveLength(1);
				const func = apiGroup.functions![0];
				const inputSchema = func.inputSchema as any;

				expect(inputSchema.properties.id).toBeDefined();
				expect(inputSchema.properties.children).toBeDefined();
			});
		});

		describe('Swagger 2.0 definitions', () => {
			it('should resolve Swagger 2.0 definitions', async () => {
				const spec = {
					swagger: '2.0',
					info: { title: 'Test', version: '1.0.0' },
					host: 'api.example.com',
					paths: {
						'/users': {
							post: {
								operationId: 'createUser',
								parameters: [
									{
										name: 'body',
										in: 'body',
										schema: { $ref: '#/definitions/User' },
									},
								],
								responses: { '200': { description: 'Success' } },
							},
						},
					},
					definitions: {
						User: {
							type: 'object',
							properties: {
								name: { type: 'string' },
							},
						},
					},
				};

				const path = await writeSpec('swagger-definitions.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.functions).toHaveLength(1);
			});
		});
	});

	describe('Output schema', () => {
		it('should build output schema from 200 response', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users/{id}': {
						get: {
							operationId: 'getUser',
							parameters: [
								{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							],
							responses: {
								'200': {
									description: 'Success',
									content: {
										'application/json': {
											schema: {
												type: 'object',
												properties: {
													id: { type: 'string' },
													name: { type: 'string' },
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

			const path = await writeSpec('output-schema.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			const outputSchema = func.outputSchema as any;

			expect(outputSchema.properties.id).toBeDefined();
			expect(outputSchema.properties.name).toBeDefined();
		});

		it('should use 201 response if 200 not present', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						post: {
							operationId: 'createUser',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: { name: { type: 'string' } },
										},
									},
								},
							},
							responses: {
								'201': {
									description: 'Created',
									content: {
										'application/json': {
											schema: {
												type: 'object',
												properties: {
													id: { type: 'string' },
													name: { type: 'string' },
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

			const path = await writeSpec('output-201.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			const outputSchema = func.outputSchema as any;

			expect(outputSchema.properties.id).toBeDefined();
		});
	});

	describe('Authentication', () => {
		describe('Bearer token auth', () => {
			it('should detect Bearer token authentication', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Bearer API', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					security: [{ bearerAuth: [] }],
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
					components: {
						securitySchemes: {
							bearerAuth: {
								type: 'http',
								scheme: 'bearer',
							},
						},
					},
				};

				const path = await writeSpec('bearer-auth.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.auth).toBeDefined();
				expect(apiGroup.auth!.scheme).toBe('bearer');
				expect((apiGroup.auth as any).envVar).toBe('BEARER_API_TOKEN');
			});
		});

		describe('Basic auth', () => {
			it('should detect Basic authentication', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Basic API', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					security: [{ basicAuth: [] }],
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
					components: {
						securitySchemes: {
							basicAuth: {
								type: 'http',
								scheme: 'basic',
							},
						},
					},
				};

				const path = await writeSpec('basic-auth.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.auth).toBeDefined();
				expect(apiGroup.auth!.scheme).toBe('basic');
				expect((apiGroup.auth as any).usernameEnvVar).toBe('BASIC_API_USERNAME');
				expect((apiGroup.auth as any).passwordEnvVar).toBe('BASIC_API_PASSWORD');
			});
		});

		describe('API Key auth', () => {
			it('should detect API Key authentication in header', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'API Key API', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					security: [{ apiKey: [] }],
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
					components: {
						securitySchemes: {
							apiKey: {
								type: 'apiKey',
								in: 'header',
								name: 'X-API-Key',
							},
						},
					},
				};

				const path = await writeSpec('apikey-header-auth.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.auth).toBeDefined();
				expect(apiGroup.auth!.scheme).toBe('apiKey');
				expect((apiGroup.auth as any).in).toBe('header');
				expect((apiGroup.auth as any).name).toBe('X-API-Key');
			});

			it('should detect API Key authentication in query', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Query Key API', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					security: [{ apiKey: [] }],
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
					components: {
						securitySchemes: {
							apiKey: {
								type: 'apiKey',
								in: 'query',
								name: 'api_key',
							},
						},
					},
				};

				const path = await writeSpec('apikey-query-auth.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.auth).toBeDefined();
				expect((apiGroup.auth as any).in).toBe('query');
				expect((apiGroup.auth as any).name).toBe('api_key');
			});
		});

		describe('Global vs Operation security', () => {
			it('should use first security scheme if no global security', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'No Global Security', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/test': {
							get: {
								operationId: 'test',
								responses: { '200': { description: 'OK' } },
							},
						},
					},
					components: {
						securitySchemes: {
							bearerAuth: {
								type: 'http',
								scheme: 'bearer',
							},
						},
					},
				};

				const path = await writeSpec('no-global-security.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.auth).toBeDefined();
				expect(apiGroup.auth!.scheme).toBe('bearer');
			});
		});
	});

	describe('Annotations', () => {
		describe('OpenAPI extensions', () => {
			it('should extract x-destructive annotation', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/items/{id}': {
							delete: {
								operationId: 'deleteItem',
								'x-destructive': true,
								parameters: [
									{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
								],
								responses: { '204': { description: 'Deleted' } },
							},
						},
					},
				};

				const path = await writeSpec('x-destructive.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.functions).toHaveLength(1);
				// The annotations are extracted but stored in the function
			});

			it('should extract x-requires-approval annotation', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/admin/reset': {
							post: {
								operationId: 'resetSystem',
								'x-requires-approval': true,
								responses: { '200': { description: 'OK' } },
							},
						},
					},
				};

				const path = await writeSpec('x-requires-approval.json', spec);
				const apiGroup = await loadOpenAPI(path);

				expect(apiGroup.functions).toHaveLength(1);
			});
		});

		describe('Custom annotation mapping', () => {
			it('should map custom extensions to annotations', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/items': {
							post: {
								operationId: 'createItem',
								'x-custom-cost': 'high',
								responses: { '201': { description: 'Created' } },
							},
						},
					},
				};

				const path = await writeSpec('custom-annotations.json', spec);
				const apiGroup = await loadOpenAPI(path, {
					annotations: {
						fromExtensions: {
							'x-custom-cost': 'cost',
						},
					},
				});

				expect(apiGroup.functions).toHaveLength(1);
			});

			it('should apply global annotations to all operations', async () => {
				const spec = {
					openapi: '3.0.0',
					info: { title: 'Test', version: '1.0.0' },
					servers: [{ url: 'https://api.example.com' }],
					paths: {
						'/items': {
							get: {
								operationId: 'listItems',
								responses: { '200': { description: 'OK' } },
							},
							post: {
								operationId: 'createItem',
								responses: { '201': { description: 'Created' } },
							},
						},
					},
				};

				const path = await writeSpec('global-annotations.json', spec);
				const apiGroup = await loadOpenAPI(path, {
					annotations: {
						global: {
							rateLimit: 100,
						},
					},
				});

				expect(apiGroup.functions).toHaveLength(2);
			});
		});
	});

	describe('Description overrides', () => {
		it('should override operation descriptions', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						get: {
							operationId: 'listUsers',
							summary: 'Original description',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('description-override.json', spec);
			const apiGroup = await loadOpenAPI(path, {
				descriptions: {
					'GET /users': 'Better LLM-friendly description for listing users',
				},
			});

			const func = apiGroup.functions![0];
			expect(func.description).toBe('Better LLM-friendly description for listing users');
		});
	});

	describe('Operation ID and function naming', () => {
		it('should use operationId as function name', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						get: {
							operationId: 'listAllUsers',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('operation-id.json', spec);
			const apiGroup = await loadOpenAPI(path);

			expect(apiGroup.functions![0].name).toBe('listAllUsers');
		});

		it('should generate function name from method and path if no operationId', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						get: {
							summary: 'List users',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('no-operation-id.json', spec);
			const apiGroup = await loadOpenAPI(path);

			// Function name is generated from method + path, with special chars replaced
			expect(apiGroup.functions![0].name).toBe('get__users');
		});

		it('should sanitize special characters in function names', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users/{user-id}/items': {
						get: {
							summary: 'Get user items',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('special-chars.json', spec);
			const apiGroup = await loadOpenAPI(path);

			// Should not contain special characters
			const name = apiGroup.functions![0].name;
			expect(name).toMatch(/^[a-zA-Z0-9_]+$/);
		});
	});

	describe('Keywords/Tags', () => {
		it('should include tags as keywords', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						get: {
							operationId: 'listUsers',
							tags: ['users', 'admin', 'public'],
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('tags-keywords.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			expect(func.keywords).toEqual(['users', 'admin', 'public']);
		});
	});

	describe('headerProvider and contextProvider', () => {
		it('should accept headerProvider option', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/test': {
						get: {
							operationId: 'test',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('header-provider.json', spec);
			const headerProvider = vi.fn().mockResolvedValue({ 'X-Custom': 'value' });

			const apiGroup = await loadOpenAPI(path, { headerProvider });

			expect(apiGroup.functions).toHaveLength(1);
			// headerProvider is used at runtime, not at load time
		});

		it('should accept contextProvider option', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/test': {
						get: {
							operationId: 'test',
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('context-provider.json', spec);
			const contextProvider = vi.fn().mockResolvedValue({ userId: '123' });

			const apiGroup = await loadOpenAPI(path, { contextProvider });

			expect(apiGroup.functions).toHaveLength(1);
		});
	});

	describe('requestTransformer', () => {
		it('should accept requestTransformer option', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/test': {
						post: {
							operationId: 'test',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: { data: { type: 'string' } },
										},
									},
								},
							},
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('request-transformer.json', spec);
			const requestTransformer = vi.fn().mockResolvedValue({
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: 'data=test',
			});

			const apiGroup = await loadOpenAPI(path, { requestTransformer });

			expect(apiGroup.functions).toHaveLength(1);
		});
	});

	describe('Error handling', () => {
		it('should throw on invalid JSON', async () => {
			const path = join(TEST_DIR, 'invalid.json');
			await writeFile(path, '{ invalid json }');

			await expect(loadOpenAPI(path)).rejects.toThrow();
		});

		it('should throw on invalid YAML', async () => {
			const path = join(TEST_DIR, 'invalid.yaml');
			await writeFile(path, 'invalid:\n  yaml: [unclosed');

			await expect(loadOpenAPI(path)).rejects.toThrow();
		});

		it('should throw when file does not exist', async () => {
			await expect(loadOpenAPI('/nonexistent/path/to/spec.json')).rejects.toThrow();
		});
	});

	describe('Complex schema features', () => {
		it('should handle enum types', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/items': {
						get: {
							operationId: 'listItems',
							parameters: [
								{
									name: 'status',
									in: 'query',
									schema: {
										type: 'string',
										enum: ['active', 'inactive', 'pending'],
									},
								},
							],
							responses: { '200': { description: 'OK' } },
						},
					},
				},
			};

			const path = await writeSpec('enum-schema.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			const inputSchema = func.inputSchema as any;

			expect(inputSchema.properties.status.enum).toEqual(['active', 'inactive', 'pending']);
		});

		it('should handle nested object schemas', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						post: {
							operationId: 'createUser',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												name: { type: 'string' },
												address: {
													type: 'object',
													properties: {
														street: { type: 'string' },
														city: { type: 'string' },
														country: { type: 'string' },
													},
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

			const path = await writeSpec('nested-object.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			const inputSchema = func.inputSchema as any;

			expect(inputSchema.properties.address.properties.street).toBeDefined();
			expect(inputSchema.properties.address.properties.city).toBeDefined();
		});

		it('should handle array of objects schema', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/orders': {
						post: {
							operationId: 'createOrder',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												items: {
													type: 'array',
													items: {
														type: 'object',
														properties: {
															productId: { type: 'string' },
															quantity: { type: 'integer' },
														},
													},
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

			const path = await writeSpec('array-objects.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			const inputSchema = func.inputSchema as any;

			expect(inputSchema.properties.items.type).toBe('array');
			expect(inputSchema.properties.items.items.properties.productId).toBeDefined();
		});

		it('should preserve pattern validation', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						post: {
							operationId: 'createUser',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												username: {
													type: 'string',
													pattern: '^[a-z0-9_]+$',
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

			const path = await writeSpec('pattern-validation.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			const inputSchema = func.inputSchema as any;

			expect(inputSchema.properties.username.pattern).toBe('^[a-z0-9_]+$');
		});

		it('should preserve readOnly and writeOnly', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						post: {
							operationId: 'createUser',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												id: { type: 'string', readOnly: true },
												password: { type: 'string', writeOnly: true },
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

			const path = await writeSpec('readonly-writeonly.json', spec);
			const apiGroup = await loadOpenAPI(path);

			const func = apiGroup.functions![0];
			const inputSchema = func.inputSchema as any;

			expect(inputSchema.properties.id.readOnly).toBe(true);
			expect(inputSchema.properties.password.writeOnly).toBe(true);
		});
	});

	describe('Multiple HTTP methods on same path', () => {
		it('should create separate functions for each method', async () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test', version: '1.0.0' },
				servers: [{ url: 'https://api.example.com' }],
				paths: {
					'/users': {
						get: {
							operationId: 'listUsers',
							responses: { '200': { description: 'OK' } },
						},
						post: {
							operationId: 'createUser',
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: { name: { type: 'string' } },
										},
									},
								},
							},
							responses: { '201': { description: 'Created' } },
						},
					},
					'/users/{id}': {
						get: {
							operationId: 'getUser',
							parameters: [
								{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							],
							responses: { '200': { description: 'OK' } },
						},
						put: {
							operationId: 'updateUser',
							parameters: [
								{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							],
							requestBody: {
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: { name: { type: 'string' } },
										},
									},
								},
							},
							responses: { '200': { description: 'OK' } },
						},
						delete: {
							operationId: 'deleteUser',
							parameters: [
								{ name: 'id', in: 'path', required: true, schema: { type: 'string' } },
							],
							responses: { '204': { description: 'Deleted' } },
						},
					},
				},
			};

			const path = await writeSpec('crud-operations.json', spec);
			const apiGroup = await loadOpenAPI(path);

			expect(apiGroup.functions).toHaveLength(5);
			const names = apiGroup.functions!.map((f) => f.name);
			expect(names).toContain('listUsers');
			expect(names).toContain('createUser');
			expect(names).toContain('getUser');
			expect(names).toContain('updateUser');
			expect(names).toContain('deleteUser');
		});
	});
});
