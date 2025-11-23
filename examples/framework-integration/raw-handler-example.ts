/**
 * Raw Node.js Handler Example
 * Shows how to use ATP with raw Node.js HTTP server or custom frameworks
 */

import { createServer as createHTTPServer } from 'node:http';
import { createServer } from '@mondaydotcomorg/atp-server';

const atpServer = createServer();

// Add some custom tools
atpServer.tool('greet', {
	description: 'Greet someone by name',
	input: { name: 'string' },
	handler: async (input: unknown) => {
		const { name } = input as { name: string };
		return { greeting: `Hello, ${name}!` };
	},
});

atpServer.tool('calculate', {
	description: 'Perform basic math operations',
	input: {
		operation: 'string',
		a: 'number',
		b: 'number',
	},
	handler: async (input: unknown) => {
		const { operation, a, b } = input as { operation: string; a: number; b: number };
		switch (operation) {
			case 'add':
				return { result: a + b };
			case 'subtract':
				return { result: a - b };
			case 'multiply':
				return { result: a * b };
			case 'divide':
				return { result: a / b };
			default:
				throw new Error('Invalid operation');
		}
	},
});

// Get the raw request handler - components will be initialized on first request
const atpHandler = atpServer.handler();

// Create custom HTTP server with your own routing and middleware
const server = createHTTPServer(async (req, res) => {
	// Custom CORS
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-ID');

	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	// Custom authentication (optional - only validates if API_KEYS is set)
	const apiKey = req.headers['x-api-key'];
	if (req.url?.startsWith('/api/') && process.env.API_KEYS) {
		if (!apiKey) {
			res.writeHead(401, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'API key required' }));
			return;
		}

		const validKeys = process.env.API_KEYS.split(',');
		if (!validKeys.includes(apiKey as string)) {
			res.writeHead(403, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Invalid API key' }));
			return;
		}
	}

	// Route requests
	if (req.url?.startsWith('/api/')) {
		// Forward to ATP handler
		await atpHandler(req, res);
	} else if (req.url === '/' || req.url === '') {
		// Custom route
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				message: 'ATP Server with Raw Node.js',
				atpEndpoint: '/api/info',
			})
		);
	} else {
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	}
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	console.log(`Raw Node.js server with ATP running on http://localhost:${PORT}`);
	console.log(`ATP Info: http://localhost:${PORT}/api/info`);
});
