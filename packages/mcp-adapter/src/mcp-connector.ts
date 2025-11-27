import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { APIGroupConfig, CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';
import { convertMCPInputSchema } from './schema-utils.js';

interface MCPServerConfig {
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
	 * Connects to an MCP server and retrieves its tools.
	 * @param config - MCP server configuration
	 * @returns APIGroupConfig with converted tools
	 */
	async connectToMCPServer(config: MCPServerConfig): Promise<APIGroupConfig> {
		const transport = new StdioClientTransport({
			command: config.command,
			args: config.args,
			env: config.env,
		});

		const client = new Client(
			{
				name: 'agent-tool-protocol-connector',
				version: '1.0.0',
			},
			{
				capabilities: {},
			}
		);

		await client.connect(transport);
		this.clients.set(config.name, client);
		this.currentClient = client;
		this.currentServerName = config.name;

		const toolsResult = await client.listTools();
		const tools = toolsResult.tools || [];

		const functions: CustomFunctionDef[] = tools.map(
			(tool: { name: string; description?: string; inputSchema: unknown }) => {
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
			}
		);

		return {
			name: config.name,
			type: 'mcp',
			functions,
		};
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
	async listTools(): Promise<any[]> {
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
	async listPrompts(): Promise<any[]> {
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
