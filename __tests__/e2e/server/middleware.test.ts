/**
 * Middleware tests
 * Tests custom CORS, rate limiting, and API key authentication middleware
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import type { Middleware } from '@mondaydotcomorg/atp-server';

describe('Middleware', () => {
	let server: any;
	let port: number;

	const getTestPort = () => 3503 + Math.floor(Math.random() * 500);
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
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-e2e-tests-' + Date.now();
	});

	beforeEach(() => {
		port = getTestPort(); // Fresh port for each test to avoid port conflicts
	});

	afterEach(async () => {
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

	test('should apply CORS middleware', async () => {
		server = createServer();

		const corsMiddleware: Middleware = async (ctx, next) => {
			const origin = ctx.headers['origin'];
			if (origin === 'https://example.com') {
				ctx.set('Access-Control-Allow-Origin', origin);
			}
			await next();
		};

		server.use(corsMiddleware);

		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/info`, {
			headers: { Origin: 'https://example.com' },
		});

		expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com');
	});

	test('should apply rate limiting middleware', async () => {
		server = createServer();

		const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
		const rateLimitMiddleware: Middleware = async (ctx, next) => {
			const key = `ratelimit:${ctx.path}`;
			const limit = 2;
			const windowMs = 60 * 1000;

			const entry = rateLimitStore.get(key);
			if (entry && Date.now() < entry.resetTime) {
				if (entry.count >= limit) {
					ctx.status = 429;
					ctx.responseBody = { error: 'Rate limit exceeded' };
					return;
				}
				entry.count++;
			} else {
				rateLimitStore.set(key, { count: 1, resetTime: Date.now() + windowMs });
			}

			await next();
		};

		server.use(rateLimitMiddleware);

		await server.listen(port);
		await waitForServer(port);

		await fetch(`http://localhost:${port}/api/info`);
		await fetch(`http://localhost:${port}/api/info`);

		const response = await fetch(`http://localhost:${port}/api/info`);
		expect(response.status).toBe(429);
	});

	test('should apply API key authentication', async () => {
		server = createServer();

		const apiKeyAuthMiddleware: Middleware = async (ctx, next) => {
			const apiKey = ctx.headers['x-api-key'];

			if (!apiKey) {
				ctx.status = 401;
				ctx.responseBody = { error: 'API key required' };
				return;
			}

			if (apiKey !== 'test-key-123') {
				ctx.status = 403;
				ctx.responseBody = { error: 'Invalid API key' };
				return;
			}

			ctx.user = { apiKey };
			await next();
		};

		server.use(apiKeyAuthMiddleware);

		await server.listen(port);

		// Just give server time to start
		await new Promise((resolve) => setTimeout(resolve, 100));

		const responseNoKey = await fetch(`http://localhost:${port}/api/info`);
		expect(responseNoKey.status).toBe(401);

		const responseInvalidKey = await fetch(`http://localhost:${port}/api/info`, {
			headers: { 'X-API-Key': 'invalid' },
		});
		expect(responseInvalidKey.status).toBe(403);

		const responseValidKey = await fetch(`http://localhost:${port}/api/info`, {
			headers: { 'X-API-Key': 'test-key-123' },
		});
		expect(responseValidKey.status).toBe(200);
	});

	test('should chain multiple middleware', async () => {
		server = createServer();

		const corsMiddleware: Middleware = async (ctx, next) => {
			ctx.set('Access-Control-Allow-Origin', '*');
			await next();
		};

		const authMiddleware: Middleware = async (ctx, next) => {
			const apiKey = ctx.headers['x-api-key'];
			if (apiKey === 'valid-key') {
				ctx.user = { apiKey };
			}
			await next();
		};

		server.use(corsMiddleware, authMiddleware);

		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/info`);
		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBeDefined();
	});

	test('should handle OPTIONS preflight', async () => {
		server = createServer();

		const corsMiddleware: Middleware = async (ctx, next) => {
			const origin = ctx.headers['origin'];
			if (origin === 'https://app.example.com') {
				ctx.set('Access-Control-Allow-Origin', origin);
			}
			ctx.set('Access-Control-Allow-Methods', 'GET, POST');
			ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

			if (ctx.method === 'OPTIONS') {
				ctx.status = 204;
				ctx.responseBody = null;
				return;
			}

			await next();
		};

		server.use(corsMiddleware);

		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/info`, {
			method: 'OPTIONS',
			headers: { Origin: 'https://app.example.com' },
		});

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-methods')).toContain('GET');
		expect(response.headers.get('access-control-allow-methods')).toContain('POST');
	});
});
