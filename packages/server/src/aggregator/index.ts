import type { APIGroupConfig, CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';
import {
	GENERATED_METADATA,
	generateRuntimeTypes,
} from '@mondaydotcomorg/atp-runtime';
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
		typescript += `  [key: string]: unknown;\n`;
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
}
