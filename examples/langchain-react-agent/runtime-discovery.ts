/**
 * Simple Runtime Discovery Agent
 *
 * LangChain React Agent that:
 * 1. Embeds ATP runtime APIs in system prompt
 * 2. Has ONLY 2 tools: explore_api and execute_code
 * 3. Discovers available server APIs
 * 4. Executes code using discovered runtime APIs
 *
 * Run: npx tsx simple-runtime-discovery.ts
 */

import { ChatOpenAI } from '@langchain/openai';
import { ToolNames } from '@mondaydotcomorg/atp-client';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';

async function main() {
	console.log('🔍 Simple Runtime Discovery Agent\n');
	console.log('='.repeat(80));
	console.log('React Agent with ONLY 2 tools: explore_api + execute_code');
	console.log('Runtime APIs embedded in system prompt');
	console.log('='.repeat(80) + '\n');

	if (!process.env.OPENAI_API_KEY) {
		console.error('❌ Error: OPENAI_API_KEY environment variable not set');
		process.exit(1);
	}

	const serverUrl = process.env.ATP_SERVER_URL || 'http://localhost:3333';
	const authToken = process.env.ATP_AUTH_TOKEN || 'demo-token';

	console.log(`📡 Connecting to ATP server: ${serverUrl}`);

	// Create LLM for ATP runtime
	const llm = new ChatOpenAI({
		modelName: 'gpt-4.1',
		temperature: 0.7,
	});

	console.log('🔧 Creating ATP tools with LangGraph support...\n');

	// Use createATPTools for proper LangGraph integration
	// This creates a client WITH LLM support
	const { client: atpClient, tools: allTools } = await createATPTools({
		serverUrl,
		headers: { Authorization: `Bearer ${authToken}` },
		llm,
	});

	// NOW fetch runtime definitions from the client that HAS LLM
	console.log('🔍 Fetching ATP runtime definitions...');
	const runtimeTypescript = await atpClient.getUnderlyingClient().getRuntimeDefinitions();

	// Filter to only explore_api and execute_code (tools are prefixed with 'atp_')
	const langChainTools = allTools.filter(
		(tool) =>
			tool.name === `atp_${ToolNames.EXPLORE_API}` || tool.name === `atp_${ToolNames.EXECUTE_CODE}`
	);

	console.log(
		`✅ Filtered to ${langChainTools.length} tools: ${langChainTools.map((t) => t.name).join(', ')}\n`
	);

	// Create React agent with runtime knowledge (reuse same LLM)

	const systemPrompt = `You are a helpful assistant that can explore APIs and execute TypeScript code.

=== ATP RUNTIME APIs (available in execute_code) ===

${runtimeTypescript}

YOU HAVE 2 TOOLS:
1. explore_api - Explore available server APIs by path (e.g., "custom", "github")
2. execute_code - Execute TypeScript code that can use the atp.* runtime APIs shown above

IMPORTANT: When writing code for execute_code:
- DO NOT use TypeScript type annotations (no ": string", ": number", etc.)
- Write pure executable JavaScript/TypeScript without types
- The runtime doesn't support type syntax in variable declarations

Example workflow:
- Use explore_api to see what server APIs are available
- Write TypeScript code that uses both server APIs (api.*) and runtime APIs (atp.*)
- Execute the code with execute_code tool`;

	const checkpointer = new MemorySaver();
	const agent = createReactAgent({
		llm,
		tools: langChainTools,
		checkpointSaver: checkpointer,
		messageModifier: systemPrompt,
	});

	console.log('✅ React agent created\n');
	console.log('='.repeat(80) + '\n');

	// Test task
	const userQuery = `
I want to see what's available on this ATP server and test it out.

Please do the following:
1. Use explore_api to discover what API groups are available on the server (start with "api")
2. Once you see what APIs exist, write TypeScript code that:
   - Uses atp.llm.call() to generate a creative tech joke
   - Uses atp.cache.set() to cache the joke with key "tech:joke"
   - Uses atp.cache.get() to retrieve and verify it was cached
   - Returns both the joke and the cached version
3. Execute the code and show me the results

Be concise and show the outputs clearly.
`.trim();

	console.log('💬 Task:');
	console.log(userQuery);
	console.log('\n' + '-'.repeat(80) + '\n');

	const threadId = 'simple-discovery-demo';
	const config = {
		configurable: {
			thread_id: threadId,
		},
	};

	try {
		console.log('🎬 Agent execution started...\n');

		let stepCount = 0;
		for await (const event of await agent.stream(
			{
				messages: [{ role: 'user', content: userQuery }],
			},
			config
		)) {
			if (event.agent) {
				stepCount++;
				const messages = (event.agent as any).messages || [];
				if (messages.length > 0) {
					const lastMessage = messages[messages.length - 1];
					if (lastMessage.content) {
						console.log(`\n🤔 Agent Step ${stepCount}:`);
						const content =
							typeof lastMessage.content === 'string'
								? lastMessage.content
								: JSON.stringify(lastMessage.content);
						console.log(content.substring(0, 400) + (content.length > 400 ? '...' : ''));
					}
				}
			}
			if (event.tools) {
				const toolMessages = (event.tools as any).messages;
				if (toolMessages && Array.isArray(toolMessages) && toolMessages.length > 0) {
					const toolName = toolMessages[0]?.name || 'unknown';
					console.log(`\n🔧 Tool: ${toolName}`);
					if (toolMessages[0]?.content) {
						const content =
							typeof toolMessages[0].content === 'string'
								? toolMessages[0].content
								: JSON.stringify(toolMessages[0].content);
						console.log(content.substring(0, 600) + (content.length > 600 ? '...' : ''));
					}
				}
			}
		}

		console.log('\n' + '='.repeat(80));
		console.log('✅ Agent completed successfully!');
		console.log('='.repeat(80) + '\n');
	} catch (error: any) {
		console.error('\n❌ Error:', error.message);
		if (error.stack) {
			console.error(error.stack);
		}
		process.exit(1);
	}

	console.log('📊 Summary:');
	console.log(`  ✅ Runtime TypeScript: ${runtimeTypescript.length} chars`);
	console.log(`  ✅ Tools: ${langChainTools.length} (explore_api, execute_code)`);
	console.log('  ✅ Agent successfully discovered and used ATP capabilities\n');
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
