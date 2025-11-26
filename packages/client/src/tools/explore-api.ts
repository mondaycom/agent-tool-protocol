import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentToolProtocolClient } from '../client.js';
import { ToolNames, type Tool } from './types.js';

const exploreApiInputSchema = z.object({
	path: z
		.string()
		.describe('Path to explore (e.g., "/", "/openapi/github", "/mcp/filesystem/read_file")'),
});

type ExploreApiInput = z.infer<typeof exploreApiInputSchema>;

export function createExploreApiTool(client: AgentToolProtocolClient): Tool<ExploreApiInput> {
	return {
		name: ToolNames.EXPLORE_API,
		description:
			'Explore APIs using filesystem-like navigation. Navigate through directories to discover available functions. Provide path as string like "/", "/openapi", "/openapi/github", or "/openapi/github/repos/createRepo" to see functions.',
		inputSchema: zodToJsonSchema(exploreApiInputSchema) as any,
		zodSchema: exploreApiInputSchema,
		func: async (input: ExploreApiInput) => {
			try {
				const result = await client.exploreAPI(input.path);

				if (result.type === 'directory') {
					return JSON.stringify(
						{
							success: true,
							type: 'directory',
							path: result.path,
							items: result.items,
						},
						null,
						2
					);
				} else {
					return JSON.stringify(
						{
							success: true,
							type: 'function',
							name: result.name,
							description: result.description,
							definition: result.definition,
							usage: result.usage,
							group: result.group,
							path: result.path,
						},
						null,
						2
					);
				}
			} catch (error: any) {
				return JSON.stringify(
					{
						success: false,
						error: error.message,
					},
					null,
					2
				);
			}
		},
	};
}
