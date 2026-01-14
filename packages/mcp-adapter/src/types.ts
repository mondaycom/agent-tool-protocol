/**
 * Shared types for MCP Adapter
 */

export interface MCPTool {
	name: string;
	description?: string;
	inputSchema: {
		type: string;
		properties?: Record<string, unknown>;
		required?: string[];
	};
}

export interface MCPPrompt {
	name: string;
	description?: string;
	arguments?: Array<{
		name: string;
		description?: string;
		required?: boolean;
	}>;
}

export interface MCPStdioServerConfig {
	name: string;
	transport: 'stdio';
	command: string;
	args: string[];
	env?: Record<string, string>;
}

export interface MCPSSEServerConfig {
	name: string;
	transport: 'sse';
	serverUrl: string;
	headers?: Record<string, string>;
}

export type MCPServerConfig = MCPStdioServerConfig | MCPSSEServerConfig;
