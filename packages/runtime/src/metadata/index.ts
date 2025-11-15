/**
 * Metadata and Type Generation Utilities
 */

export type { RuntimeAPIParam, RuntimeAPIMethod, RuntimeAPIMetadata } from './types.js';
export { RuntimeAPI, RuntimeMethod } from './decorators.js';
export type { RuntimeAPIName } from './generated.js';

import type { RuntimeAPIMetadata } from './types.js';
import type { RuntimeAPIName } from './generated.js';
import { TYPE_REGISTRY } from './generated.js';

interface ClientServices {
	hasLLM: boolean;
	hasApproval: boolean;
	hasEmbedding: boolean;
	hasTools: boolean;
}

/**
 * Generates TypeScript definitions from runtime API metadata
 * @param apis - Runtime API metadata
 * @param options - Optional filtering options
 */
export function generateRuntimeTypes(
	apis: RuntimeAPIMetadata[],
	options?: {
		clientServices?: ClientServices;
		requestedApis?: RuntimeAPIName[];
	}
): string {
	let filteredApis = apis;

	if (options?.requestedApis && options.requestedApis.length > 0) {
		const requestedApis = options.requestedApis.map((api) => apis.find((a) => a.name === api));
		filteredApis = requestedApis.filter((api) => api !== undefined);
	} else if (options?.clientServices) {
		filteredApis = apis.filter((api) => {
			if (api.name === 'llm' && !options.clientServices!.hasLLM) return false;
			if (api.name === 'approval' && !options.clientServices!.hasApproval) return false;
			if (api.name === 'embedding' && !options.clientServices!.hasEmbedding) return false;
			if (api.name === 'progress') return false;
			return true;
		});
	} else {
		filteredApis = apis.filter((api) => api.name === 'cache');
	}

	let typescript = '// Runtime SDK Type Definitions\n\n';

	const usedTypes = new Set<string>();
	for (const api of filteredApis) {
		for (const method of api.methods) {
			const allTypes = [method.returns, ...method.params.map((p) => p.type)].join(' ');
			const typeMatches = allTypes.match(/\b[A-Z][a-zA-Z]+\b/g);
			if (typeMatches) {
				typeMatches.forEach((t) => usedTypes.add(t));
			}
		}
	}

	for (const type of TYPE_REGISTRY) {
		const typeNameMatch = type.definition.match(/(?:interface|type)\s+([A-Z][a-zA-Z]+)/);
		const typeName = typeNameMatch?.[1];
		if (typeName && usedTypes.has(typeName)) {
			typescript += `${type.definition}\n\n`;
		}
	}

	typescript += '// Runtime SDK\ndeclare const atp: {\n';

	for (const api of filteredApis) {
		typescript += `  /**\n`;
		for (const line of api.description.split('\n')) {
			typescript += `   * ${line}\n`;
		}
		typescript += `   */\n`;

		typescript += `  ${api.name}: {\n`;

		for (const method of api.methods) {
			typescript += `    /**\n`;
			typescript += `     * ${method.description}\n`;

			for (const param of method.params) {
				if (param.description) {
					typescript += `     * @param ${param.name} - ${param.description}\n`;
				}
			}

			if (method.returns !== 'void') {
				const returnDesc = method.returns.startsWith('Promise')
					? 'Promise resolving to result'
					: 'Result value';
				typescript += `     * @returns ${returnDesc}\n`;
			}

			typescript += `     */\n`;

			const paramStrings = method.params.map((p) => {
				const optional = p.optional ? '?' : '';
				const type = p.type.includes('\n') ? p.type.replace(/\n/g, '\n      ') : p.type;
				return `${p.name}${optional}: ${type}`;
			});

			typescript += `    ${method.name}(${paramStrings.join(', ')}): ${method.returns};\n`;

			typescript += `\n`;
		}

		typescript += `  };\n\n`;
	}

	typescript += '};\n\n';

	return typescript;
}
