import { z } from 'zod';
import { VercelAIATPClient } from './client.js';
import type { CreateATPToolsOptions, ATPToolsResult, StreamingToolsOptions } from './types.js';
import {
	ToolNames,
	executeCodeInputSchema,
	exploreApiInputSchema,
	searchApiInputSchema,
	fetchAllApisInputSchema,
} from '@mondaydotcomorg/atp-client';
import { ExecutionStatus } from '@mondaydotcomorg/atp-protocol';
import { tool } from 'ai';
import { createVercelEventHandler } from './event-adapter.js';

const TOOL_SCHEMAS = {
	[ToolNames.EXECUTE_CODE]: executeCodeInputSchema.pick({ code: true }),
	[ToolNames.EXPLORE_API]: exploreApiInputSchema,
	[ToolNames.SEARCH_API]: searchApiInputSchema,
	[ToolNames.FETCH_ALL_APIS]: fetchAllApisInputSchema,
} as const;

export async function createATPTools(options: CreateATPToolsOptions): Promise<ATPToolsResult> {
	const { defaultExecutionConfig, ...clientOptions } = options;

	const client = new VercelAIATPClient(clientOptions);
	await client.connect();

	const underlyingClient = client.getUnderlyingClient();
	const vercelTools: Record<string, any> = {};

	vercelTools.atp_execute_code = tool({
		description:
			'Execute TypeScript code in ATP sandbox with access to runtime APIs (atp.llm.*, atp.embedding.*, atp.approval.*)',
		inputSchema: TOOL_SCHEMAS[ToolNames.EXECUTE_CODE],
		execute: async ({ code }: { code: string }) => {
			try {
				const result = await client.execute(code, defaultExecutionConfig);

				if (result.status === ExecutionStatus.COMPLETED) {
					return {
						success: true,
						result: result.result,
						stats: result.stats,
					};
				} else if (result.status === ExecutionStatus.FAILED) {
					return {
						success: false,
						error: result.error,
						stats: result.stats,
					};
				} else {
					return {
						success: false,
						error: 'Execution in unexpected state: ' + result.status,
					};
				}
			} catch (error: any) {
				return {
					success: false,
					error: error.message || 'Unknown error',
				};
			}
		},
	});

	vercelTools.atp_explore_api = tool({
		description:
			'Explore APIs using filesystem-like navigation. Navigate through directories to discover available functions.',
		inputSchema: TOOL_SCHEMAS[ToolNames.EXPLORE_API],
		execute: async ({ path }: { path: string }) => {
			try {
				const result = await underlyingClient.exploreAPI(path, {
					toolRules: defaultExecutionConfig?.toolRules,
				});
				return {
					success: true,
					result,
				};
			} catch (error: any) {
				return {
					success: false,
					error: error.message,
				};
			}
		},
	});

	vercelTools.atp_search_api = tool({
		description:
			'Search for APIs by keyword. Provide search term as string like "add", "math", "user", etc.',
		inputSchema: TOOL_SCHEMAS[ToolNames.SEARCH_API],
		execute: async ({ query }: { query: string }) => {
			try {
				const results = await underlyingClient.searchAPI(query, {
					query,
					toolRules: defaultExecutionConfig?.toolRules,
				});
				return {
					success: true,
					results: results.map((r: any) => ({
						apiGroup: r.apiGroup,
						functionName: r.functionName,
						description: r.description,
						signature: r.signature,
					})),
					count: results.length,
				};
			} catch (error: any) {
				return {
					success: false,
					error: error.message,
				};
			}
		},
	});

	vercelTools.atp_get_type_definitions = tool({
		description:
			'Get TypeScript type definitions for ATP runtime APIs to understand available functions',
		inputSchema: z.object({}),
		execute: async () => {
			try {
				const types = client.getTypeDefinitions();
				return {
					success: true,
					types,
				};
			} catch (error: any) {
				return {
					success: false,
					error: error.message,
				};
			}
		},
	});

	return {
		client,
		tools: vercelTools,
	};
}

/**
 * Creates ATP tools with streaming event support.
 * Events from tool execution will be forwarded to the provided dataStream.
 *
 * @param options - Tool creation options including dataStream for event forwarding
 * @returns Promise resolving to client and tools with streaming support
 *
 * @example
 * ```typescript
 * // In your Vercel AI SDK route handler
 * const dataStream = createUIMessageStream({...});
 *
 * const { tools } = await createATPStreamingTools({
 *   serverUrl: 'http://localhost:3333',
 *   model: openai('gpt-4'),
 *   dataStream,
 * });
 *
 * // Use tools in streamText
 * const result = streamText({
 *   model: openai('gpt-4'),
 *   messages,
 *   tools,
 * });
 * ```
 */
export async function createATPStreamingTools(
	options: StreamingToolsOptions
): Promise<ATPToolsResult> {
	const { dataStream, defaultExecutionConfig, ...clientOptions } = options;

	const client = new VercelAIATPClient(clientOptions);
	await client.connect();

	const eventHandler = createVercelEventHandler(dataStream);
	const underlyingClient = client.getUnderlyingClient();

	const vercelTools: Record<string, any> = {};

	vercelTools.atp_execute_code = tool({
		description:
			'Execute TypeScript code in ATP sandbox with streaming events for thinking, tool execution, and text output',
		inputSchema: TOOL_SCHEMAS[ToolNames.EXECUTE_CODE],
		execute: async ({ code }: { code: string }) => {
			try {
				const result = await underlyingClient.executeStream(
					code,
					defaultExecutionConfig,
					eventHandler
				);

				if (result.status === ExecutionStatus.COMPLETED) {
					return {
						success: true,
						result: result.result,
						stats: result.stats,
					};
				} else if (result.status === ExecutionStatus.FAILED) {
					return {
						success: false,
						error: result.error,
						stats: result.stats,
					};
				} else {
					return {
						success: false,
						error: 'Execution in unexpected state: ' + result.status,
					};
				}
			} catch (error: any) {
				return {
					success: false,
					error: error.message || 'Unknown error',
				};
			}
		},
	});

	vercelTools.atp_explore_api = tool({
		description:
			'Explore APIs using filesystem-like navigation. Navigate through directories to discover available functions.',
		inputSchema: TOOL_SCHEMAS[ToolNames.EXPLORE_API],
		execute: async ({ path }: { path: string }) => {
			try {
				const result = await underlyingClient.exploreAPI(path, {
					toolRules: defaultExecutionConfig?.toolRules,
				});
				return {
					success: true,
					result,
				};
			} catch (error: any) {
				return {
					success: false,
					error: error.message,
				};
			}
		},
	});

	vercelTools.atp_search_api = tool({
		description:
			'Search for APIs by keyword. Provide search term as string like "add", "math", "user", etc.',
		inputSchema: TOOL_SCHEMAS[ToolNames.SEARCH_API],
		execute: async ({ query }: { query: string }) => {
			try {
				const results = await underlyingClient.searchAPI(query, {
					query,
					toolRules: defaultExecutionConfig?.toolRules,
				});
				return {
					success: true,
					results: results.map((r: any) => ({
						apiGroup: r.apiGroup,
						functionName: r.functionName,
						description: r.description,
						signature: r.signature,
					})),
					count: results.length,
				};
			} catch (error: any) {
				return {
					success: false,
					error: error.message,
				};
			}
		},
	});

	vercelTools.atp_get_type_definitions = tool({
		description:
			'Get TypeScript type definitions for ATP runtime APIs to understand available functions',
		inputSchema: z.object({}),
		execute: async () => {
			try {
				const types = client.getTypeDefinitions();
				return {
					success: true,
					types,
				};
			} catch (error: any) {
				return {
					success: false,
					error: error.message,
				};
			}
		},
	});

	return {
		client,
		tools: vercelTools,
	};
}
