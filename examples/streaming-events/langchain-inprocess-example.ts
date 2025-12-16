/**
 * LangChain with In-Process ATP Server - Streaming Events Example
 *
 * This example demonstrates ATP streaming events with an in-process server.
 * No HTTP server needed - the client communicates directly with the server.
 *
 * Prerequisites:
 *   Set OPENAI_API_KEY in environment
 *
 * Run: npm run langchain:inprocess
 */

import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, type ATPEvent, ATPEventType } from '@mondaydotcomorg/atp-protocol';
import { server } from './server.js';

async function main() {
	console.log('🚀 LangChain + ATP Streaming Events (In-Process Mode)\n');

	if (!process.env.OPENAI_API_KEY) {
		console.error('❌ OPENAI_API_KEY environment variable is required');
		process.exit(1);
	}

	console.log('📦 Creating in-process ATP client...');

	const client = new AgentToolProtocolClient({ server });
	await client.init({ name: 'langchain-inprocess-example', version: '1.0.0' });
	await client.connect();

	console.log('✅ In-process client initialized\n');

	const typeDefinitions = client.getTypeDefinitions();

	const streamingEventCounts: Record<string, number> = {};

	const handleEvent = (event: ATPEvent) => {
		const eventType = event.type;
		streamingEventCounts[eventType] = (streamingEventCounts[eventType] || 0) + 1;

		switch (event.type) {
			case ATPEventType.THINKING:
				console.log('💭 Thinking:', (event.data as { content: string }).content);
				break;
			case ATPEventType.TOOL_START:
				console.log(
					'🔧 Tool Start:',
					`${(event.data as { apiGroup: string }).apiGroup}.${(event.data as { toolName: string }).toolName}`
				);
				break;
			case ATPEventType.TOOL_END: {
				const data = event.data as { toolName: string; duration: number; success: boolean };
				console.log(`✅ Tool End: ${data.toolName} (${data.duration}ms, success: ${data.success})`);
				break;
			}
			case ATPEventType.TEXT:
				process.stdout.write(`📝 ${(event.data as { text: string }).text}`);
				break;
			case ATPEventType.TEXT_END:
				console.log('');
				break;
			case ATPEventType.SOURCE: {
				const data = event.data as { title: string; url: string };
				console.log(`📚 Source: ${data.title} (${data.url})`);
				break;
			}
			case ATPEventType.PROGRESS: {
				const data = event.data as { message: string; fraction: number };
				console.log(`📊 Progress: ${data.message} (${Math.round(data.fraction * 100)}%)`);
				break;
			}
			default:
				console.log(`📨 Event [${event.type}]:`, JSON.stringify(event.data).substring(0, 100));
		}
	};

	const llm = new ChatOpenAI({
		modelName: 'gpt-4o-mini',
		temperature: 0,
	});

	const executeCodeTool = new DynamicStructuredTool({
		name: 'atp_execute_code',
		description: `Execute TypeScript code in ATP sandbox with access to streaming tools.
Available APIs:
${typeDefinitions}`,
		schema: z.object({
			code: z.string().describe('TypeScript code to execute'),
		}),
		func: async ({ code }) => {
			try {
				const result = await client.execute(code, { eventCallback: handleEvent });

				if (result.status === ExecutionStatus.COMPLETED) {
					return JSON.stringify({ success: true, result: result.result, stats: result.stats });
				} else {
					return JSON.stringify({ success: false, error: result.error });
				}
			} catch (error: unknown) {
				return JSON.stringify({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	});

	const systemPrompt = `You are a helpful assistant with access to ATP tools.
You can write and execute TypeScript code that streams events in real-time.

Available APIs:
${typeDefinitions}

When using tools:
1. Write clean TypeScript code
2. Use api.custom.* to access the streaming tools
3. The tools will emit events as they execute`;

	const checkpointer = new MemorySaver();
	const agent = createReactAgent({
		llm,
		tools: [executeCodeTool],
		checkpointSaver: checkpointer,
		messageModifier: systemPrompt,
	});

	console.log('═'.repeat(60));
	console.log('Example 1: Research with real-time streaming events');
	console.log('═'.repeat(60) + '\n');

	const result1 = await agent.invoke(
		{
			messages: [
				{
					role: 'user',
					content: 'Research "cloud computing" with depth 3 using api.custom.research()',
				},
			],
		},
		{ configurable: { thread_id: 'inprocess-1' } }
	);

	console.log('\n📄 Agent Response:', getLastMessage(result1));

	console.log('\n' + '═'.repeat(60));
	console.log('Example 2: Data analysis with step-by-step reasoning');
	console.log('═'.repeat(60) + '\n');

	const result2 = await agent.invoke(
		{
			messages: [
				{
					role: 'user',
					content:
						'Analyze data: { users: 10000, revenue: 500000, churn: 0.05 } with analysisType "growth" using api.custom.analyze_data()',
				},
			],
		},
		{ configurable: { thread_id: 'inprocess-2' } }
	);

	console.log('\n📄 Agent Response:', getLastMessage(result2));

	console.log('\n' + '═'.repeat(60));
	console.log('Example 3: Story generation with text streaming');
	console.log('═'.repeat(60) + '\n');

	const result3 = await agent.invoke(
		{
			messages: [
				{
					role: 'user',
					content: 'Generate an adventure story using api.custom.stream_story()',
				},
			],
		},
		{ configurable: { thread_id: 'inprocess-3' } }
	);

	console.log('\n📄 Agent Response:', getLastMessage(result3));

	console.log('\n' + '═'.repeat(60));
	console.log('Example 4: Multi-tool orchestration in single code block');
	console.log('═'.repeat(60) + '\n');

	const result4 = await agent.invoke(
		{
			messages: [
				{
					role: 'user',
					content: `Write a single code block that:
1. Calculates 25 * 4 using api.custom.simple_calc()
2. Researches "web development" with depth 1
3. Returns both results combined`,
				},
			],
		},
		{ configurable: { thread_id: 'inprocess-4' } }
	);

	console.log('\n📄 Agent Response:', getLastMessage(result4));

	console.log('\n' + '═'.repeat(60));
	console.log('📊 Streaming Event Summary');
	console.log('═'.repeat(60));
	for (const [eventType, count] of Object.entries(streamingEventCounts).sort()) {
		console.log(`  ${eventType}: ${count} events`);
	}
	console.log('═'.repeat(60));

	console.log('\n✅ All LangChain in-process examples completed!');
}

function getLastMessage(result: { messages: Array<{ content: unknown }> }): string {
	const lastMessage = result.messages[result.messages.length - 1];
	if (typeof lastMessage.content === 'string') {
		return lastMessage.content.substring(0, 500) + (lastMessage.content.length > 500 ? '...' : '');
	}
	return JSON.stringify(lastMessage.content, null, 2).substring(0, 500);
}

main().catch(console.error);

