import { createServer, loadOpenAPI } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { MCPConnector } from '@mondaydotcomorg/atp-mcp-adapter';

process.env.ATP_JWT_SECRET = process.env.ATP_JWT_SECRET || 'test-secret-key';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
	const server = createServer({});

	const petstore = await loadOpenAPI('https://petstore.swagger.io/v2/swagger.json', {
		name: 'petstore',
		filter: { methods: ['GET'] },
	});

	const mcpConnector = new MCPConnector();
	const playwright = await mcpConnector.connectToMCPServer({
		name: 'playwright',
		command: 'npx',
		args: ['@playwright/mcp@latest'],
	});

	server.use([petstore, playwright]);
	await server.listen(3333);

	const client = new AgentToolProtocolClient({
		baseUrl: 'http://localhost:3333',
	});
	await client.init({ name: 'quickstart', version: '1.0.0' });

	const result = await client.execute(`
		const pets = await api.petstore.findPetsByStatus({ status: 'available' });
		
		const categories = pets
			.filter(p => p.category?.name)
			.map(p => p.category.name)
			.filter((v, i, a) => a.indexOf(v) === i);
		
		return {
			totalPets: pets.length,
			categories: categories.slice(0, 5),
			sample: pets.slice(0, 3).map(p => ({
				name: p.name,
				status: p.status
			}))
		};
	`);

	console.log('Result:', JSON.stringify(result.result, null, 2));
	process.exit(0);
}

main().catch(console.error);
