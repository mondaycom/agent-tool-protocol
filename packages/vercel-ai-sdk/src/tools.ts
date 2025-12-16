import { z } from 'zod';
import { VercelAIATPClient } from './client.js';
import type { CreateATPToolsOptions, ATPToolsResult, StreamingToolsOptions } from './types.js';
import { createToolsFromATPClient, ToolNames } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus } from '@mondaydotcomorg/atp-protocol';
import { tool } from 'ai';
import { createVercelEventHandler, type UIMessageStreamWriter } from './event-adapter.js';

export async function createATPTools(options: CreateATPToolsOptions): Promise<ATPToolsResult> {
	const { defaultExecutionConfig, ...clientOptions } = options;

	const client = new VercelAIATPClient(clientOptions);
	await client.connect();

	const atpTools = createToolsFromATPClient(client.getUnderlyingClient());

	const vercelTools: Record<string, any> = {};

	for (const atpTool of atpTools) {
		if (atpTool.name === ToolNames.EXECUTE_CODE) {
			vercelTools.atp_execute_code = tool({
				description:
					atpTool.description ||
					'Execute TypeScript code in ATP sandbox with access to runtime APIs (atp.llm.*, atp.embedding.*, atp.approval.*)',
				parameters: z.object({
					code: z.string().describe('TypeScript code to execute in the ATP sandbox'),
				}),
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
		} else {
			const toolName = `atp_${atpTool.name}`;
			vercelTools[toolName] = tool({
				description: atpTool.description || '',
				parameters: atpTool.zodSchema || z.object({}),
				execute: async (input: any) => {
					try {
						const result = await atpTool.func(input);
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
		}
	}

	vercelTools.atp_get_type_definitions = tool({
		description:
			'Get TypeScript type definitions for ATP runtime APIs to understand available functions',
		parameters: z.object({}),
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
		parameters: z.object({
			code: z.string().describe('TypeScript code to execute in the ATP sandbox'),
		}),
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

	vercelTools.atp_get_type_definitions = tool({
		description:
			'Get TypeScript type definitions for ATP runtime APIs to understand available functions',
		parameters: z.object({}),
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
