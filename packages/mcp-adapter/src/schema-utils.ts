import type { CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';

export interface MCPToolSchema {
	type?: string;
	properties?: Record<string, unknown>;
	required?: string[];
	description?: string;
	[key: string]: unknown;
}

export interface MCPToolDefinition {
	name: string;
	description?: string;
	inputSchema?: MCPToolSchema;
}

export function convertMCPInputSchema(inputSchema: unknown): {
	type: string;
	properties?: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
} {
	const schema = inputSchema as MCPToolSchema | undefined;

	if (!schema) {
		return { type: 'object', properties: {} };
	}

	const result: Record<string, unknown> = {};
	result.type = schema.type || 'object';

	if (result.type === 'object') {
		result.properties = schema.properties || {};
	} else if (schema.properties) {
		result.properties = schema.properties;
	}

	if (schema.required && schema.required.length > 0) {
		result.required = schema.required;
	}

	if (schema.description) {
		result.description = schema.description;
	}

	const knownFields = new Set(['type', 'properties', 'required', 'description']);
	for (const [key, value] of Object.entries(schema)) {
		if (!knownFields.has(key) && value !== undefined) {
			result[key] = value;
		}
	}

	return result as {
		type: string;
		properties?: Record<string, unknown>;
		required?: string[];
		[key: string]: unknown;
	};
}

export function convertMCPToolToFunction(
	tool: MCPToolDefinition,
	handler: (input: unknown) => Promise<unknown>
): CustomFunctionDef {
	return {
		name: tool.name,
		description: tool.description || `MCP tool: ${tool.name}`,
		inputSchema: convertMCPInputSchema(tool.inputSchema),
		handler,
	};
}
