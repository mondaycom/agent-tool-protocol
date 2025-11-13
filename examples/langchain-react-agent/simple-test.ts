/**
 * Simple Integration Test - ATP + LangChain React Agent
 *
 * This example demonstrates:
 * - Creating ATP tools for LangChain agents
 * - Using all 3 ATP tools (search, fetch_all_apis, execute_code)
 * - Running code that calls APIs and makes LLM calls
 *
 * Prerequisites:
 * 1. Set OPENAI_API_KEY environment variable
 * 2. Start ATP server on http://localhost:3333
 *
 * Run: npx tsx simple-test.ts
 */

import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';

async function main() {
	console.log('🧪 ATP + LangChain Integration Test\n');

	try {
		const llm = new ChatOpenAI({
			modelName: 'gpt-4o-mini',
			temperature: 0,
			openAIApiKey: process.env.OPENAI_API_KEY,
		});

		const { tools } = await createATPTools({
			serverUrl: 'http://localhost:3333',
			headers: { Authorization: 'Bearer test-key' },
			llm,
			useLangGraphInterrupts: false,
		});
		console.log(`✅ Created ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`);

		const agent = createReactAgent({ llm, tools });

		const result = await agent.invoke({
			messages: [
				{
					role: 'user',
					content: `Use the ATP code execution tool to run this code:

const sum = await api.test.add({ a: 5, b: 3 });
const joke = await atp.llm.call({
  prompt: "Tell a ONE sentence joke about the number " + sum.result
});
return { sum: sum.result, joke };`,
				},
			],
		});

		const lastMsg = result.messages[result.messages.length - 1];
		console.log('\n✅ Result:', lastMsg?.content);

		console.log('\n🎉 SUCCESS - ATP + LangChain works!\n');
	} catch (error: any) {
		console.error('\n❌ FAILED:', error.message);
		console.error(error);
		process.exit(1);
	}
}

main();
