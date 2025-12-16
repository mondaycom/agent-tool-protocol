import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentToolProtocolClient } from '../client.js';
import { ToolNames, type Tool } from './types.js';

export const fetchAllApisInputSchema = z.object({
	apiGroups: z.array(z.string()).optional().describe('Optional: Specific API groups to include'),
});

type FetchAllApisInput = z.infer<typeof fetchAllApisInputSchema>;

export function createFetchAllApisTool(client: AgentToolProtocolClient): Tool<FetchAllApisInput> {
	return {
		name: ToolNames.FETCH_ALL_APIS,
		description:
			'Get TypeScript definitions of all available APIs. Returns code showing api.add, api.getTodo, etc.',
		inputSchema: zodToJsonSchema(fetchAllApisInputSchema) as any,
		zodSchema: fetchAllApisInputSchema,
		func: async (_input: FetchAllApisInput) => {
			try {
				const typescript = client.getTypeDefinitions();
				return JSON.stringify(
					{
						success: true,
						typescript,
						message: 'Use this TypeScript to understand available api.* functions',
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
