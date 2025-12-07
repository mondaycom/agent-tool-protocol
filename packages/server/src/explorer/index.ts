import type { APIGroupConfig, CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';
import { filterApiGroups } from '../core/request-scope.js';

interface TreeNode {
	type: 'directory' | 'function';
	name: string;
	description?: string;
	children?: Map<string, TreeNode>;
	functionDef?: {
		func: CustomFunctionDef;
		group: string;
	};
}

interface ExploreDirectoryResult {
	type: 'directory';
	path: string;
	items: Array<{ name: string; type: 'directory' | 'function'; description?: string }>;
}

interface ExploreFunctionResult {
	type: 'function';
	path: string;
	name: string;
	description: string;
	definition: string;
	group: string;
	inputSchema?: any;
	outputSchema?: any;
}

export type ExploreResult = ExploreDirectoryResult | ExploreFunctionResult;

/**
 * ExplorerService provides filesystem-like navigation of API groups.
 * Enables progressive discovery of APIs by allowing agents to explore
 * tool hierarchies on-demand rather than loading everything upfront.
 */
export class ExplorerService {
	private root: TreeNode;
	private apiGroups: APIGroupConfig[];

	constructor(apiGroups: APIGroupConfig[]) {
		this.apiGroups = apiGroups;
		this.root = { type: 'directory', name: '/', children: new Map() };
		this.buildTree(apiGroups);
	}

	/**
	 * Get filtering context based on current request's tool rules.
	 * Returns sets for allowed items and all known items (for filtering).
	 */
	private getFilterContext(): {
		allowedTypes: Set<string>;
		allowedGroups: Set<string>;
		allowedTools: Set<string>;
		allGroups: Set<string>;
	} {
		const allowedGroups = filterApiGroups(this.apiGroups);

		const context = {
			allowedTypes: new Set<string>(),
			allowedGroups: new Set<string>(),
			allowedTools: new Set<string>(),
			allGroups: new Set(this.apiGroups.map((g) => g.name)),
		};

		for (const group of allowedGroups) {
			if (group.type !== 'graphql') {
				context.allowedTypes.add(group.type);
			}
			context.allowedGroups.add(group.name);
			if (group.functions) {
				for (const func of group.functions) {
					context.allowedTools.add(`${group.name}:${func.name}`);
				}
			}
		}

		return context;
	}

	/**
	 * Check if a directory should be visible based on filter context.
	 */
	private isDirectoryAllowed(
		name: string,
		currentPath: string,
		ctx: ReturnType<typeof this.getFilterContext>
	): boolean {
		const API_TYPES = ['openapi', 'mcp', 'custom', 'graphql'];

		if (currentPath === '/' && API_TYPES.includes(name)) {
			return ctx.allowedTypes.has(name) || ctx.allowedGroups.has(name);
		}

		if (ctx.allGroups.has(name)) {
			return ctx.allowedGroups.has(name);
		}

		return true;
	}

	/**
	 * Builds the virtual filesystem tree from API groups
	 */
	private buildTree(apiGroups: APIGroupConfig[]): void {
		for (const group of apiGroups) {
			if (!group.functions || group.functions.length === 0) continue;

			const groupFolder =
				group.type === 'graphql'
					? this.ensureDirectory(this.root, group.name, group.description)
					: this.ensureDirectory(
							this.ensureDirectory(this.root, group.type),
							group.name,
							group.description
						);

			for (const func of group.functions) {
				const segments = this.extractSegments(func, group);

				if (segments.length > 1) {
					let current = groupFolder;
					for (let i = 0; i < segments.length - 1; i++) {
						current = this.ensureDirectory(current, segments[i]!);
					}
					this.addFunction(current, segments[segments.length - 1]!, func, group.name);
				} else {
					this.addFunction(groupFolder, func.name, func, group.name);
				}
			}
		}
	}

	/**
	 * Extract path segments for organizing functions
	 */
	private extractSegments(func: CustomFunctionDef, group: APIGroupConfig): string[] {
		if (group.type === 'graphql') {
			const name = func.name;
			if (name.startsWith('query_')) {
				return ['query', name.replace('query_', '')];
			}
			if (name.startsWith('mutation_')) {
				return ['mutation', name.replace('mutation_', '')];
			}
		}

		if (group.type === 'openapi') {
			const name = func.name;

			const camelSplit = name.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\b)/g);
			if (camelSplit && camelSplit.length > 2) {
				const verb = camelSplit[0].toLowerCase();
				const isVerb = [
					'get',
					'list',
					'create',
					'update',
					'delete',
					'post',
					'put',
					'patch',
				].includes(verb);

				if (isVerb) {
					const resource = camelSplit.slice(1).join('_').toLowerCase();
					return [resource, name];
				}
			}

			if (name.includes('_')) {
				const parts = name.split('_');
				if (parts.length > 1 && parts[0]) {
					return [parts[0], name];
				}
			}

			if (name.includes('-')) {
				const parts = name.split('-');
				if (parts.length > 1 && parts[0]) {
					return [parts[0], name];
				}
			}
		}

		return [func.name];
	}

	/**
	 * Ensures a directory exists at the given path
	 */
	private ensureDirectory(parent: TreeNode, name: string, description?: string): TreeNode {
		if (!parent.children) {
			parent.children = new Map();
		}

		let child = parent.children.get(name);
		if (!child) {
			child = { type: 'directory', name, description, children: new Map() };
			parent.children.set(name, child);
		} else if (description && !child.description) {
			child.description = description;
		}

		return child;
	}

	/**
	 * Adds a function to the tree
	 */
	private addFunction(
		parent: TreeNode,
		name: string,
		func: CustomFunctionDef,
		group: string
	): void {
		if (!parent.children) {
			parent.children = new Map();
		}

		parent.children.set(name, {
			type: 'function',
			name,
			functionDef: { func, group },
		});
	}

	/**
	 * Explores the filesystem at the given path.
	 * Tool rules are automatically applied from the request scope.
	 * @param path - The path to explore
	 */
	explore(path: string): ExploreResult | null {
		const ctx = this.getFilterContext();
		const normalizedPath = this.normalizePath(path);
		const segments = normalizedPath === '/' ? [] : normalizedPath.split('/').filter((s) => s);

		let current = this.root;
		let currentPath = '/';

		for (const segment of segments) {
			if (!current.children || !current.children.has(segment)) {
				return null;
			}
			current = current.children.get(segment)!;
			currentPath = currentPath === '/' ? `/${segment}` : `${currentPath}/${segment}`;
		}

		if (current.type === 'directory') {
			const items: Array<{ name: string; type: 'directory' | 'function'; description?: string }> =
				[];
			if (current.children) {
				for (const [name, node] of current.children) {
					// Filter directories and functions based on tool rules
					if (node.type === 'directory') {
						if (!this.isDirectoryAllowed(name, currentPath, ctx)) continue;
					} else if (node.type === 'function' && node.functionDef) {
						if (!ctx.allowedTools.has(`${node.functionDef.group}:${name}`)) continue;
					}

					const item: { name: string; type: 'directory' | 'function'; description?: string } = {
						name,
						type: node.type,
					};
					if (node.description) {
						item.description = node.description;
					} else if (node.type === 'function' && node.functionDef?.func.description) {
						item.description = node.functionDef.func.description;
					}
					items.push(item);
				}
			}
			items.sort((a, b) => {
				if (a.type === b.type) {
					return a.name.localeCompare(b.name);
				}
				return a.type === 'directory' ? -1 : 1;
			});

			return {
				type: 'directory',
				path: currentPath,
				items,
			};
		} else {
			if (!current.functionDef) {
				return null;
			}

			const { func, group } = current.functionDef;

			if (!ctx.allowedTools.has(`${group}:${func.name}`)) {
				return null;
			}

			const definition = this.generateFunctionDefinition(func, group);

			return {
				type: 'function',
				path: currentPath,
				name: func.name,
				description: func.description,
				definition,
				group,
				inputSchema: func.inputSchema,
				outputSchema: func.outputSchema,
			};
		}
	}

	/**
	 * Normalizes a path (removes trailing slashes, ensures leading slash)
	 */
	private normalizePath(path: string): string {
		if (!path || path === '') return '/';

		if (!path.startsWith('/')) {
			path = '/' + path;
		}

		if (path !== '/' && path.endsWith('/')) {
			path = path.slice(0, -1);
		}

		return path;
	}

	/**
	 * Generates TypeScript function signature showing how to call the function.
	 */
	private generateFunctionDefinition(func: CustomFunctionDef, group: string): string {
		const inputType = this.generateInputType(func.inputSchema);
		const groupPath = group.replace(/\//g, '.');
		const outputType = func.outputSchema ? this.generateOutputType(func.outputSchema) : 'unknown';
		return `async function api.${groupPath}.${func.name}(${inputType}): Promise<${outputType}>`;
	}

	/**
	 * Generates TypeScript type from JSON schema
	 */
	private generateInputType(schema?: {
		properties?: Record<string, any>;
		required?: string[];
	}): string {
		if (!schema || !schema.properties) {
			return '{}';
		}

		const props: string[] = [];
		const required = schema.required || [];

		for (const [key, value] of Object.entries(schema.properties)) {
			const isRequired = required.includes(key);
			const prop = value as { type?: string; description?: string };
			const tsType = this.jsonSchemaTypeToTS(prop.type ?? 'any');
			const optional = isRequired ? '' : '?';
			props.push(`${key}${optional}: ${tsType}`);
		}

		return `{ ${props.join('; ')} }`;
	}

	/**
	 * Generates output type from JSON schema
	 */
	private generateOutputType(schema: { properties?: Record<string, any> }): string {
		if (!schema.properties) {
			return 'unknown';
		}

		const props: string[] = [];
		for (const [key, value] of Object.entries(schema.properties)) {
			const prop = value as { type?: string };
			const tsType = this.jsonSchemaTypeToTS(prop.type ?? 'any');
			props.push(`${key}: ${tsType}`);
		}

		return `{ ${props.join('; ')} }`;
	}

	/**
	 * Converts JSON Schema type to TypeScript type
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
				return 'any[]';
			case 'object':
				return 'Record<string, any>';
			default:
				return 'any';
		}
	}
}
