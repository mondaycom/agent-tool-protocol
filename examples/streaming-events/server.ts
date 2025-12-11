/**
 * ATP Server with Streaming Events
 *
 * This server demonstrates tools that emit streaming events during execution.
 * Events are automatically transported to clients via SSE and can be adapted
 * to Vercel AI SDK or LangChain formats.
 *
 * Run: npm run server
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { ATPEventType } from '@mondaydotcomorg/atp-protocol';

const server = createServer();

server.tool('research', {
	description: 'Research a topic and stream findings as they are discovered',
	input: {
		topic: 'string',
		depth: 'number',
	},
	handler: async (input, context) => {
		const { topic, depth = 3 } = input as { topic: string; depth?: number };

		context?.emit(ATPEventType.THINKING, { content: `Starting research on "${topic}"...` });

		await delay(300);

		const sources = [
			{ url: 'https://docs.example.com/guide', title: 'Official Documentation' },
			{ url: 'https://blog.example.com/deep-dive', title: 'Deep Dive Blog Post' },
			{ url: 'https://github.com/example/repo', title: 'Source Code Repository' },
		];

		const findings: string[] = [];

		for (let i = 0; i < Math.min(depth, sources.length); i++) {
			const source = sources[i];

			context?.emit(ATPEventType.THINKING, {
				content: `Analyzing source ${i + 1}/${depth}: ${source.title}`,
				step: `analysis-${i + 1}`,
			});

			await delay(500);

			context?.emit(ATPEventType.SOURCE, {
				url: source.url,
				title: source.title,
				summary: `Relevant information about ${topic}`,
				createdAt: new Date().toISOString(),
			});

			context?.emit(ATPEventType.PROGRESS, {
				message: `Processed ${i + 1} of ${depth} sources`,
				fraction: (i + 1) / depth,
			});

			findings.push(`Finding ${i + 1}: Key insight from ${source.title}`);

			context?.emit(ATPEventType.TEXT, {
				text: `Found: ${findings[i]}\n`,
			});

			await delay(200);
		}

		context?.emit(ATPEventType.TEXT_END, {});

		return {
			topic,
			sourcesAnalyzed: depth,
			findings,
		};
	},
});

server.tool('analyze_data', {
	description: 'Analyze data with step-by-step reasoning streamed to the client',
	input: {
		data: 'object',
		analysisType: 'string',
	},
	handler: async (input, context) => {
		const { data, analysisType } = input as { data: Record<string, unknown>; analysisType: string };

		const steps = [
			'Validating input data structure',
			'Identifying key patterns',
			'Computing statistical metrics',
			'Generating insights',
			'Preparing final report',
		];

		context?.emit(ATPEventType.THINKING, {
			content: `Beginning ${analysisType} analysis...`,
		});

		const results: Record<string, unknown> = {};

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];

			context?.emit(ATPEventType.THINKING, {
				content: step,
				step: `step-${i + 1}`,
			});

			await delay(400);

			context?.emit(ATPEventType.PROGRESS, {
				message: step,
				fraction: (i + 1) / steps.length,
			});

			results[`step_${i + 1}`] = {
				name: step,
				status: 'completed',
				timestamp: Date.now(),
			};
		}

		context?.emit(ATPEventType.TEXT, {
			text: `Analysis complete! Processed ${Object.keys(data).length} data fields through ${steps.length} analysis steps.`,
		});
		context?.emit(ATPEventType.TEXT_END, {});

		return {
			analysisType,
			inputFields: Object.keys(data),
			stepsCompleted: steps.length,
			results,
		};
	},
});

server.tool('stream_story', {
	description: 'Generate a story with text streaming chunk by chunk',
	input: {
		theme: 'string',
		length: 'string',
	},
	handler: async (input, context) => {
		const { theme, length = 'short' } = input as { theme: string; length?: string };

		const stories: Record<string, string[]> = {
			adventure: [
				'The brave explorer ventured into the unknown forest. ',
				'Strange sounds echoed through the ancient trees. ',
				'A path of glowing mushrooms appeared before them. ',
				'At the end of the path stood a magnificent crystal cave. ',
				'Inside, treasures beyond imagination awaited discovery.',
			],
			mystery: [
				'The detective examined the peculiar evidence. ',
				'Nothing seemed to add up at first glance. ',
				'Then a small detail caught their attention. ',
				'The missing piece of the puzzle was revealed. ',
				'The case that had baffled everyone was finally solved.',
			],
			scifi: [
				'The spacecraft entered the anomaly region. ',
				'Sensors detected an unknown energy signature. ',
				'Time seemed to flow differently here. ',
				'A message from an ancient civilization appeared. ',
				'Humanity was about to learn they were not alone.',
			],
		};

		const storyChunks = stories[theme] || stories.adventure;
		const chunksToUse = length === 'long' ? storyChunks : storyChunks.slice(0, 3);

		context?.emit(ATPEventType.THINKING, {
			content: `Crafting a ${length} ${theme} story...`,
		});

		await delay(200);

		let fullStory = '';
		const runId = `story-${Date.now()}`;

		for (const chunk of chunksToUse) {
			context?.emit(ATPEventType.TEXT, { text: chunk }, runId);
			fullStory += chunk;
			await delay(300);
		}

		context?.emit(ATPEventType.TEXT_END, {}, runId);

		return {
			theme,
			length,
			wordCount: fullStory.split(' ').length,
			story: fullStory.trim(),
		};
	},
});

server.tool('simple_calc', {
	description: 'Perform a simple calculation (no streaming, for comparison)',
	input: {
		a: 'number',
		b: 'number',
		operation: 'string',
	},
	handler: async (input) => {
		const { a, b, operation } = input as { a: number; b: number; operation: string };

		let result: number;
		switch (operation) {
			case 'add':
				result = a + b;
				break;
			case 'subtract':
				result = a - b;
				break;
			case 'multiply':
				result = a * b;
				break;
			case 'divide':
				result = b !== 0 ? a / b : NaN;
				break;
			default:
				throw new Error(`Unknown operation: ${operation}`);
		}

		return { a, b, operation, result };
	},
});

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export { server };

if (import.meta.url === `file://${process.argv[1]}`) {
	await server.listen(3333);
	console.log('✅ ATP Server with streaming events running on http://localhost:3333');
	console.log('');
	console.log('Available tools:');
	console.log('  - research: Streams thinking, sources, progress, and text events');
	console.log('  - analyze_data: Streams step-by-step reasoning');
	console.log('  - stream_story: Streams text chunks');
	console.log('  - simple_calc: Basic tool without streaming (for comparison)');
	console.log('');
	console.log('Run examples:');
	console.log('  npm run vercel:http      - Vercel AI SDK with HTTP server');
	console.log('  npm run vercel:inprocess - Vercel AI SDK with in-process server');
	console.log('  npm run langchain:http   - LangChain with HTTP server');
	console.log('  npm run langchain:inprocess - LangChain with in-process server');
}

