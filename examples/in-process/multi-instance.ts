/**
 * Multi-Instance In-Process Example
 *
 * This example demonstrates the main benefit of in-process mode:
 * running multiple isolated client-server pairs without port conflicts.
 *
 * This is particularly useful for:
 * - MCP stdio servers where each process needs its own ATP instance
 * - Testing multiple configurations in parallel
 * - Microservice-like isolation without network overhead
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

async function createInstance(
	name: string,
	tools: Array<{ name: string; handler: (input: any) => Promise<any> }>
) {
	const server = createServer();

	for (const tool of tools) {
		server.tool(tool.name, {
			description: `Tool: ${tool.name}`,
			input: {},
			handler: tool.handler,
		});
	}

	const client = new AgentToolProtocolClient({ server });
	await client.init({ name, version: '1.0.0' });

	return client;
}

async function main() {
	console.log('=== Multi-Instance In-Process Example ===\n');
	console.log('Creating 3 isolated ATP instances without port conflicts...\n');

	const [instance1, instance2, instance3] = await Promise.all([
		createInstance('database-agent', [
			{
				name: 'query',
				handler: async () => ({
					rows: [
						{ id: 1, name: 'Alice' },
						{ id: 2, name: 'Bob' },
					],
				}),
			},
		]),
		createInstance('email-agent', [
			{
				name: 'send',
				handler: async () => ({ sent: true, messageId: 'msg-123' }),
			},
		]),
		createInstance('analytics-agent', [
			{
				name: 'getMetrics',
				handler: async () => ({ users: 1000, revenue: 50000, growth: 15.5 }),
			},
		]),
	]);

	console.log('✓ All 3 instances created successfully (no port conflicts!)\n');

	console.log('Executing on all instances in parallel...\n');

	const [dbResult, emailResult, analyticsResult] = await Promise.all([
		instance1.execute('return await api.custom.query({})'),
		instance2.execute('return await api.custom.send({})'),
		instance3.execute('return await api.custom.getMetrics({})'),
	]);

	console.log('Database Agent Result:', dbResult.result);
	console.log('Email Agent Result:', emailResult.result);
	console.log('Analytics Agent Result:', analyticsResult.result);

	console.log('\n=== All instances completed successfully ===');
}

main().catch(console.error);
