/**
 * LangGraph Tools Integration for ATP
 *
 * Creates LangChain-compatible tools from ATP with full support for:
 * - LangGraph interrupts for human-in-the-loop approvals
 * - LLM sampling via LangChain models
 * - Checkpoint-based state persistence
 */

import { Tool, DynamicTool, DynamicStructuredTool } from '@langchain/core/tools';
import { type JSONSchema } from '@langchain/core/utils/json_schema';
import {
	LangGraphATPClient,
	type LangGraphATPClientOptions,
	ApprovalRequiredException,
} from './langgraph-client.js';
import {
	createToolsFromATPClient,
	ToolNames,
	type Tool as ATPTool,
} from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, type ExecutionConfig } from '@mondaydotcomorg/atp-protocol';

/**
 * Options for creating ATP tools with LangGraph integration
 */
export interface CreateATPToolsOptions extends LangGraphATPClientOptions {
	/**
	 * Default execution config for all ATP code executions
	 */
	defaultExecutionConfig?: Partial<ExecutionConfig>;
}

/**
 * Result of creating ATP tools
 */
export interface ATPToolsResult {
	/** The LangGraph-aware ATP client */
	client: LangGraphATPClient;
	/** LangChain tools for agent use */
	tools: (Tool | DynamicStructuredTool)[];
	/**
	 * Helper to check if an error is an approval request
	 */
	isApprovalRequired: (error: any) => error is ApprovalRequiredException;
	/**
	 * Helper to resume after approval
	 */
	resumeWithApproval: (executionId: string, approved: boolean, reason?: string) => Promise<any>;
}

/**
 * Creates LangChain tools from ATP server with LangGraph interrupt support
 *
 * Example usage with LangGraph:
 * ```typescript
 * import { StateGraph } from "@langchain/langgraph";
 * import { MemorySaver } from "@langchain/langgraph";
 * import { ChatOpenAI } from "@langchain/openai";
 *
 * const llm = new ChatOpenAI({ modelName: "gpt-4" });
 * const { client, tools, isApprovalRequired, resumeWithApproval } = await createATPTools({
 *   serverUrl: 'http://localhost:3333',
 *   headers: { Authorization: 'Bearer test-key' }, // Optional
 *   llm,
 * });
 *
 * // Use tools in LangGraph agent
 * const graph = new StateGraph({...})
 *   .addNode("agent", agentNode)
 *   .addNode("approval", async (state) => {
 *     // Human reviews state.approvalRequest
 *     return interrupt({ value: state.approvalRequest });
 *   });
 *
 * const checkpointer = new MemorySaver();
 * const app = graph.compile({
 *   checkpointer,
 *   interruptBefore: ["approval"]
 * });
 * ```
 */
export async function createATPTools(options: CreateATPToolsOptions): Promise<ATPToolsResult> {
	const { serverUrl, server, defaultExecutionConfig, ...clientOptions } = options;

	const client = new LangGraphATPClient({
        server,
        serverUrl,
        ...clientOptions,
	});

	await client.connect();

	const atpTools = createToolsFromATPClient(client.getUnderlyingClient());

	const tools = atpTools.map((atpTool: ATPTool) => {
		if (atpTool.name === ToolNames.EXECUTE_CODE) {
			class ATPExecuteTool extends Tool {
				name = `atp_${atpTool.name}`;
				description = atpTool.description || 'Execute TypeScript code in ATP sandbox';

				async _call(input: string): Promise<string> {
					try {
						let code: string;
						try {
							const parsed = JSON.parse(input);
							code = parsed.code || input;
						} catch {
							code = input;
						}

						const result = await client.execute(code, defaultExecutionConfig);

						if (result.result.status === ExecutionStatus.COMPLETED) {
							return JSON.stringify(
								{
									success: true,
									result: result.result.result,
									stats: result.result.stats,
								},
								null,
								2
							);
						} else if (result.result.status === ExecutionStatus.FAILED) {
							return JSON.stringify(
								{
									success: false,
									error: result.result.error,
									stats: result.result.stats,
								},
								null,
								2
							);
						} else {
							return JSON.stringify(
								{
									success: false,
									error: 'Execution in unexpected state: ' + result.result.status,
								},
								null,
								2
							);
						}
					} catch (error: any) {
						if (error instanceof ApprovalRequiredException) {
							throw error;
						}
						return JSON.stringify(
							{
								success: false,
								error: error.message || 'Unknown error',
							},
							null,
							2
						);
					}
				}
			}

			return new ATPExecuteTool();
		}

		return new DynamicStructuredTool({
			name: `atp_${atpTool.name}`,
			description: atpTool.description || '',
			schema: atpTool.zodSchema || (atpTool.inputSchema as JSONSchema),
			func: async (input: any) => {
				try {
					const result = await atpTool.func(input);
					return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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
		});
	});

	return {
		client,
		tools,
		isApprovalRequired: (error: any): error is ApprovalRequiredException => {
			return error instanceof ApprovalRequiredException;
		},
		resumeWithApproval: async (executionId: string, approved: boolean, reason?: string) => {
			return await client.resumeWithApproval(executionId, approved, reason);
		},
	};
}

/**
 * Helper to create a simple ATP tool for existing LangGraph agents
 *
 * This creates a single tool that can execute ATP code. For more control,
 * use createATPTools() directly.
 */
export async function createSimpleATPTool(
	serverUrl: string,
	llm: any,
	headers?: Record<string, string>
): Promise<Tool | DynamicStructuredTool> {
	const result = await createATPTools({
		serverUrl,
		headers,
		llm,
	});
	const tool = result.tools.find((t) => t.name === `atp_${ToolNames.EXECUTE_CODE}`);
	if (!tool) {
		throw new Error('Failed to create ATP execute_code tool');
	}
	return tool;
}
