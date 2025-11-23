/**
 * Interactive Console Calendar Agent
 * 
 * Chat with an AI agent that can:
 * - Access your Google Calendar
 * - List events, check availability
 * - Schedule meetings
 * - Remember your conversation
 * 
 * Run: npm run chat
 */

import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { MCPConnector } from '@mondaydotcomorg/atp-mcp-adapter';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

// Colors for console output
const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	dim: '\x1b[2m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
};

async function createCalendarTools() {
	const credentialsPath = process.env.GOOGLE_OAUTH_CREDENTIALS;
	if (!credentialsPath) {
		throw new Error('GOOGLE_OAUTH_CREDENTIALS not set in .env');
	}

	const connector = new MCPConnector();
	const npxPath = process.env.NVM_BIN ? `${process.env.NVM_BIN}/npx` : 'npx';

	const apiGroup = await connector.connectToMCPServer({
		name: 'google-calendar',
		command: npxPath,
		args: ['@cocal/google-calendar-mcp'],
		env: {
			...process.env,
			GOOGLE_OAUTH_CREDENTIALS: credentialsPath,
		},
	});

	// Convert MCP functions to LangChain tools
	const tools = apiGroup.functions?.map((func) => {
		// Build schema more carefully
		const zodFields: Record<string, any> = {};
		const properties = func.inputSchema?.properties || {};
		const required = func.inputSchema?.required || [];

		for (const [key, prop] of Object.entries(properties)) {
			const p = prop as any;
			let field: any;

			// Handle different types properly
			if (p.type === 'string') {
				field = z.string();
				if (p.description) field = field.describe(p.description);
			} else if (p.type === 'number' || p.type === 'integer') {
				field = z.number();
				if (p.description) field = field.describe(p.description);
			} else if (p.type === 'boolean') {
				field = z.boolean();
				if (p.description) field = field.describe(p.description);
			} else if (p.type === 'array') {
				// Handle arrays properly - this was the bug!
				// Just use z.array(z.string()) as a safe default
				field = z.array(z.string());
				if (p.description) field = field.describe(p.description);
			} else {
				// For objects or unknown types, use z.any()
				field = z.any();
				if (p.description) field = field.describe(p.description);
			}

			// Make optional if not required (use .nullish() instead of .optional())
			if (!required.includes(key)) {
				field = field.nullish();
			}

			zodFields[key] = field;
		}

		const schema = Object.keys(zodFields).length > 0 ? z.object(zodFields) : z.object({});

		return new DynamicStructuredTool({
			name: func.name.replace(/-/g, '_'),
			description: func.description || `Calendar tool: ${func.name}`,
			schema,
			func: async (input) => {
				// Clean up input - remove null/undefined values
				const cleanInput: Record<string, any> = {};
				for (const [key, value] of Object.entries(input)) {
					if (value !== null && value !== undefined) {
						cleanInput[key] = value;
					}
				}
				
				console.log(`\n${colors.cyan}🔧 Executing: ${func.name}${colors.reset}`);
				console.log(`${colors.dim}Parameters: ${JSON.stringify(cleanInput, null, 2)}${colors.reset}`);
				
				try {
					const result = await connector.callTool(func.name, cleanInput);
					
					// Parse the MCP response
					let parsedResult = result;
					if (Array.isArray(result) && result[0]?.type === 'text') {
						try {
							parsedResult = JSON.parse(result[0].text);
						} catch {
							parsedResult = result[0].text;
						}
					}
					
					console.log(`${colors.green}✅ Result:${colors.reset}`);
					const resultStr = typeof parsedResult === 'string' 
						? parsedResult 
						: JSON.stringify(parsedResult, null, 2);
					console.log(resultStr.substring(0, 500) + (resultStr.length > 500 ? '...(truncated)' : ''));
					console.log();
					
					return JSON.stringify(parsedResult);
				} catch (error: any) {
					console.log(`${colors.red}❌ Error: ${error.message}${colors.reset}\n`);
					return JSON.stringify({ error: error.message });
				}
			},
		});
	}) || [];

	return { tools, connector };
}

async function main() {
	// Suppress Zod warnings
	const originalWarn = console.warn;
	console.warn = (...args: any[]) => {
		const msg = args[0]?.toString() || '';
		if (msg.includes('Zod field') || msg.includes('.optional()') || msg.includes('.nullable()')) {
			return; // Suppress these warnings
		}
		originalWarn.apply(console, args);
	};

	console.clear();
	console.log(`${colors.bright}${colors.blue}`);
	console.log('╔════════════════════════════════════════════════════════════╗');
	console.log('║       📅 Interactive Google Calendar Agent 🤖              ║');
	console.log('╚════════════════════════════════════════════════════════════╝');
	console.log(colors.reset);
	console.log(`${colors.dim}Type your questions about your calendar. Type 'exit' to quit.${colors.reset}\n`);

	if (!process.env.OPENAI_API_KEY) {
		console.error(`${colors.red}❌ Error: OPENAI_API_KEY not set in .env${colors.reset}`);
		process.exit(1);
	}

	console.log(`${colors.yellow}📡 Connecting to Google Calendar...${colors.reset}`);
	const { tools, connector } = await createCalendarTools();
	console.log(`${colors.green}✅ Connected! ${tools.length} calendar tools available${colors.reset}\n`);

	// Create LLM
	const llm = new ChatOpenAI({
		modelName: 'gpt-4.1',
		temperature: 0,
	});

	// Create agent with memory
	const checkpointer = new MemorySaver();
	const agent = createReactAgent({
		llm,
		tools,
		checkpointSaver: checkpointer,
		messageModifier: `You are a helpful Google Calendar assistant. You can:
- List calendars and events
- Check availability (free/busy)
- Search for events
- Create, update, and delete events
- Help find meeting times

IMPORTANT - Date & Time Handling:
- ALWAYS use get_current_time tool FIRST to get the correct current date and timezone
- NEVER assume today's date - always check dynamically
- Use the timezone from get_current_time for all date/time operations
- Format dates as ISO 8601 without milliseconds: "2025-11-19T14:00:00"

User's preferred timezone: ${process.env.TIMEZONE || 'America/New_York'}
User's working hours: ${process.env.WORKING_HOURS_START || '09:00'} - ${process.env.WORKING_HOURS_END || '17:00'}

When showing results:
- Use clear date formats like "Nov 20, 2:30pm"
- Show the most important details: title, time, attendees
- Be concise but helpful
- Convert times to user's timezone when displaying`,
	});

	const threadId = 'interactive-calendar-session';
	const config = { configurable: { thread_id: threadId } };

	// Setup readline for console input
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const askQuestion = (prompt: string): Promise<string> => {
		return new Promise((resolve) => {
			rl.question(prompt, resolve);
		});
	};

	// Interactive loop
	while (true) {
		const userInput = await askQuestion(`${colors.bright}${colors.green}You: ${colors.reset}`);

		if (!userInput.trim()) continue;
		if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
			console.log(`\n${colors.yellow}👋 Goodbye!${colors.reset}\n`);
			break;
		}

		console.log(`\n${colors.magenta}🤖 Agent thinking...${colors.reset}\n`);

		try {
			let finalResponse = '';
			let stepNumber = 0;
			
			for await (const event of await agent.stream(
				{ messages: [new HumanMessage(userInput)] },
				config
			)) {
				// Show agent's reasoning
				if (event.agent) {
					stepNumber++;
					const messages = (event.agent as any).messages || [];
					if (messages.length > 0) {
						const lastMessage = messages[messages.length - 1];
						
						// Show tool calls if present
						if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
							console.log(`${colors.yellow}💭 Agent Step ${stepNumber}: Planning to call tools${colors.reset}`);
							for (const toolCall of lastMessage.tool_calls) {
								console.log(`${colors.dim}   → ${toolCall.name}(${JSON.stringify(toolCall.args).substring(0, 100)}...)${colors.reset}`);
							}
						}
						
						if (lastMessage.content) {
							finalResponse = typeof lastMessage.content === 'string'
								? lastMessage.content
								: JSON.stringify(lastMessage.content);
						}
					}
				}
			}

			if (finalResponse) {
				console.log(`${colors.bright}${colors.blue}Agent: ${colors.reset}${finalResponse}\n`);
			}

		} catch (error: any) {
			console.error(`\n${colors.red}❌ Error: ${error.message}${colors.reset}\n`);
			if (error.message.includes('Recursion limit')) {
				console.log(`${colors.yellow}💡 The agent got stuck. Try rephrasing your question.${colors.reset}\n`);
			}
		}
	}

	rl.close();
	await connector.disconnectAll();
}

main().catch((error) => {
	console.error(`${colors.red}Fatal error:${colors.reset}`, error);
	process.exit(1);
});

