import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ExecutionStatus } from '@mondaydotcomorg/atp-protocol';
import type { AgentToolProtocolClient } from '../client.js';
import { ToolNames, type Tool } from './types.js';

const executeCodeInputSchema = z.object({
	code: z.string().describe('The JavaScript/TypeScript code to execute'),
	timeout: z.number().optional().describe('Execution timeout in milliseconds (default: 30000)'),
	maxMemory: z.number().optional().describe('Maximum memory in bytes (default: 128MB)'),
});

type ExecuteCodeInput = z.infer<typeof executeCodeInputSchema>;

export function createExecuteCodeTool(client: AgentToolProtocolClient): Tool<ExecuteCodeInput> {
	return {
		name: ToolNames.EXECUTE_CODE,
		description:
			"Execute JavaScript/TypeScript code to call APIs. IMPORTANT: Code MUST use 'return' statement to see results. Examples: 'return api.groupName.functionName({})' or 'const result = api.group.func({}); return result'. Use bracket notation for dynamic names: api['groupName']['functionName']({}).",
		inputSchema: zodToJsonSchema(executeCodeInputSchema) as any,
		zodSchema: executeCodeInputSchema,
		func: async (input: ExecuteCodeInput) => {
			try {
				const result = await client.execute(input.code, {
					timeout: input.timeout,
					maxMemory: input.maxMemory,
				});

				if (result.status === ExecutionStatus.COMPLETED) {
					return JSON.stringify(
						{
							success: true,
							result: result.result,
							stats: {
								duration: result.stats.duration,
								memoryUsed: result.stats.memoryUsed,
							},
						},
						null,
						2
					);
				} else if (result.status === ExecutionStatus.FAILED) {
					return JSON.stringify(
						{
							success: false,
							error: result.error?.message || 'Execution failed',
							stack: result.error?.stack,
							message: 'Code execution failed. Check syntax and fix errors.',
						},
						null,
						2
					);
				} else {
					return JSON.stringify(
						{
							success: false,
							error: 'Execution timed out',
							message: 'Code took too long. Simplify or optimize.',
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
						message: 'Failed to execute code',
					},
					null,
					2
				);
			}
		},
	};
}
