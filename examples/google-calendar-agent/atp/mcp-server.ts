/**
 * ATP Server with Google Calendar MCP Integration
 * 
 * This server wraps the google-calendar-mcp server and exposes it through ATP.
 * It handles OAuth authentication and provides calendar management tools.
 * 
 * Run: npx tsx mcp-server.ts
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { MCPConnector } from '@mondaydotcomorg/atp-mcp-adapter';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const colors = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
};

async function startServer() {
	console.log('🚀 Starting ATP Server with Google Calendar MCP Integration\n');
	console.log('='.repeat(80));

	const credentialsPath = process.env.GOOGLE_OAUTH_CREDENTIALS;
	if (!credentialsPath) {
		console.error('❌ Error: GOOGLE_OAUTH_CREDENTIALS environment variable not set');
		console.error('   Please set it to the path of your Google OAuth credentials JSON file');
		console.error('   Download from: Google Cloud Console -> Credentials -> OAuth 2.0 Client ID');
		process.exit(1);
	}

	console.log(`📁 Using OAuth credentials: ${credentialsPath}`);
	console.log('='.repeat(80) + '\n');

	const port = 3334;

	const npxPath = process.env.npm_execpath?.replace(/yarn(js)?$/, 'npx') || 
	                process.env.NVM_BIN ? `${process.env.NVM_BIN}/npx` : 
	                'npx';

	const mcpConfig = {
		name: 'google-calendar',
		command: npxPath,
		args: ['@cocal/google-calendar-mcp'],
		env: {
			...process.env,
			GOOGLE_OAUTH_CREDENTIALS: credentialsPath,
			...(process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH && {
				GOOGLE_CALENDAR_MCP_TOKEN_PATH: process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH,
			}),
		},
	};

	console.log('🔧 MCP Configuration:');
	console.log(`   Command: ${mcpConfig.command}`);
	console.log(`   Args: ${mcpConfig.args.join(' ')}`);
	console.log(`   OAuth: ${credentialsPath}\n`);

	const connector = new MCPConnector();
	const apiGroup = await connector.connectToMCPServer(mcpConfig);

	// Filter out get-freebusy tool
	if (apiGroup.functions) {
		apiGroup.functions = apiGroup.functions.filter(func => func.name !== 'get-freebusy');
	}

	// Add output schemas for better agent understanding
	const outputSchemas: Record<string, any> = {
		'get-current-time': {
			type: 'object',
			properties: {
				currentTime: { type: 'string', description: 'ISO 8601 datetime with timezone' },
				timezone: { type: 'string', description: 'Timezone name (e.g., America/New_York)' },
				offset: { type: 'string', description: 'UTC offset (e.g., -05:00)' },
				isDST: { type: 'boolean', description: 'Whether daylight saving time is active' },
			},
			description: 'Returns MCP content array: [{ type: "text", text: JSON.stringify(result) }]'
		},
		'list-calendars': {
			type: 'object',
			properties: {
				calendars: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							summary: { type: 'string' },
							description: { type: 'string' },
							primary: { type: 'boolean' },
						},
					},
				},
			},
			description: 'Returns MCP content array: [{ type: "text", text: JSON.stringify(result) }]'
		},
		'list-events': {
			type: 'object',
			properties: {
				events: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							summary: { type: 'string' },
							description: { type: 'string' },
							start: {
								type: 'object',
								properties: {
									dateTime: { type: 'string' },
									date: { type: 'string' },
								},
							},
							end: {
								type: 'object',
								properties: {
									dateTime: { type: 'string' },
									date: { type: 'string' },
								},
							},
							attendees: { type: 'array' },
							status: { type: 'string' },
							htmlLink: { type: 'string' },
						},
					},
				},
			},
			description: 'Returns MCP content array: [{ type: "text", text: JSON.stringify(result) }]'
		},
	};

	// Add output schemas to functions
	if (apiGroup.functions) {
		apiGroup.functions.forEach((func) => {
			if (outputSchemas[func.name]) {
				func.outputSchema = outputSchemas[func.name];
				// Also enhance description to mention return format
				func.description = `${func.description}\n\nReturns: MCP content array [{ type: "text", text: "JSON string" }]. Parse with JSON.parse(result[0].text)`;
			}
		});
	}

	console.log('✅ MCP Connector created');
	console.log('📋 Available tools (blacklisted: get-freebusy):');
	if (apiGroup.functions) {
		apiGroup.functions.forEach((func) => {
			console.log(`   • ${func.name}: ${func.description || 'No description'}`);
			if (func.outputSchema) {
				console.log(`     ${colors.dim}↳ Has output schema${colors.reset}`);
			}
		});
	}
	console.log();

	const server = createServer();

	// Register MCP tools via .use()
	server.use(apiGroup);

	await server.listen(port);

	console.log('='.repeat(80));
	console.log(`✅ ATP Server running on http://localhost:${port}`);
	console.log('='.repeat(80));
	console.log('\n💡 First-time setup:');
	console.log('   1. Make a request to the server (e.g., via the agent)');
	console.log('   2. The MCP server will open a browser for OAuth authentication');
	console.log('   3. Sign in with your Google account');
	console.log('   4. Grant calendar permissions');
	console.log('   5. Tokens will be saved for future use\n');
	console.log('📝 Note: Tokens expire after 7 days in test mode');
	console.log('   To avoid re-auth, publish your app in Google Cloud Console\n');
}

startServer().catch((error) => {
	console.error('❌ Failed to start server:', error);
	process.exit(1);
});

