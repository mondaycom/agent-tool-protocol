import type { AgentToolProtocolClient, Tool } from '@mondaydotcomorg/atp-client';

/**
 * MCP tool handler result
 */
export interface MCPToolResult {
	content: Array<{ type: 'text'; text: string }>;
	isError?: boolean;
}

/**
 * MCP Server interface (minimal subset needed for tool registration)
 */
export interface MCPServerLike {
	tool(
		name: string,
		description: string,
		schema: Record<string, unknown>,
		handler: (args: Record<string, unknown>) => Promise<MCPToolResult>
	): void;
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
 *
 * @example
 * ```typescript
 * const tools = client.getATPTools().filter(t => t.name !== 'search_api');
 * registerToolsWithMCP(tools, mcpServer);
 * ```
 */
export function registerToolsWithMCP(tools: Tool[], mcpServer: MCPServerLike): void {
	for (const tool of tools) {
		const schema = {
			type: tool.inputSchema.type,
			properties: tool.inputSchema.properties || {},
			required: tool.inputSchema.required || [],
		};

		mcpServer.tool(tool.name, tool.description || '', schema, async (args: Record<string, unknown>) => {
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
		});
	}
}

