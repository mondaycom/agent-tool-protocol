/**
 * Runtime OpenAPI Loading Example
 * Shows how to load OpenAPI specs dynamically after the server has started
 */

import { createServer } from '@mondaydotcomorg/atp-server';

const server = createServer();

// Start the server first
await server.listen(3000);
console.log('✨ Server started on port 3000');

// Now you can load OpenAPI specs dynamically at runtime
// The same use() method works both before AND after server starts!
console.log('\n📚 Loading OpenAPI spec at runtime...');

try {
	// Load from URL - same method whether server is running or not
	await server.loadOpenAPI('http://localhost:3040/openapi.json', {
		name: 'demo',
		// Optional: filter which operations to include
		filter: {
			methods: ['GET', 'POST'],
			// tags: ['pets'],
		},
	});

	console.log('✅ OpenAPI spec loaded successfully!');
} catch (error) {
	console.error('❌ Failed to load OpenAPI spec:', error);
}

// You can also add custom API groups at runtime using the same use() method
const customGroup = {
	name: 'custom',
	type: 'custom' as const,
	functions: [
		{
			name: 'sayHello',
			description: 'Say hello',
			inputSchema: {
				type: 'object',
				properties: {
					name: { type: 'string' },
				},
				required: ['name'],
			},
			handler: async (input: any) => {
				return { message: `Hello ${input.name}!` };
			},
		},
	],
};

// Same use() method - automatically handles runtime vs pre-start
server.use(customGroup);
console.log('✅ Custom API group added!');

console.log('\n🚀 Ready to accept requests!');
console.log('   Try: curl http://localhost:3000/atp/definitions');

