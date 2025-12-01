import 'dotenv/config';
import { createATPTools } from '@mondaydotcomorg/atp-vercel-sdk';
import { openai } from '@ai-sdk/openai';

async function main() {
	const model = openai('gpt-4o-mini');

	const { tools, client } = await createATPTools({
		serverUrl: process.env.ATP_SERVER_URL || 'http://localhost:3333',
		headers: {
			Authorization: `Bearer ${process.env.ATP_API_KEY || 'test-key'}`,
		},
		model,
		approvalHandler: async (message, context) => {
			console.log('\n🔔 Approval Request:');
			console.log('Message:', message);
			if (context) {
				console.log('Context:', JSON.stringify(context, null, 2));
			}

			return new Promise((resolve) => {
				process.stdin.once('data', (data) => {
					const answer = data.toString().trim().toLowerCase();
					resolve(answer === 'y' || answer === 'yes');
				});
				console.log('\nApprove? (y/n): ');
			});
		},
	});

	console.log('✅ ATP Client connected');
	console.log('📋 Available tools:', Object.keys(tools).join(', '));

	const { generateText } = await import('ai');

	console.log('\n🤖 Agent ready! Executing task...\n');

	const result = await generateText({
		model,
		system: `You are a helpful assistant with access to ATP (Agent Tool Protocol).
You can execute TypeScript code using the atp_execute_code tool.
Within the code, you have access to:
- atp.llm.call(prompt) - Call an LLM for sub-reasoning
- atp.llm.extract(prompt, schema) - Extract structured data
- atp.llm.classify(text, categories) - Classify text
- atp.approval.request(message, context?) - Request human approval

Use these capabilities to help users with complex tasks.`,
		prompt: `Use ATP to:
1. Call atp.llm.call() to generate a creative product idea
2. Use atp.approval.request() to ask if we should proceed with the idea
3. If approved, use atp.llm.call() again to create a marketing tagline for the product
4. Return the final result`,
		tools,
		maxSteps: 5,
	});

	console.log('\n📊 Agent Result:');
	console.log(JSON.stringify(result, null, 2));

	process.exit(0);
}

main().catch((error) => {
	console.error('❌ Error:', error);
	process.exit(1);
});
