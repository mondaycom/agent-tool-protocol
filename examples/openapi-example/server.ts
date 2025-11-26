/**
 * OpenAPI Example - Load APIs from OpenAPI specs
 * Shows how to load and filter OpenAPI specifications
 */

import { createServer, loadOpenAPI } from '@mondaydotcomorg/atp-server';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const server = createServer();

// Load local OpenAPI spec
const petstore = await loadOpenAPI(join(__dirname, 'petstore-api.json'), {
	name: 'petstore',
	filter: {
		// Only include these HTTP methods
		methods: ['GET', 'POST'],
	},
});

server.use(petstore);

await server.listen(3000);
console.log('\n✨ Try these:');
console.log('  GET  http://localhost:3000/api/definitions');
console.log('  POST http://localhost:3000/api/execute');
console.log('\nExample code:');
console.log('  const pets = await api.listPets({ limit: 10 });');
console.log('  return pets;\n');
