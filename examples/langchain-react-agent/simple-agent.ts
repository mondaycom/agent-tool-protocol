/**
 * Simple LangChain React Agent Example
 *
 * This is a simplified version without approval handling.
 * Perfect for getting started quickly.
 *
 * Demonstrates:
 * - Token refresh using preRequest hook
 * - LangGraph ATP client with LLM support
 * - Automatic approval handling
 */

import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import type { ClientHooks } from '@mondaydotcomorg/atp-client';

async function main() {
	console.log('🚀 Simple LangChain React Agent with ATP\n');

	// Check for API key
	if (!process.env.OPENAI_API_KEY) {
		console.error('❌ Error: OPENAI_API_KEY environment variable not set');
		console.error('Set it with: export OPENAI_API_KEY=sk-...');
		process.exit(1);
	}

	// 1. Create LLM
	const llm = new ChatOpenAI({
		modelName: 'gpt-4.1',
		temperature: 0,
	});

	// 2. Setup hooks with token refresh simulation
	let tokenRefreshCount = 0;
	const hooks: ClientHooks = {
		preRequest: async (context) => {
			// Simulate token refresh before each request
			// In production, this would call your auth service
			tokenRefreshCount++;
			console.log(`🔄 [Hook] Refreshing token (call ${tokenRefreshCount})`);

			const freshToken = `fresh-token-${Date.now()}`;

			return {
				headers: {
					...context.currentHeaders,
					Authorization: `Bearer ${freshToken}`,
					'X-Request-Count': String(tokenRefreshCount),
				},
			};
		},
	};

	// 3. Create ATP tools with hooks
	console.log('🔌 Connecting to ATP server...');
	const { tools } = await createATPTools({
		serverUrl: 'http://localhost:3333',
		llm,
		useLangGraphInterrupts: false, // Simple mode: no interrupts
		hooks, // Add our token refresh hook
		// Optional: provide direct approval handler
		approvalHandler: async (message, context) => {
			console.log(`\n⚠️  Approval requested: ${message}`);
			return true; // Auto-approve for demo
		},
	});
	console.log('✅ Connected!\n');

	// 4. Create agent
	const agent = createReactAgent({ llm, tools });

	// 5. Run agent
	console.log('🤖 Running agent...\n');

	const result = await agent.invoke({
		messages: [
			{
				role: 'user',
				content: `
Write ATP code that:
1. Uses atp.llm.call() to generate 3 creative product names for a new coffee shop
2. Return the results as JSON

The code should be TypeScript and use Promise.all for parallel LLM calls.
			`.trim(),
			},
		],
	});

	console.log('\n📊 Result:');
	console.log(JSON.stringify(result.messages[result.messages.length - 1]?.content, null, 2));
}

main().catch(console.error);
