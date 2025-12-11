/**
 * Vercel AI SDK with In-Process ATP Server - Streaming Events Example
 *
 * This example demonstrates ATP streaming events with an in-process server.
 * No HTTP server needed - the client communicates directly with the server.
 *
 * Prerequisites:
 *   Set OPENAI_API_KEY in environment
 *
 * Run: npm run vercel:inprocess
 */

import 'dotenv/config';
import { openai } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, type ATPEvent, ATPEventType } from '@mondaydotcomorg/atp-protocol';
import { server } from './server.js';

async function main() {
	console.log('🚀 Vercel AI SDK + ATP Streaming Events (In-Process Mode)\n');

	if (!process.env.OPENAI_API_KEY) {
		console.error('❌ OPENAI_API_KEY environment variable is required');
		process.exit(1);
	}

	console.log('📦 Creating in-process ATP client...');

	const client = new AgentToolProtocolClient({ server });
	await client.init({ name: 'vercel-inprocess-example', version: '1.0.0' });
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

	const executeWithStreaming = async (code: string) => {
		return client.execute(code, { eventCallback: handleEvent });
	};

	const model = openai('gpt-4o-mini');

	const tools = {
		atp_execute_code: tool({
			description: `Execute TypeScript code in ATP sandbox with access to streaming tools.
Available APIs:
${typeDefinitions}`,
			parameters: z.object({
				code: z.string().describe('TypeScript code to execute'),
			}),
			execute: async ({ code }) => {
				try {
					const result = await executeWithStreaming(code);

					if (result.status === ExecutionStatus.COMPLETED) {
						return { success: true, result: result.result, stats: result.stats };
					} else {
						return { success: false, error: result.error };
					}
				} catch (error: unknown) {
					return { success: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
		}),
	};

	console.log('═'.repeat(60));
	console.log('Example 1: Research with real-time streaming events');
	console.log('═'.repeat(60) + '\n');

	const result1 = await generateText({
		model,
		tools,
		maxSteps: 3,
		system: `You are a research assistant. Use the ATP execute_code tool to run research.
Write TypeScript code that calls api.custom.research() with a topic.`,
		prompt: 'Research "artificial intelligence" with depth 2',
	});

	console.log('\n📄 Result:', result1.text || JSON.stringify(result1.toolResults, null, 2));

	console.log('\n' + '═'.repeat(60));
	console.log('Example 2: Data analysis with step-by-step reasoning');
	console.log('═'.repeat(60) + '\n');

	const result2 = await generateText({
		model,
		tools,
		maxSteps: 3,
		system: `You are a data analyst. Use ATP execute_code to analyze data.
Write TypeScript code that calls api.custom.analyze_data() with sample data.`,
		prompt:
			'Analyze the following data: { users: 1000, revenue: 50000, growth: 0.15 } with analysisType "quarterly"',
	});

	console.log('\n📄 Result:', result2.text || JSON.stringify(result2.toolResults, null, 2));

	console.log('\n' + '═'.repeat(60));
	console.log('Example 3: Story generation with text streaming');
	console.log('═'.repeat(60) + '\n');

	const result3 = await generateText({
		model,
		tools,
		maxSteps: 3,
		system: `You are a storyteller. Use ATP execute_code to generate stories.
Write TypeScript code that calls api.custom.stream_story() with a theme.`,
		prompt: 'Generate a mystery story',
	});

	console.log('\n📄 Result:', result3.text || JSON.stringify(result3.toolResults, null, 2));

	console.log('\n' + '═'.repeat(60));
	console.log('Example 4: Multi-tool orchestration');
	console.log('═'.repeat(60) + '\n');

	const result4 = await generateText({
		model,
		tools,
		maxSteps: 5,
		system: `You are a versatile assistant. Use ATP execute_code to:
1. Do a calculation
2. Generate a story
3. Combine results

Write a single TypeScript code block that does all three.`,
		prompt: 'Calculate 100 * 5, then generate a short scifi story, return both results',
	});

	console.log('\n📄 Result:', result4.text || JSON.stringify(result4.toolResults, null, 2));

	console.log('\n' + '═'.repeat(60));
	console.log('📊 Streaming Event Summary');
	console.log('═'.repeat(60));
	for (const [eventType, count] of Object.entries(streamingEventCounts)) {
		console.log(`  ${eventType}: ${count} events`);
	}
	console.log('═'.repeat(60));

	console.log('\n✅ All in-process examples completed!');
}

main().catch(console.error);

