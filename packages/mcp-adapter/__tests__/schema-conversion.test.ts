import { convertMCPInputSchema, convertMCPToolToFunction } from '../src/schema-utils';

describe('MCP Schema Conversion', () => {
	describe('convertMCPInputSchema', () => {
		it('should handle undefined schema', () => {
			const result = convertMCPInputSchema(undefined);

			expect(result.type).toBe('object');
			expect(result.properties).toEqual({});
		});

		it('should handle null schema', () => {
			const result = convertMCPInputSchema(null);

			expect(result.type).toBe('object');
			expect(result.properties).toEqual({});
		});

		it('should handle schema without type', () => {
			const result = convertMCPInputSchema({
				properties: {
					name: { type: 'string' },
				},
			});

			expect(result.type).toBe('object');
			expect(result.properties).toEqual({ name: { type: 'string' } });
		});

		it('should handle schema without properties', () => {
			const result = convertMCPInputSchema({
				type: 'object',
			});

			expect(result.type).toBe('object');
			expect(result.properties).toEqual({});
		});

		it('should preserve required fields', () => {
			const result = convertMCPInputSchema({
				type: 'object',
				properties: {
					name: { type: 'string' },
					age: { type: 'number' },
				},
				required: ['name'],
			});

			expect(result.required).toEqual(['name']);
		});

		it('should preserve description', () => {
			const result = convertMCPInputSchema({
				type: 'object',
				description: 'A test schema',
				properties: {},
			});

			expect(result.description).toBe('A test schema');
		});

		it('should preserve additional JSON Schema fields', () => {
			const result = convertMCPInputSchema({
				type: 'object',
				properties: {
					email: { type: 'string', format: 'email' },
					count: { type: 'integer', minimum: 0, maximum: 100 },
				},
				additionalProperties: false,
			});

			expect(result.additionalProperties).toBe(false);
			expect((result.properties as any).email.format).toBe('email');
			expect((result.properties as any).count.minimum).toBe(0);
		});

		it('should handle array type schema', () => {
			const result = convertMCPInputSchema({
				type: 'array',
				items: { type: 'string' },
			});

			expect(result.type).toBe('array');
			expect(result.items).toEqual({ type: 'string' });
		});

		it('should handle empty required array', () => {
			const result = convertMCPInputSchema({
				type: 'object',
				properties: { name: { type: 'string' } },
				required: [],
			});

			// Empty required array should not be included
			expect(result.required).toBeUndefined();
		});

		it('should handle complex nested schema', () => {
			const result = convertMCPInputSchema({
				type: 'object',
				properties: {
					user: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							address: {
								type: 'object',
								properties: {
									street: { type: 'string' },
									city: { type: 'string' },
								},
							},
						},
					},
				},
			});

			expect(result.type).toBe('object');
			expect((result.properties as any).user.type).toBe('object');
			expect((result.properties as any).user.properties.address.properties.city.type).toBe(
				'string'
			);
		});
	});

	describe('convertMCPToolToFunction', () => {
		it('should convert a basic MCP tool definition', async () => {
			const mockHandler = async () => ({ result: 'success' });
			const tool = {
				name: 'test_tool',
				description: 'A test tool',
				inputSchema: {
					type: 'object',
					properties: {
						input: { type: 'string' },
					},
					required: ['input'],
				},
			};

			const func = convertMCPToolToFunction(tool, mockHandler);

			expect(func.name).toBe('test_tool');
			expect(func.description).toBe('A test tool');
			expect(func.inputSchema.type).toBe('object');
			expect((func.inputSchema.properties as any).input.type).toBe('string');
			expect(func.inputSchema.required).toEqual(['input']);
		});

		it('should provide default description when missing', () => {
			const mockHandler = async () => ({});
			const tool = {
				name: 'unnamed_tool',
			};

			const func = convertMCPToolToFunction(tool, mockHandler);

			expect(func.description).toBe('MCP tool: unnamed_tool');
		});

		it('should handle tool without inputSchema', () => {
			const mockHandler = async () => ({});
			const tool = {
				name: 'no_schema_tool',
				description: 'Tool without schema',
			};

			const func = convertMCPToolToFunction(tool, mockHandler);

			expect(func.inputSchema.type).toBe('object');
			expect(func.inputSchema.properties).toEqual({});
		});
	});
});


