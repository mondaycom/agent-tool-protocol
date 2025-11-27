/**
 * In-Process ATP Example
 *
 * This example demonstrates how to use ATP in in-process mode, where the client
 * communicates directly with the server without HTTP. This is useful for:
 *
 * - MCP stdio servers where multiple processes can't share the same port
 * - Embedded use cases where HTTP overhead is unnecessary
 * - Testing scenarios that need isolated client-server pairs
 *
 * Key difference from HTTP mode:
 *   HTTP mode:       client -> HTTP -> server (requires port)
 *   In-process mode: client -> direct function calls -> server (no port needed)
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

async function main() {
	console.log('=== In-Process ATP Example ===\n');

	// Create server with custom tools
	const server = createServer();

	// Add tools to the server
	server.tool('add', {
		description: 'Add two numbers',
		input: { a: 'number', b: 'number' },
		handler: async (input: unknown) => {
			const { a, b } = input as { a: number; b: number };
			return { result: a + b };
		},
	});

	server.tool('multiply', {
		description: 'Multiply two numbers',
		input: { a: 'number', b: 'number' },
		handler: async (input: unknown) => {
			const { a, b } = input as { a: number; b: number };
			return { result: a * b };
		},
	});

	server.tool('greet', {
		description: 'Greet a person',
		input: { name: 'string' },
		handler: async (input: unknown) => {
			const { name } = input as { name: string };
			return { message: `Hello, ${name}!` };
		},
	});

	const client = new AgentToolProtocolClient({ server });

	await client.init({ name: 'in-process-example', version: '1.0.0' });
	console.log('✓ Client initialized (in-process mode)\n');

	console.log('1. Simple greeting:');
	const greetResult = await client.execute(`
		const result = await api.custom.greet({ name: 'World' });
		return result;
	`);
	console.log('   Result:', greetResult.result);

	console.log('\n2. Math operations:');
	const mathResult = await client.execute(`
		const sum = await api.custom.add({ a: 10, b: 5 });
		const product = await api.custom.multiply({ a: sum.result, b: 3 });
		return {
			sum: sum.result,
			product: product.result
		};
	`);
	console.log('   Result:', mathResult.result);

	console.log('\n3. Complex computation:');
	const complexResult = await client.execute(`
		// Calculate factorial iteratively using multiplication
		let factorial = 1;
		for (let i = 1; i <= 5; i++) {
			const mult = await api.custom.multiply({ a: factorial, b: i });
			factorial = mult.result;
		}
		return { factorial_of_5: factorial };
	`);
	console.log('   Result:', complexResult.result);

	console.log('\n=== Example Complete ===');
}

main().catch(console.error);

