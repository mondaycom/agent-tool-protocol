/**
 * Framework Integration Tests
 * Tests the handler(), toExpress(), and toFastify() methods for framework integration
 */

import { createServer as createHTTPServer } from 'node:http';
import { createServer } from '@mondaydotcomorg/atp-server';
import { randomUUID } from 'node:crypto';

describe('Framework Integration', () => {
	const getTestPort = () => 4000 + Math.floor(Math.random() * 500);
	let server: any;
	let httpServer: any;
	let port: number;

	const waitForServer = async (port: number, maxAttempts = 10) => {
		for (let i = 0; i < maxAttempts; i++) {
			try {
				await fetch(`http://localhost:${port}/api/info`);
				return;
			} catch (e) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
	};

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-framework-integration-' + Date.now();
		port = getTestPort();
	});

	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
			httpServer = null;
		}
		if (server) {
			try {
				await server.stop();
			} catch (error) {
				// Ignore
			}
			server = null;
		}
	});

	afterAll(() => {
		delete process.env.ATP_JWT_SECRET;
	});

	test('should work with raw Node.js handler', async () => {
		server = createServer();

		// Add a test tool
		server.tool('echo', {
			description: 'Echo back input',
			input: { message: 'string' },
			handler: async (input: unknown) => {
				const { message } = input as { message: string };
				return { echo: message };
			},
		});

		// Initialize ATP server
		await server.listen(9999);
		await server.stop();

		// Get raw handler
		const atpHandler = server.handler();

		// Create custom HTTP server
		httpServer = createHTTPServer(async (req, res) => {
			// Custom routing - mount ATP at /atp
			if (req.url?.startsWith('/atp/')) {
				// Strip /atp prefix
				req.url = req.url.replace('/atp', '');
				await atpHandler(req, res);
			} else if (req.url === '/health') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ status: 'ok' }));
			} else {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Not found' }));
			}
		});

		await new Promise<void>((resolve) => {
			httpServer.listen(port, resolve);
		});
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Test health endpoint
		const healthResponse = await fetch(`http://localhost:${port}/health`);
		expect(healthResponse.status).toBe(200);
		const healthData: any = await healthResponse.json();
		expect(healthData.status).toBe('ok');

		// Test ATP info endpoint
		const infoResponse = await fetch(`http://localhost:${port}/atp/api/info`);
		expect(infoResponse.status).toBe(200);
		const infoData: any = await infoResponse.json();
		expect(infoData.version).toBeDefined();

		// Test 404
		const notFoundResponse = await fetch(`http://localhost:${port}/nonexistent`);
		expect(notFoundResponse.status).toBe(404);
	});

	test('should handle init, definitions, and execute with raw handler', async () => {
		server = createServer();

		server.tool('greet', {
			description: 'Greet someone',
			input: { name: 'string' },
			handler: async (input: unknown) => {
				const { name } = input as { name: string };
				return { greeting: `Hello, ${name}!` };
			},
		});

		// Initialize
		await server.listen(9999);
		await server.stop();

		const atpHandler = server.handler();

		httpServer = createHTTPServer(async (req, res) => {
			await atpHandler(req, res);
		});

		await new Promise<void>((resolve) => {
			httpServer.listen(port, resolve);
		});
		await waitForServer(port);

		// Initialize client session
		const initResponse = await fetch(`http://localhost:${port}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'test-client' } }),
		});
		expect(initResponse.status).toBe(200);
		const initData: any = await initResponse.json();
		const clientId = initData.clientId;
		const token = initData.token;

		// Get definitions
		const defsResponse = await fetch(`http://localhost:${port}/api/definitions`, {
			headers: {
				'X-Client-ID': clientId,
				Authorization: `Bearer ${token}`,
			},
		});
		expect(defsResponse.status).toBe(200);
		const defsData: any = await defsResponse.json();
		expect(defsData.typescript).toContain('greet');

		// Execute code
		const executeResponse = await fetch(`http://localhost:${port}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Client-ID': clientId,
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				code: `
					const result = await api.custom.greet({ name: 'World' });
					return result.greeting;
				`,
			}),
		});
		expect(executeResponse.status).toBe(200);
		const executeData: any = await executeResponse.json();
		expect(executeData.result).toBe('Hello, World!');
	});

	test('should support custom middleware with raw handler', async () => {
		server = createServer();

		server.tool('test', {
			description: 'Test tool',
			input: { value: 'string' },
			handler: async (input: unknown) => {
				return { result: (input as { value: string }).value };
			},
		});

		// Initialize
		await server.listen(9999);
		await server.stop();

		const atpHandler = server.handler();

		// Create server with custom auth middleware
		httpServer = createHTTPServer(async (req, res) => {
			// Custom API key authentication
			const apiKey = req.headers['x-api-key'];

			if (req.url?.startsWith('/api/execute')) {
				// Only protect execute endpoint
				if (!apiKey || apiKey !== 'valid-key') {
					res.writeHead(403, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Invalid API key' }));
					return;
				}
			}

			await atpHandler(req, res);
		});

		await new Promise<void>((resolve) => {
			httpServer.listen(port, resolve);
		});
		await waitForServer(port);

		// Init works without API key
		const initResponse = await fetch(`http://localhost:${port}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		expect(initResponse.status).toBe(200);
		const { clientId, token } = (await initResponse.json()) as any;

		// Execute without API key should fail
		const executeNoKeyResponse = await fetch(`http://localhost:${port}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Client-ID': clientId,
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ code: 'return "test"' }),
		});
		expect(executeNoKeyResponse.status).toBe(403);

		// Execute with valid key should work
		const executeWithKeyResponse = await fetch(`http://localhost:${port}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-API-Key': 'valid-key',
				'X-Client-ID': clientId,
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ code: 'return "success"' }),
		});
		expect(executeWithKeyResponse.status).toBe(200);
		const executeData: any = await executeWithKeyResponse.json();
		expect(executeData.result).toBe('success');
	});

	test('should handle errors gracefully in framework integration', async () => {
		server = createServer();

		// Initialize
		await server.listen(9999);
		await server.stop();

		const atpHandler = server.handler();

		httpServer = createHTTPServer(async (req, res) => {
			try {
				await atpHandler(req, res);
			} catch (error) {
				// Custom error handling
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Server error' }));
			}
		});

		await new Promise<void>((resolve) => {
			httpServer.listen(port, resolve);
		});
		await waitForServer(port);

		// Test that server handles requests properly
		const response = await fetch(`http://localhost:${port}/api/info`);
		expect(response.status).toBe(200);
	});

	test('should work with CORS and custom headers', async () => {
		server = createServer();

		// Initialize
		await server.listen(9999);
		await server.stop();

		const atpHandler = server.handler();

		// Create server with CORS middleware
		httpServer = createHTTPServer(async (req, res) => {
			// Add CORS headers
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-ID');

			if (req.method === 'OPTIONS') {
				res.writeHead(204);
				res.end();
				return;
			}

			await atpHandler(req, res);
		});

		await new Promise<void>((resolve) => {
			httpServer.listen(port, resolve);
		});
		await waitForServer(port);

		// Test OPTIONS request
		const optionsResponse = await fetch(`http://localhost:${port}/api/info`, {
			method: 'OPTIONS',
		});
		expect(optionsResponse.status).toBe(204);

		// Test regular request with CORS headers
		const response = await fetch(`http://localhost:${port}/api/info`);
		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
	});
});
