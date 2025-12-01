import { createServer } from '@mondaydotcomorg/atp-server';

const server = createServer();

server.tool('example', {
	description: 'Example tool',
	input: { message: 'string' },
	handler: async (input: unknown) => {
		const { message } = input as { message: string };
		return `Received: ${message}`;
	},
});

await server.listen(3333);
console.log('✅ ATP Server running on http://localhost:3333');
console.log('   API Key: test-key');
