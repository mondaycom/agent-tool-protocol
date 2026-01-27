import { createServer, loadOpenAPI } from '@mondaydotcomorg/atp-server';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';

process.env.ATP_JWT_SECRET = process.env.ATP_JWT_SECRET || 'test-secret-key';

async function startServer() {
	const server = createServer({});

	const petstore = await loadOpenAPI('https://petstore.swagger.io/v2/swagger.json', {
		name: 'petstore',
		filter: { methods: ['GET'] },
	});

	server.use([petstore]);
	await server.listen(3333);
	console.log('ATP Server started on http://localhost:3333\n');
}

async function runAgent() {
	const llm = new ChatOpenAI({ modelName: 'gpt-4o-mini', temperature: 0 });

	const { tools } = await createATPTools({
		serverUrl: 'http://localhost:3333',
		llm,
	});

	const agent = createReactAgent({ llm, tools });

	console.log('Running agent...\n');

	const result = await agent.invoke({
		messages: [
			{
				role: 'user',
				content:
					'Use ATP to fetch available pets from the petstore API, then tell me how many pets are available and list 3 example pet names.',
			},
		],
	});

	const lastMessage = result.messages[result.messages.length - 1];
	console.log('Agent response:', lastMessage.content);
}

async function main() {
	await startServer();
	await runAgent();
	process.exit(0);
}

main().catch(console.error);
