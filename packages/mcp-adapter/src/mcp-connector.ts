import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { APIGroupConfig, CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';
import { convertMCPInputSchema } from './schema-utils.js';
import type { MCPStdioServerConfig, MCPSSEServerConfig, MCPServerConfig } from './types.js';

interface MCPServerConfigLegacy {
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
}

/**
 * MCPConnector connects to MCP servers and converts their tools to Agent Tool Protocol format.
 */
export class MCPConnector {
	private clients: Map<string, Client> = new Map();
	private currentClient: Client | null = null;
	private currentServerName: string | null = null;

	/**
	 * Fetches all tools from an MCP server, handling pagination if present.
	 */
	private async fetchAllTools(client: Client): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>> {
		const allTools: Array<{ name: string; description?: string; inputSchema: unknown }> = [];
		let cursor: string | undefined;

		do {
			const toolsResult = await client.listTools(cursor ? { cursor } : undefined);
			const tools = toolsResult.tools || [];
			allTools.push(...tools);
			cursor = toolsResult.nextCursor;
		} while (cursor);

		return allTools;
	}

	/**
	 * Connects to an MCP server using stdio transport.
	 * @param config - MCP stdio server configuration
	 * @returns APIGroupConfig with converted tools
	 */
	async connectToStdioServer(config: MCPStdioServerConfig): Promise<APIGroupConfig> {
		const transport = new StdioClientTransport({
			command: config.command,
			args: config.args,
			env: config.env,
		});

		const client = new Client(
			{ name: 'agent-tool-protocol-connector', version: '1.0.0' },
			{ capabilities: {} }
		);

		await client.connect(transport);
		this.clients.set(config.name, client);
		this.currentClient = client;
		this.currentServerName = config.name;

		const tools = await this.fetchAllTools(client);

		const functions: CustomFunctionDef[] = tools.map((tool) => {
			const inputSchema = convertMCPInputSchema(tool.inputSchema);

			return {
				name: tool.name,
				description: tool.description || `MCP tool: ${tool.name}`,
				inputSchema,
				handler: async (input: unknown) => {
					const result = await client.callTool({
						name: tool.name,
						arguments: input as Record<string, unknown>,
					});
					return result.content;
				},
			};
		});

		return {
			name: config.name,
			type: 'mcp',
			functions,
		};
	}

	/**
	 * Connects to an MCP server using SSE transport.
	 * @param config - MCP SSE server configuration
	 * @returns APIGroupConfig with converted tools
	 */
	async connectToSSEServer(config: MCPSSEServerConfig): Promise<APIGroupConfig> {
		const transport = new SSEClientTransport(new URL(config.serverUrl), {
			requestInit: { headers: config.headers || {} },
		});

		const client = new Client(
			{ name: 'agent-tool-protocol-connector', version: '1.0.0' },
			{ capabilities: {} }
		);

		await client.connect(transport);
		this.clients.set(config.name, client);
		this.currentClient = client;
		this.currentServerName = config.name;

		const tools = await this.fetchAllTools(client);

		const functions: CustomFunctionDef[] = tools.map((tool) => {
			const inputSchema = convertMCPInputSchema(tool.inputSchema);

			return {
				name: tool.name,
				description: tool.description || `MCP tool: ${tool.name}`,
				inputSchema,
				handler: async (input: unknown) => {
					const result = await client.callTool({
						name: tool.name,
						arguments: input as Record<string, unknown>,
					});
					return result.content;
				},
			};
		});

		return {
			name: config.name,
			type: 'mcp',
			functions,
		};
	}

	/**
	 * Connects to an MCP server and retrieves its tools.
	 * @param config - MCP server configuration (supports both stdio and SSE)
	 * @returns APIGroupConfig with converted tools
	 */
	async connectToMCPServer(config: MCPServerConfig | MCPServerConfigLegacy): Promise<APIGroupConfig> {
		if ('transport' in config) {
			if (config.transport === 'sse') {
				return this.connectToSSEServer(config);
			}
			return this.connectToStdioServer(config);
		}

		// Legacy support: treat as stdio config
		return this.connectToStdioServer({
			name: config.name,
			transport: 'stdio',
			command: config.command,
			args: config.args,
			env: config.env,
		});
	}

	/**
	 * Connects to multiple MCP servers.
	 * @param configs - Array of MCP server configurations
	 * @returns Array of APIGroupConfig objects
	 */
	async connectToMultipleServers(configs: MCPServerConfig[]): Promise<APIGroupConfig[]> {
		return Promise.all(configs.map((config) => this.connectToMCPServer(config)));
	}

	/**
	 * Disconnects from all MCP servers.
	 */
	async disconnectAll(): Promise<void> {
		const disconnectPromises = Array.from(this.clients.values()).map(async (client) => {
			try {
				await client.close();
			} catch (error) {}
		});
		await Promise.all(disconnectPromises);
		this.clients.clear();
	}

	/**
	 * Gets a connected MCP client by name.
	 * @param name - Server name
	 * @returns MCP Client or undefined
	 */
	getClient(name: string): Client | undefined {
		return this.clients.get(name);
	}

	/**
	 * Lists all tools from the currently connected MCP server.
	 * @returns Array of tools
	 */
	async listTools(): Promise<unknown[]> {
		if (!this.currentClient) {
			throw new Error('Not connected to any MCP server');
		}
		const toolsResult = await this.currentClient.listTools();
		return toolsResult.tools || [];
	}

	/**
	 * Lists all prompts from the currently connected MCP server.
	 * @returns Array of prompts
	 */
	async listPrompts(): Promise<unknown[]> {
		if (!this.currentClient) {
			throw new Error('Not connected to any MCP server');
		}
		try {
			const promptsResult = await this.currentClient.listPrompts();
			return promptsResult.prompts || [];
		} catch (error) {
			return [];
		}
	}

	/**
	 * Calls a tool on the currently connected MCP server.
	 * @param name - Tool name
	 * @param input - Tool input parameters
	 * @returns Tool execution result
	 */
	async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
		if (!this.currentClient) {
			throw new Error('Not connected to any MCP server');
		}
		const result = await this.currentClient.callTool({
			name,
			arguments: input,
		});
		return result.content;
	}
}
