import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

async function main() {
	const client = new AgentToolProtocolClient({
		baseUrl: 'http://localhost:3000',
	});

	await client.init({
		name: 'monday-graphql-agent',
		version: '1.0.0',
	});

	console.log('🤖 Connecting to Monday.com GraphQL Agent...');

	try {
		// Simple script to fetch boards and then items from the first board
		const script = `
			// Fetch boards
			const boardsData = await api.monday.query_boards({ limit: 5 });
			const boards = boardsData.boards || [];
			
			console.log(\`Found \${boards.length} boards\`);
			
			if (boards.length === 0) {
				return { message: 'No boards found' };
			}
			
			const firstBoard = boards[0];
			console.log(\`Fetching items for board: \${firstBoard.name} (ID: \${firstBoard.id})\`);
			
			// Fetch items for the first board
			// Note: We need to pass ids as an array of strings or numbers depending on schema
			// The schema usually expects [ID!]
			const itemsData = await api.monday.query_items({ 
				ids: [firstBoard.id] 
			});
			
			const items = itemsData.items || [];
			console.log(\`Found \${items.length} items\`);
			
			return {
				board: {
					id: firstBoard.id,
					name: firstBoard.name,
					description: firstBoard.description
				},
				itemsCount: items.length,
				sampleItems: items.slice(0, 3).map(item => ({
					id: item.id,
					name: item.name
				}))
			};
		`;

		console.log('🚀 Executing agent script...');
		const result = await client.execute(script);

		console.log('\n✅ Execution Result:');
		console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		console.error('❌ Error executing script:', error);
	}
}

main();
