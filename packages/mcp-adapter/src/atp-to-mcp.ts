import type { AgentToolProtocolClient, Tool } from '@mondaydotcomorg/atp-client';

/**
 * MCP tool handler result
 */
export interface MCPToolResult {
	content: Array<{ type: 'text'; text: string }>;
	isError?: boolean;
}

/**
 * MCP Server interface - supports both legacy (v0.x) and modern (v1.x) SDK.
 *
 * Uses minimal duck-typing to avoid TypeScript variance issues with the
 * MCP SDK's complex generic callback signatures.
 */
export interface MCPServerLike {
	registerTool?: Function;
	tool?: Function;
}

/**
 * Registers ATP tools with an MCP server.
 *
 * @example
 * ```typescript
 * import { Server } from '@modelcontextprotocol/sdk/server/index.js';
 * import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
 * import { registerATPTools } from '@mondaydotcomorg/atp-mcp-adapter';
 *
 * const client = new AgentToolProtocolClient({ baseUrl: 'http://localhost:3000' });
 * await client.init();
 * await client.connect();
 *
 * const mcpServer = new Server({ name: 'my-server', version: '1.0.0' }, { capabilities: { tools: {} } });
 * registerATPTools(client, mcpServer);
 * ```
 */
export function registerATPTools(client: AgentToolProtocolClient, mcpServer: MCPServerLike): void {
	const tools = client.getATPTools();
	registerToolsWithMCP(tools, mcpServer);
}

/**
 * Registers an array of ATP tools with an MCP server.
 * Use this if you want more control over which tools to register.
 * Supports both MCP SDK v0.x and v1.x APIs.
 *
 * @example
 * ```typescript
 * const tools = client.getATPTools().filter(t => t.name !== 'search_api');
 * registerToolsWithMCP(tools, mcpServer);
 * ```
 */
export function registerToolsWithMCP(tools: Tool[], mcpServer: MCPServerLike): void {
	for (const tool of tools) {
		const handler = async (args: Record<string, unknown>): Promise<MCPToolResult> => {
			try {
				const result = await tool.func(args);
				const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
				return {
					content: [{ type: 'text' as const, text: resultText }],
				};
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: 'text' as const, text: `Error: ${errorMessage}` }],
					isError: true,
				};
			}
		};

		if (typeof mcpServer.registerTool === 'function') {
			const inputSchema = tool.zodSchema?.shape ?? {};
			mcpServer.registerTool(
				tool.name,
				{
					description: tool.description || '',
					inputSchema,
				},
				handler
			);
		} else if (typeof mcpServer.tool === 'function') {
			const jsonSchema = {
				type: tool.inputSchema.type,
				properties: tool.inputSchema.properties || {},
				required: tool.inputSchema.required || [],
			};
			mcpServer.tool(tool.name, tool.description || '', jsonSchema, handler);
		} else {
			throw new Error(
				'MCP server does not have a compatible tool registration method. Expected registerTool() or tool() method.'
			);
		}
	}
}
