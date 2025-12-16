/**
 * Simple test to verify streaming events work
 */
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ATPEventType } from '@mondaydotcomorg/atp-protocol';
import { server } from './server.js';

async function main() {
	const client = new AgentToolProtocolClient({ server });
	await client.init({ name: 'test', version: '1.0.0' });
	await client.connect();

	console.log('🧪 Testing ATP Streaming Events\n');
	console.log('═'.repeat(50));

	const eventCounts: Record<string, number> = {};

	const result = await client.execute(`await api.custom.research({ topic: "AI", depth: 2 })`, {
		eventCallback: (event) => {
			eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;

			const icons: Record<string, string> = {
				thinking: '💭',
				tool_start: '🔧',
				tool_end: '✅',
				text: '📝',
				source: '📚',
				progress: '📊',
			};
			const icon = icons[event.type] || '📨';
			const dataStr = JSON.stringify(event.data);
			console.log(`${icon} [${event.type}] ${dataStr.substring(0, 70)}${dataStr.length > 70 ? '...' : ''}`);
		},
	});

	console.log('\n' + '═'.repeat(50));
	console.log('📊 Event Summary:');
	for (const [type, count] of Object.entries(eventCounts).sort()) {
		console.log(`   ${type}: ${count}`);
	}
	console.log('═'.repeat(50));
	console.log('✅ Test completed!');
}

main().catch(console.error);

