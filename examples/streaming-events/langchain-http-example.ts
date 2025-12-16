/**
 * LangChain with HTTP-based ATP Server - Streaming Events Example
 *
 * This example demonstrates how ATP streaming events are received and adapted
 * to LangChain's event format when using an HTTP-based ATP server.
 *
 * Prerequisites:
 *   1. Set OPENAI_API_KEY in environment
 *   2. Start the ATP server: npm run server
 *
 * Run: npm run langchain:http
 */

import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import {
	createLangChainEventHandler,
	type LangChainEvent,
} from '@mondaydotcomorg/atp-langchain';
import { type ATPEvent, ATPEventType } from '@mondaydotcomorg/atp-protocol';

const ATP_SERVER_URL = process.env.ATP_SERVER_URL || 'http://localhost:3333';

async function main() {
	console.log('🚀 LangChain + ATP Streaming Events (HTTP Mode)\n');

	if (!process.env.OPENAI_API_KEY) {
		console.error('❌ OPENAI_API_KEY environment variable is required');
		process.exit(1);
	}

	console.log(`📡 Connecting to ATP server at ${ATP_SERVER_URL}...`);

	const llm = new ChatOpenAI({
		modelName: 'gpt-4o-mini',
		temperature: 0,
	});

	const langChainEvents: LangChainEvent[] = [];

	const eventHandler = (event: LangChainEvent) => {
		langChainEvents.push(event);

		switch (event.event) {
			case 'on_llm_stream':
				console.log('💭 Thinking:', (event.data as { chunk: string }).chunk);
				break;
			case 'on_tool_start':
				console.log('🔧 Tool Start:', event.name);
				break;
			case 'on_tool_end': {
				const meta = event.metadata as { duration?: number; success?: boolean };
				console.log(`✅ Tool End: ${event.name} (${meta?.duration}ms, success: ${meta?.success})`);
				break;
			}
			case 'on_chain_stream':
				process.stdout.write(`📝 ${(event.data as { chunk: string }).chunk}`);
				break;
			case 'on_chain_end':
				console.log('');
				break;
			case 'on_custom_event':
				if (event.name === 'atp_source') {
					const data = event.data as { title: string; url: string };
					console.log(`📚 Source: ${data.title} (${data.url})`);
				} else if (event.name === 'atp_progress') {
					const data = event.data as { message: string; percentage: number };
					console.log(`📊 Progress: ${data.message} (${data.percentage}%)`);
				} else {
					console.log(`📨 Custom Event [${event.name}]:`, JSON.stringify(event.data).substring(0, 80));
				}
				break;
			default:
				console.log(`📨 Event [${event.event}]:`, JSON.stringify(event.data).substring(0, 80));
		}
	};

	const atpEventHandler = createLangChainEventHandler(eventHandler);

	try {
		const { client, tools: allTools } = await createATPTools({
			serverUrl: ATP_SERVER_URL,
			llm,
			eventHandler: (event: ATPEvent) => atpEventHandler(event),
		});

		console.log('✅ Connected to ATP server');
		console.log(`📋 Available tools: ${allTools.map((t) => t.name).join(', ')}\n`);

		const executeCodeTool = allTools.find((t) => t.name === 'atp_execute_code');
		if (!executeCodeTool) {
			throw new Error('atp_execute_code tool not found');
		}

		const typeDefinitions = client.getTypeDefinitions();

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

		const threadId = 'langchain-http-session';

		console.log('═'.repeat(60));
		console.log('Example 1: Research with streaming sources');
		console.log('═'.repeat(60) + '\n');

		const result1 = await agent.invoke(
			{
				messages: [
					{
						role: 'user',
						content: 'Research "blockchain technology" with depth 2 using api.custom.research()',
					},
				],
			},
			{ configurable: { thread_id: threadId } }
		);

		console.log('\n📄 Agent Response:', getLastMessage(result1));

		console.log('\n' + '═'.repeat(60));
		console.log('Example 2: Data analysis with reasoning');
		console.log('═'.repeat(60) + '\n');

		const result2 = await agent.invoke(
			{
				messages: [
					{
						role: 'user',
						content:
							'Analyze this data: { sales: 5000, costs: 3000, margin: 0.4 } with analysisType "financial" using api.custom.analyze_data()',
					},
				],
			},
			{ configurable: { thread_id: threadId + '-2' } }
		);

		console.log('\n📄 Agent Response:', getLastMessage(result2));

		console.log('\n' + '═'.repeat(60));
		console.log('Example 3: Story with text streaming');
		console.log('═'.repeat(60) + '\n');

		const result3 = await agent.invoke(
			{
				messages: [
					{
						role: 'user',
						content: 'Generate a scifi story using api.custom.stream_story()',
					},
				],
			},
			{ configurable: { thread_id: threadId + '-3' } }
		);

		console.log('\n📄 Agent Response:', getLastMessage(result3));

		console.log('\n' + '═'.repeat(60));
		console.log('📊 LangChain Event Summary');
		console.log('═'.repeat(60));
		const eventCounts = langChainEvents.reduce(
			(acc, e) => {
				acc[e.event] = (acc[e.event] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>
		);
		for (const [eventType, count] of Object.entries(eventCounts)) {
			console.log(`  ${eventType}: ${count} events`);
		}
		console.log('═'.repeat(60));

		console.log('\n✅ All LangChain HTTP examples completed!');
	} catch (error: unknown) {
		if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
			console.error('❌ Could not connect to ATP server');
			console.log('   Make sure to start the server first: npm run server');
		} else {
			console.error('❌ Error:', error);
		}
		process.exit(1);
	}
}

function getLastMessage(result: { messages: Array<{ content: unknown }> }): string {
	const lastMessage = result.messages[result.messages.length - 1];
	if (typeof lastMessage.content === 'string') {
		return lastMessage.content;
	}
	return JSON.stringify(lastMessage.content, null, 2);
}

main();

