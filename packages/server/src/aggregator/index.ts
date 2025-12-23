import type { APIGroupConfig, CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';
import { GENERATED_METADATA, generateRuntimeTypes } from '@mondaydotcomorg/atp-runtime';
import type { RuntimeAPIName } from '@mondaydotcomorg/atp-runtime';

/**
 * APIAggregator generates TypeScript type definitions from API configurations.
 * Converts API group definitions into TypeScript declarations for use in code generation.
 */
export class APIAggregator {
	private apiGroups: APIGroupConfig[];

	/**
	 * Creates a new APIAggregator instance.
	 * @param apiGroups - Array of API group configurations
	 */
	constructor(apiGroups: APIGroupConfig[]) {
		this.apiGroups = apiGroups;
	}

	/**
	 * Generates TypeScript type definitions for selected API groups.
	 * @param selectedGroups - Optional array of group names to include
	 * @returns TypeScript definition string
	 */
	async generateTypeScript(selectedGroups?: string[]): Promise<string> {
		const groups = selectedGroups
			? this.apiGroups.filter((g) => selectedGroups.includes(g.name))
			: this.apiGroups;

		let typescript = `// Agent Tool Protocol Runtime SDK v1.0.0\n\n`;

		typescript += this.generateRuntimeTypes();

		for (const group of groups) {
			typescript += `\n// API Group: ${group.name}\n`;
			if (group.functions) {
				for (const func of group.functions) {
					typescript += this.generateFunctionTypes(func, group.name);
				}
			}
		}

		typescript += this.generateAPINamespace(groups);

		return typescript;
	}

	/**
	 * Generates TypeScript definitions for the runtime SDK.
	 * @param options - Optional filtering options
	 * @returns TypeScript definition string
	 */
	public generateRuntimeTypes(options?: {
		clientServices?: {
			hasLLM: boolean;
			hasApproval: boolean;
			hasEmbedding: boolean;
			hasTools: boolean;
		};
		requestedApis?: RuntimeAPIName[];
	}): string {
		return generateRuntimeTypes(GENERATED_METADATA, options);
	}

	/**
	 * Generates TypeScript types for a single function.
	 * @param func - Function definition
	 * @param groupName - API group name
	 * @returns TypeScript definition string
	 */
	private generateFunctionTypes(func: CustomFunctionDef, groupName: string): string {
		const inputTypeName = `${func.name}_Input`;
		const outputTypeName = `${func.name}_Output`;

		let typescript = `\ninterface ${inputTypeName} {\n`;
		if (func.inputSchema?.properties) {
			const required = func.inputSchema.required || [];
			for (const [key, value] of Object.entries(func.inputSchema.properties)) {
				const prop = value as { type?: string; description?: string };
				const tsType = this.jsonSchemaTypeToTS(prop.type ?? 'any');
				const comment = prop.description ? ` // ${prop.description}` : '';
				const optional = required.includes(key) ? '' : '?';
				typescript += `  ${key}${optional}: ${tsType};${comment}\n`;
			}
		}
		typescript += `}\n`;

		typescript += `\ninterface ${outputTypeName} {\n`;

		if (func.outputSchema) {
			const outputType = this.jsonSchemaToTSInterface(func.outputSchema);
			typescript += outputType;
		} else {
			typescript += `  [key: string]: unknown;\n`;
		}

		typescript += `}\n`;

		return typescript;
	}

	/**
	 * Converts JSON Schema type to TypeScript type.
	 * @param type - JSON Schema type string
	 * @returns TypeScript type string
	 */
	private jsonSchemaTypeToTS(type: string): string {
		switch (type) {
			case 'string':
				return 'string';
			case 'number':
			case 'integer':
				return 'number';
			case 'boolean':
				return 'boolean';
			case 'array':
				return 'unknown[]';
			case 'object':
				return 'Record<string, unknown>';
			default:
				return 'unknown';
		}
	}

	/**
	 * Converts a full JSON Schema to TypeScript interface properties
	 * @param schema - JSON Schema object
	 * @param depth - Current recursion depth (prevents infinite recursion)
	 * @returns TypeScript interface properties string
	 */
	private jsonSchemaToTSInterface(schema: any, depth = 0): string {
		// Prevent infinite recursion
		if (depth > 3) {
			return '  [key: string]: unknown;\n';
		}

		// Handle array types - for arrays, we treat the interface as array-indexable
		if (schema.type === 'array' && schema.items) {
			const itemType = this.schemaToTSType(schema.items, depth + 1);
			// Generate array-like interface
			return `  [index: number]: ${itemType};\n  length: number;\n`;
		}

		// Handle object types with properties
		if (schema.type === 'object' && schema.properties) {
			const required = schema.required || [];
			let result = '';

			for (const [key, value] of Object.entries(schema.properties)) {
				const prop = value as any;
				const optional = required.includes(key) ? '' : '?';
				const tsType = this.schemaToTSType(prop, depth + 1);
				result += `  ${key}${optional}: ${tsType};\n`;
			}

			return result || '  [key: string]: unknown;\n';
		}

		// Fallback for simple types or unknown structures
		return '  [key: string]: unknown;\n';
	}

	/**
	 * Converts any JSON Schema to a TypeScript type expression
	 * @param schema - JSON Schema object
	 * @param depth - Current recursion depth
	 * @returns TypeScript type expression
	 */
	private schemaToTSType(schema: any, depth = 0): string {
		if (!schema) return 'unknown';

		// Prevent infinite recursion
		if (depth > 3) {
			return 'unknown';
		}

		// Handle array types
		if (schema.type === 'array') {
			if (schema.items) {
				const itemType = this.schemaToTSType(schema.items, depth + 1);
				return `${itemType}[]`;
			}
			return 'unknown[]';
		}

		// Handle enum types
		if (schema.enum) {
			return schema.enum.map((v: any) => `"${v}"`).join(' | ') || 'string';
		}

		// Handle object types with properties
		if (schema.type === 'object' && schema.properties) {
			const required = schema.required || [];
			const props: string[] = [];

			for (const [key, value] of Object.entries(schema.properties)) {
				const prop = value as any;
				const optional = required.includes(key) ? '' : '?';
				const tsType = this.schemaToTSType(prop, depth + 1);
				props.push(`${key}${optional}: ${tsType}`);
			}

			if (props.length > 0) {
				return `{ ${props.join('; ')} }`;
			}
			return 'Record<string, unknown>';
		}

		// Handle simple types
		if (schema.type) {
			return this.jsonSchemaTypeToTS(schema.type);
		}

		return 'unknown';
	}

	/**
	 * Helper to check if a string is a valid JavaScript identifier
	 */
	private isValidIdentifier(name: string): boolean {
		return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
	}

	/**
	 * Helper to safely format a property name for TypeScript type definitions
	 * Returns the property name with quotes if needed, or just the name if valid
	 */
	private formatPropertyName(name: string): string {
		if (!this.isValidIdentifier(name)) {
			return `'${name}'`;
		}
		return name;
	}

	/**
	 * Generates the API namespace with all function declarations.
	 * Handles hierarchical group names (e.g., "github/readOnly" -> api.github.readOnly)
	 * @param groups - API groups to include
	 * @returns TypeScript definition string
	 */
	private generateAPINamespace(groups: APIGroupConfig[]): string {
		interface NestedGroup {
			functions: CustomFunctionDef[];
			subgroups: Map<string, NestedGroup>;
		}

		const rootGroups = new Map<string, NestedGroup>();

		for (const group of groups) {
			if (!group.functions || group.functions.length === 0) continue;

			const parts = group.name.split('/');
			let current = rootGroups;

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i]!;

				if (!current.has(part)) {
					current.set(part, { functions: [], subgroups: new Map() });
				}

				const node = current.get(part)!;

				if (i === parts.length - 1) {
					node.functions.push(...group.functions);
				}

				current = node.subgroups;
			}
		}

		const generateLevel = (groups: Map<string, NestedGroup>, indent: string): string => {
			let ts = '';

			for (const [name, node] of groups.entries()) {
				if (!name) continue;
				const formattedName = this.formatPropertyName(name);
				ts += `${indent}${formattedName}: {\n`;

				for (const func of node.functions) {
					if (!func.name) continue;
					const funcName = this.formatPropertyName(func.name);
					const description =
						func.description && typeof func.description === 'string'
							? func.description.replace(/\n/g, ' ').substring(0, 200)
							: '';
					ts += `${indent}  /**\n${indent}   * ${description}\n${indent}   */\n`;
					ts += `${indent}  ${funcName}(params: ${func.name}_Input): Promise<${func.name}_Output>;\n`;
				}

				if (node.subgroups.size > 0) {
					ts += generateLevel(node.subgroups, indent + '  ');
				}

				ts += `${indent}};\n`;
			}

			return ts;
		};

		let typescript = `\ndeclare const api: {\n`;
		typescript += generateLevel(rootGroups, '  ');
		typescript += `};\n`;
		typescript += `\nexport { api };\n`;

		return typescript;
	}

	/**
	 * Gets the list of available API group names.
	 * @returns Array of API group names
	 */
	getApiGroups(): string[] {
		return this.apiGroups.map((g) => g.name);
	}

	/**
	 * Generates a compact TypeScript definition for a single function.
	 * Includes input types with inline descriptions and compact output type.
	 * @param func - Function definition
	 * @param groupName - API group name
	 * @returns Compact TypeScript definition string
	 */
	generateCompactFunctionDefinition(func: CustomFunctionDef, groupName: string): string {
		const groupPath = groupName.replace(/\//g, '.');
		const inputType = this.generateCompactInputType(func.inputSchema);
		const outputType = func.outputSchema
			? this.generateCompactOutputType(func.outputSchema)
			: 'unknown';
		return `async function api.${groupPath}.${func.name}(${inputType}): Promise<${outputType}>`;
	}

	/**
	 * Generates compact input type with inline descriptions
	 */
	private generateCompactInputType(schema?: {
		properties?: Record<string, any>;
		required?: string[];
	}): string {
		if (!schema || !schema.properties) {
			return '{}';
		}

		const props: string[] = [];
		const required = schema.required || [];

		for (const [key, value] of Object.entries(schema.properties)) {
			const prop = value as { type?: string; description?: string; enum?: any[] };
			const isRequired = required.includes(key);
			const tsType = prop.enum
				? prop.enum.map((v: any) => `"${v}"`).join(' | ')
				: this.jsonSchemaTypeToTS(prop.type ?? 'unknown');
			const optional = isRequired ? '' : '?';

			if (prop.description) {
				const desc = prop.description.replace(/\n/g, ' ').substring(0, 100);
				props.push(`/* ${desc} */ ${key}${optional}: ${tsType}`);
			} else {
				props.push(`${key}${optional}: ${tsType}`);
			}
		}

		return `{ ${props.join('; ')} }`;
	}

	/**
	 * Generates compact output type with inline descriptions (top-level fields only, limited count)
	 */
	private generateCompactOutputType(schema: { properties?: Record<string, any> }): string {
		if (!schema.properties) {
			return 'unknown';
		}

		const keys = Object.keys(schema.properties);
		if (keys.length === 0) {
			return 'unknown';
		}

		const maxFields = 6;
		const displayKeys = keys.slice(0, maxFields);
		const props = displayKeys.map((key) => {
			const prop = schema.properties![key] as { type?: string; description?: string };
			const tsType = this.jsonSchemaTypeToTS(prop.type ?? 'unknown');

			if (prop.description) {
				const desc = prop.description.replace(/\n/g, ' ').substring(0, 80);
				return `/* ${desc} */ ${key}: ${tsType}`;
			}
			return `${key}: ${tsType}`;
		});

		if (keys.length > maxFields) {
			return `{ ${props.join('; ')}; /* +${keys.length - maxFields} more */ }`;
		}
		return `{ ${props.join('; ')} }`;
	}
}
