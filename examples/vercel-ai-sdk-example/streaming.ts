import 'dotenv/config';
import { createATPTools } from '@mondaydotcomorg/atp-vercel-sdk';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

async function main() {
	const model = openai('gpt-4o-mini');

	const { tools } = await createATPTools({
		serverUrl: process.env.ATP_SERVER_URL || 'http://localhost:3333',
		headers: {
			Authorization: `Bearer ${process.env.ATP_API_KEY || 'test-key'}`,
		},
		model,
		approvalHandler: async (message) => {
			console.log('\n🔔 Auto-approving:', message);
			return true;
		},
	});

	console.log('✅ ATP Client connected with streaming support');
	console.log('📋 Available tools:', Object.keys(tools).join(', '));

	const prompt = `Use ATP to execute code that calls atp.llm.call() to write a short story about a robot learning to paint. Then return the story.`;

	console.log('\n🤖 Streaming agent response...\n');

	const result = await streamText({
		model,
		system: `You are a helpful assistant with access to ATP (Agent Tool Protocol).
You can execute TypeScript code using the atp_execute_code tool.
Within the code, you have access to atp.llm.call() to make LLM calls.`,
		prompt,
		tools,
		maxSteps: 5,
	});

	for await (const chunk of result.textStream) {
		process.stdout.write(chunk);
	}

	console.log('\n\n✅ Streaming complete!');

	const fullResult = await result.response;
	console.log('\n📊 Final result:', fullResult);

	process.exit(0);
}

main().catch((error) => {
	console.error('❌ Error:', error);
	process.exit(1);
});
