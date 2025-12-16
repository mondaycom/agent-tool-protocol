import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentToolProtocolClient } from '../client.js';
import { ToolNames, type Tool } from './types.js';

export const searchApiInputSchema = z.object({
	query: z.string().describe('Search query string'),
});

type SearchApiInput = z.infer<typeof searchApiInputSchema>;

export function createSearchApiTool(client: AgentToolProtocolClient): Tool<SearchApiInput> {
	return {
		name: ToolNames.SEARCH_API,
		description:
			'Search for APIs by keyword. Provide search term as string like "add", "math", "user", etc.',
		inputSchema: zodToJsonSchema(searchApiInputSchema) as any,
		zodSchema: searchApiInputSchema,
		func: async (input: SearchApiInput) => {
			try {
				const results = await client.searchAPI(input.query);
				return JSON.stringify(
					{
						success: true,
						results: results.map((r) => ({
							apiGroup: r.apiGroup,
							functionName: r.functionName,
							description: r.description,
							signature: r.signature,
						})),
						count: results.length,
					},
					null,
					2
				);
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
