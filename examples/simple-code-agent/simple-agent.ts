/**
 * Simple example of using ATP chat utilities
 * 
 * This is a minimal example showing how to create an interactive
 * code execution agent using the generic utilities.
 */

import { ChatOpenAI } from '@langchain/openai';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import * as dotenv from 'dotenv';
import {
	ChatFormatter,
	CodeExecutionHandler,
	InteractiveChatRunner,
} from '../utils';

dotenv.config();

async function main() {
	const formatter = new ChatFormatter();
	formatter.suppressZodWarnings();

	formatter.showHeader({
		title: '🤖 Simple Code Execution Agent',
		subtitle: 'A minimal example using ATP chat utilities',
	});

	if (!process.env.OPENAI_API_KEY) {
		formatter.showError('OPENAI_API_KEY not set in .env');
		process.exit(1);
	}

	const serverUrl = process.env.ATP_SERVER_URL || 'http://localhost:3334';
	const authToken = process.env.ATP_AUTH_TOKEN || 'demo-token';

	formatter.showConnecting(serverUrl);

	const llm = new ChatOpenAI({
		modelName: 'gpt-4.1',
		temperature: 0,
	}) as any;

	const { client: atpClient, tools: allTools } = await createATPTools({
		serverUrl,
		headers: { Authorization: `Bearer ${authToken}` },
		llm,
	});

	formatter.showConnected(allTools.length);

	const executeCodeTool = allTools.find((tool) => tool.name === 'atp_execute_code');

	if (!executeCodeTool) {
		formatter.showError('execute_code tool not found');
		process.exit(1);
	}

	const systemPrompt = `You are a helpful assistant with access to the ATP runtime.

**IMPORTANT - You can write TypeScript code that uses MULTIPLE tools in a SINGLE execution!**

**Available APIs:**
${atpClient.getTypeDefinitions()}

**How to write multi-tool code:**

\`\`\`typescript
// Example: Query multiple APIs in sequence
const result1 = await api['group-name']['tool-name']({ param: 'value' });
const data1 = JSON.parse(result1[0].text);

const result2 = await api['group-name']['another-tool']({ 
  param: data1.someField 
});
const data2 = JSON.parse(result2[0].text);

return {
  result1: data1,
  result2: data2
};
\`\`\`

**CRITICAL - Code Return Values:**
- ⚠️ ALWAYS parse MCP responses with JSON.parse(result[0].text) before returning
- ⚠️ Return CLEAN, PARSED objects - NOT raw MCP content arrays
- ⚠️ Extract only the essential fields
- ⚠️ Keep return values concise - the user sees them in the console
- ⚠️ Use .map() to simplify arrays to just key fields
- ⚠️ When querying multiple items, use a for loop (not Promise.all)

**CRITICAL - Code Execution Environment:**
- ⚠️ Your code runs in an isolated VM - it must be a COMPLETE, SELF-CONTAINED block
- ⚠️ NEVER EVER use 'continue' statements - they cause syntax errors in the VM
- ⚠️ Instead of 'continue', wrap the rest of the loop body in an 'if' statement
- ⚠️ Example: Instead of \`if (skip) continue;\` use \`if (!skip) { /* rest of loop */ }\`
- ⚠️ 'break' statements are OK inside loops
- ⚠️ ALL loops, functions, and logic must be fully defined within your code block

**When responding:**
- Show clear, formatted results
- Be concise and helpful`;

	const checkpointer = new MemorySaver();
	const agent = createReactAgent({
		llm,
		tools: [executeCodeTool!] as any,
		checkpointSaver: checkpointer,
		messageModifier: systemPrompt,
	});

	const handler = new CodeExecutionHandler(formatter);
	const chatRunner = new InteractiveChatRunner(formatter, handler);

	await chatRunner.run({
		agent,
		threadId: 'simple-agent-session',
		formatter,
		handler,
	});
}

main().catch((error) => {
	const formatter = new ChatFormatter();
	formatter.showError(`Fatal error: ${error.message || error}`);
	process.exit(1);
});

