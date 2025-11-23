import { createServer } from '@mondaydotcomorg/atp-server';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.MONDAY_API_TOKEN;
if (!token) {
	console.error('Please set MONDAY_API_TOKEN environment variable');
	process.exit(1);
}

const server = createServer();

// Load Monday.com GraphQL API
await server.loadGraphQL('https://api.monday.com/v2/get_schema?version=2025-10&format=sdl', {
	name: 'monday',
	url: 'https://api.monday.com/v2',
	headers: {
		'Authorization': token,
		'API-Version': '2025-10'
	},
	queryDepthLimit: 2
});

await server.listen(3000);
console.log('Monday.com GraphQL Agent Server running on http://localhost:3000');
console.log('\nTry exploring the API:');
console.log('  GET http://localhost:3000/api/explore?path=/');
console.log('  GET http://localhost:3000/api/explore?path=/monday/query');
