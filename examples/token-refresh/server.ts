/**
 * Token Refresh Example
 *
 * Demonstrates ATP's built-in automatic token refresh feature.
 * The ATP client automatically refreshes tokens before they expire,
 * eliminating the need for manual token management in most cases.
 *
 * Run this with the test-server example (which has short token TTL):
 *   1. In one terminal: cd examples/test-server && npx tsx server.ts
 *   2. In another terminal: cd examples/token-refresh && npx tsx server.ts
 */

import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Example: ATP Client with automatic token refresh (default behavior)
 */
async function main() {
	console.log('='.repeat(60));
	console.log('ATP Automatic Token Refresh Demo');
	console.log('='.repeat(60));

	// Create ATP client - automatic token refresh is enabled by default
	const client = new AgentToolProtocolClient({
		baseUrl: process.env.ATP_SERVER_URL || 'http://localhost:3333',
		hooks: {
			preRequest: async (context) => {
				console.log('[Hook] Request to:', context.url);
				return { headers: context.currentHeaders };
			},
		},
	});

	console.log('\n=== Initializing ATP Client ===');
	const initResult = await client.init({ name: 'token-refresh-example', version: '1.0.0' });

	console.log('Current time:', new Date());
	console.log('Client ID:', initResult.clientId);
	console.log('Token expires at:', new Date(initResult.expiresAt));
	console.log('Token rotates at:', new Date(initResult.tokenRotateAt));

	const tokenTTL = initResult.expiresAt - Date.now();
	const rotateIn = initResult.tokenRotateAt - Date.now();
	console.log(`Token TTL: ${Math.round(tokenTTL / 1000)}s, Rotate in: ${Math.round(rotateIn / 1000)}s`);

	console.log('\n=== Connecting to Server ===');
	await client.connect();

	console.log(await client.getTypeDefinitions());
	console.log(await client.exploreAPI('/custom'));
	console.log(await client.searchAPI('add'));
	console.log(await client.searchAPI('echo'));

	// First execution - should use original token
	console.log('\n=== First Execution (using original token) ===');
	const result1 = await client.execute(`
		const t = api.custom.add({ a: 2, b: 3 });  
		const result = {
			timestamp: Date.now(),
			message: "First call with original token"
		};
		return result;
	`);
	console.log('Result:', JSON.stringify(result1.result, null, 2));

	// Wait past the rotation time (test-server uses 2.5s rotation for 5s TTL)
	const waitTime = Math.max(rotateIn + 500, 10000);
	console.log(`\n=== Waiting ${waitTime / 1000}s to trigger token rotation ===`);
	await wait(waitTime);

	// Second execution - should automatically refresh token before calling
	console.log('\n=== Second Execution (token should auto-refresh) ===');
	const result2 = await client.execute(`
		const result = {
			timestamp: Date.now(),
			message: "Second call - token was auto-refreshed!"
		};
		return result;
	`);
	console.log('Result:', JSON.stringify(result2.result, null, 2));

	// Third execution - should still work
	console.log('\n=== Third Execution (continued use) ===');
	const result3 = await client.execute(`
		const result = {
			timestamp: Date.now(),
			message: "Third call - everything still works!"
		};
		return result;
	`);
	console.log('Result:', JSON.stringify(result3.result, null, 2));

	console.log('\n=== Getting Server Info ===');
	const info = await client.getServerInfo();
	console.log('Server version:', info.version);

	console.log('\n' + '='.repeat(60));
	console.log('✅ All requests completed with automatic token refresh!');
	console.log('='.repeat(60));
	console.log('\nKey takeaways:');
	console.log('1. Token refresh happens automatically before each request');
	console.log('2. No manual token management code needed');
	console.log('3. Requests never fail due to expired tokens');
	console.log('4. Works with short-lived tokens (even 5-second TTL)');
}

// Run examples
main()
	.catch((error) => {
		console.error('Error:', error);
		process.exit(1);
	});
