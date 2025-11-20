/**
 * ATPEngine with OpenAPI Example
 * 
 * Shows how to integrate OpenAPI specs without HTTP server
 */

import { ATPEngine } from '@mondaydotcomorg/atp-engine';
import { loadOpenAPI } from '@mondaydotcomorg/atp-server';

async function main() {
	console.log('🚀 Starting ATPEngine with OpenAPI...\n');

	// Create engine
	const engine = new ATPEngine({
		timeout: 30000,
		enableCompiler: true,
		enableBatchParallel: true,
	});

	// Load OpenAPI spec
	console.log('📥 Loading Petstore OpenAPI spec...');
	const petstore = await loadOpenAPI('https://petstore.swagger.io/v2/swagger.json', {
		name: 'petstore',
		filter: { methods: ['GET'] },
	});

	// Register API
	engine.registerAPI('petstore', {
		type: 'openapi',
		spec: petstore,
	});

	console.log('✓ Petstore API registered\n');

	// Execute code that uses the OpenAPI
	console.log('⚡ Executing code...');
	const result = await engine.execute(`
		// Fetch available pets
		const pets = await atp.api.petstore.findPetsByStatus({ 
			status: 'available' 
		});
		
		// Process and filter
		const categories = pets
			.filter(p => p.category?.name)
			.map(p => p.category.name)
			.filter((v, i, a) => a.indexOf(v) === i);
		
		// Return summary
		return {
			totalPets: pets.length,
			categories: categories.slice(0, 5),
			samplePets: pets.slice(0, 3).map(p => ({
				name: p.name,
				status: p.status,
				category: p.category?.name
			}))
		};
	`);

	console.log('\n📊 Result:');
	console.log(JSON.stringify(result.result, null, 2));
	console.log('\n⏱️  Duration:', result.duration, 'ms');
	console.log('✅ Status:', result.status);

	// Clean up
	await engine.dispose();
}

main().catch(console.error);

