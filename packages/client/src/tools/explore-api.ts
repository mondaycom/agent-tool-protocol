import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentToolProtocolClient } from '../client.js';
import { ToolNames, type Tool } from './types.js';

export const exploreApiInputSchema = z.object({
	paths: z
		.union([z.string(), z.array(z.string()).min(1)])
		.describe(
			'Path(s) to explore. Can be a single string like "/" or an array like ["/openapi/github", "/mcp/filesystem"]'
		),
});

type ExploreApiInput = z.infer<typeof exploreApiInputSchema>;

interface ExploreResult {
	success: boolean;
	path: string;
	type?: 'directory' | 'function';
	items?: Array<{ name: string; type: string }>;
	name?: string;
	description?: string;
	definition?: unknown;
	group?: string;
	error?: string;
}

function normalizePaths(paths: string | string[]): string[] {
	return Array.isArray(paths) ? paths : [paths];
}

export function createExploreApiTool(client: AgentToolProtocolClient): Tool<ExploreApiInput> {
	return {
		name: ToolNames.EXPLORE_API,
		description:
			'Explore APIs using filesystem-like navigation. Navigate through directories to discover available functions. Provide path as a string like "/" or paths as an array like ["/openapi", "/mcp"] to explore multiple at once.',
		inputSchema: zodToJsonSchema(exploreApiInputSchema) as any,
		zodSchema: exploreApiInputSchema,
		func: async (input: ExploreApiInput) => {
			const pathsToExplore = normalizePaths(input.paths);

			const results: ExploreResult[] = await Promise.all(
				pathsToExplore.map(async (path) => {
					try {
						const result = await client.exploreAPI(path);

						if (result.type === 'directory') {
							return {
								success: true,
								type: 'directory' as const,
								path: result.path,
								items: result.items,
							};
						} else {
							return {
								success: true,
								type: 'function' as const,
								name: result.name,
								description: result.description,
								definition: result.definition,
								group: result.group,
								path: result.path,
							};
						}
					} catch (error: unknown) {
						const message = error instanceof Error ? error.message : String(error);
						return {
							success: false,
							path,
							error: message,
						};
					}
				})
			);

			return JSON.stringify(results, null, 2);
		},
	};
}
