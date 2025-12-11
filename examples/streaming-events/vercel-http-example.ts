/**
 * Vercel AI SDK with HTTP-based ATP Server - Streaming Events Example
 *
 * This example demonstrates how ATP streaming events are received and adapted
 * to the Vercel AI SDK format when using an HTTP-based ATP server.
 *
 * Prerequisites:
 *   1. Set OPENAI_API_KEY in environment
 *   2. Start the ATP server: npm run server
 *
 * Run: npm run vercel:http
 */

import 'dotenv/config';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createATPStreamingTools } from '@mondaydotcomorg/atp-vercel-sdk';
import { type ATPEvent } from '@mondaydotcomorg/atp-protocol';

const ATP_SERVER_URL = process.env.ATP_SERVER_URL || 'http://localhost:3333';

async function main() {
	console.log('🚀 Vercel AI SDK + ATP Streaming Events (HTTP Mode)\n');

	if (!process.env.OPENAI_API_KEY) {
		console.error('❌ OPENAI_API_KEY environment variable is required');
		console.log('   Set it in .env file or export it in your shell');
		process.exit(1);
	}

	console.log(`📡 Connecting to ATP server at ${ATP_SERVER_URL}...`);

	const model = openai('gpt-4o-mini');

	const collectedEvents: ATPEvent[] = [];

	const mockDataStream = {
		write: (event: unknown) => {
			console.log('📨 Stream Event:', JSON.stringify(event, null, 2));
		},
	};

	try {
		const { client, tools } = await createATPStreamingTools({
			serverUrl: ATP_SERVER_URL,
			model,
			dataStream: mockDataStream,
		});

		console.log('✅ Connected to ATP server\n');

		const typeDefinitions = client.getTypeDefinitions();
		console.log('📚 Available APIs:');
		console.log(typeDefinitions.substring(0, 500) + '...\n');

		console.log('═'.repeat(60));
		console.log('Example 1: Research with streaming sources and text');
		console.log('═'.repeat(60) + '\n');

		const researchResult = await generateText({
			model,
			tools,
			maxSteps: 3,
			system: `You are a helpful research assistant with access to ATP tools.
Use the research tool to investigate topics. The tool streams its findings in real-time.

Available APIs:
${typeDefinitions}`,
			prompt: 'Research the topic "quantum computing" with depth 2',
		});

		console.log('\n📄 Final Response:', researchResult.text || '(tool result only)');
		console.log('📊 Tool Results:', JSON.stringify(researchResult.toolResults, null, 2));

		console.log('\n' + '═'.repeat(60));
		console.log('Example 2: Story generation with text streaming');
		console.log('═'.repeat(60) + '\n');

		const storyResult = await generateText({
			model,
			tools,
			maxSteps: 3,
			system: `You are a creative storyteller with access to ATP tools.
Use the stream_story tool to generate stories. The tool streams text chunks in real-time.

Available APIs:
${typeDefinitions}`,
			prompt: 'Generate a short adventure story',
		});

		console.log('\n📄 Final Response:', storyResult.text || '(tool result only)');

		console.log('\n' + '═'.repeat(60));
		console.log('Example 3: Multi-tool code execution');
		console.log('═'.repeat(60) + '\n');

		const codeResult = await generateText({
			model,
			tools,
			maxSteps: 5,
			system: `You are an assistant that can execute TypeScript code.
You have access to ATP tools via the api object. Write code that:
1. First does a simple calculation
2. Then researches a topic
3. Returns a combined result

Available APIs:
${typeDefinitions}`,
			prompt:
				'Calculate 42 + 58 and then research "machine learning" with depth 1, return both results',
		});

		console.log('\n📄 Final Response:', codeResult.text || '(tool result only)');

		console.log('\n✅ All examples completed!');
		console.log('\n📊 Total streamed events received:', collectedEvents.length);
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

main();

