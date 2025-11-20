/**
 * Basic ATPEngine Example
 * 
 * Demonstrates direct, in-process code execution without HTTP server
 */

import { ATPEngine } from '@mondaydotcomorg/atp-engine';

async function main() {
	// Create engine
	const engine = new ATPEngine({
		timeout: 30000,
		memory: 128 * 1024 * 1024,
	});

	console.log('✓ Engine created');

	// Register a custom API
	engine.registerAPI('math', {
		type: 'custom',
		description: 'Math operations',
		functions: [
			{
				name: 'add',
				description: 'Add two numbers',
				inputSchema: {
					type: 'object',
					properties: {
						a: { type: 'number' },
						b: { type: 'number' },
					},
					required: ['a', 'b'],
				},
				handler: async (input: any) => {
					return { result: input.a + input.b };
				},
			},
			{
				name: 'multiply',
				description: 'Multiply two numbers',
				inputSchema: {
					type: 'object',
					properties: {
						a: { type: 'number' },
						b: { type: 'number' },
					},
					required: ['a', 'b'],
				},
				handler: async (input: any) => {
					return { result: input.a * input.b };
				},
			},
		],
	});

	console.log('✓ API registered');

	// Execute code directly - no HTTP needed!
	const result = await engine.execute(`
		// Call custom API
		const sum = await atp.api.math.add({ a: 10, b: 20 });
		const product = await atp.api.math.multiply({ a: 5, b: 3 });
		
		// Process results
		return {
			sum: sum.result,
			product: product.result,
			total: sum.result + product.result
		};
	`);

	console.log('\n📊 Execution Result:');
	console.log('Status:', result.status);
	console.log('Result:', JSON.stringify(result.result, null, 2));
	console.log('Duration:', result.duration, 'ms');

	// Get type definitions
	const types = await engine.getTypeDefinitions();
	console.log('\n📝 Type Definitions Generated:');
	console.log(types.split('\n').slice(0, 20).join('\n') + '\n...');

	// List registered APIs
	const apis = engine.listAPIs();
	console.log('\n📚 Registered APIs:', apis);

	// Search APIs
	const searchResults = await engine.searchAPIs('add');
	console.log('\n🔍 Search Results for "add":');
	console.log(searchResults);

	// Clean up
	await engine.dispose();
	console.log('\n✓ Engine disposed');
}

main().catch(console.error);

