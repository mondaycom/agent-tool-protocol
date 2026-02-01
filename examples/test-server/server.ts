/**
 * Minimal ATP Test Server for LangChain Integration Testing
 *
 * This server uses SHORT token TTL (5 seconds) to demonstrate and test
 * the automatic token refresh feature. In production, use longer TTLs.
 *
 * Run with: npx tsx server.ts
 */
import { config } from 'dotenv';
config({ path: '../../.env' });

// Set default JWT secret for development/testing if not provided
if (!process.env.ATP_JWT_SECRET) {
	process.env.ATP_JWT_SECRET = 'test-key';
	console.log(
		'⚠️  Using default JWT secret "test-key" for development. Set ATP_JWT_SECRET for production.'
	);
}

import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';

async function main() {
	// Create ATP server with SHORT token TTL for testing auto-refresh
	// In production, use longer TTLs (e.g., 1 hour default)
	const server = new AgentToolProtocolServer({
		execution: { timeout: 30000 },
/*		clientInit: {
			tokenTTL: 10000, // 10 seconds for testing
			tokenRotation: 5000,
		}*/
	});

	// Register tools
	server.tool('echo', {
		description: 'Echo back a message',
		input: { message: 'string' },
		handler: async (params) => {
			const { message } = params as { message: string };
			return { echoed: message, timestamp: Date.now() };
		},
	});

	server.tool('add', {
		description: 'Add two numbers',
		input: { a: 'number', b: 'number' },
		handler: async (params) => {
			const { a, b } = params as { a: number; b: number };
			return { result: a + b };
		},
	});

	await server.listen(3333);

	console.log('🚀 ATP Test Server started on http://localhost:3333');
	console.log('📋 Available APIs: test.echo, test.add');
	console.log('✨ Client services enabled (LLM & approval support)');
}

main().catch((error) => {
	console.error('❌ Server error:', error);
	process.exit(1);
});
