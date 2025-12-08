/**
 * Tests for preRequestHook functionality
 */

import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import type { PreRequestContext, PreRequestHook, ClientHooks } from '@mondaydotcomorg/atp-client';
import { createServer } from '@mondaydotcomorg/atp-server';
import { randomUUID } from 'node:crypto';

describe('PreRequestHook', () => {
	let server: any;
	let port: number;
	let serverUrl: string;

	const getTestPort = () => 3700 + Math.floor(Math.random() * 500);
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

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-pre-request-hook-' + Date.now();
		port = getTestPort();
		serverUrl = `http://localhost:${port}`;

		server = createServer();

		// Add a simple test tool
		server.tool('testTool', {
			description: 'A test tool',
			input: {},
			handler: async () => {
				return { success: true };
			},
		});

		await server.listen(port);
		await waitForServer(port);
	});

	afterAll(async () => {
		if (server) {
			try {
				await server.stop();
			} catch (error) {
				// Ignore
			}
		}
		delete process.env.ATP_JWT_SECRET;
	});

	it('should call preRequest hook before each request', async () => {
		const hookCalls: PreRequestContext[] = [];

		const hooks: ClientHooks = {
			preRequest: async (context) => {
				hookCalls.push({ ...context });
				return { headers: context.currentHeaders };
			},
		};

		const client = new AgentToolProtocolClient({
			baseUrl: serverUrl,
			headers: { Authorization: 'Bearer initial-token' },
			hooks,
		});

		await client.init({ name: 'test-client' });
		await client.connect();

		// Should have called hook for init and connect
		expect(hookCalls.length).toBeGreaterThanOrEqual(2);
		expect(hookCalls[0].url).toContain('/api/init');
		expect(hookCalls[1].url).toContain('/api/definitions');
	});

	it('should update headers from preRequest hook', async () => {
		let tokenRefreshCount = 0;

		const hooks: ClientHooks = {
			preRequest: async (context) => {
				tokenRefreshCount++;
				return {
					headers: {
						...context.currentHeaders,
						Authorization: `Bearer refreshed-token-${tokenRefreshCount}`,
						'X-Request-Count': String(tokenRefreshCount),
					},
				};
			},
		};

		const client = new AgentToolProtocolClient({ baseUrl: serverUrl, hooks });

		await client.init({ name: 'test-client' });
		await client.connect();

		// Token should have been refreshed multiple times
		expect(tokenRefreshCount).toBeGreaterThanOrEqual(2);
	});

	it('should allow logging in preRequest hook', async () => {
		const requestLog: Array<{ method: string; url: string }> = [];

		const hooks: ClientHooks = {
			preRequest: async (context) => {
				requestLog.push({
					method: context.method,
					url: context.url,
				});
				return { headers: context.currentHeaders };
			},
		};

		const client = new AgentToolProtocolClient({ baseUrl: serverUrl, hooks });

		await client.init({ name: 'test-client' });
		await client.connect();

		expect(requestLog.length).toBeGreaterThanOrEqual(2);
		expect(requestLog[0]).toMatchObject({
			method: 'POST',
			url: expect.stringContaining('/api/init'),
		});
		expect(requestLog[1]).toMatchObject({
			method: 'GET',
			url: expect.stringContaining('/api/definitions'),
		});
	});

	it('should abort request when hook returns abort: true', async () => {
		const hooks: ClientHooks = {
			preRequest: async (context) => {
				if (context.url.includes('/api/definitions')) {
					return {
						abort: true,
						abortReason: 'Test abort',
					};
				}
				return { headers: context.currentHeaders };
			},
		};

		const client = new AgentToolProtocolClient({ baseUrl: serverUrl, hooks });

		await client.init({ name: 'test-client' });

		await expect(client.connect()).rejects.toThrow('Test abort');
	});

	it('should handle errors from preRequest hook', async () => {
		const hooks: ClientHooks = {
			preRequest: async (context) => {
				if (context.url.includes('/api/definitions')) {
					throw new Error('Hook error');
				}
				return { headers: context.currentHeaders };
			},
		};

		const client = new AgentToolProtocolClient({ baseUrl: serverUrl, hooks });

		await client.init({ name: 'test-client' });

		await expect(client.connect()).rejects.toThrow('Hook error');
	});

	it('should pass request body to hook', async () => {
		let capturedBody: unknown = null;

		const hooks: ClientHooks = {
			preRequest: async (context) => {
				if (context.method === 'POST' && context.body) {
					capturedBody = context.body;
				}
				return { headers: context.currentHeaders };
			},
		};

		const client = new AgentToolProtocolClient({ baseUrl: serverUrl, hooks });

		await client.init({ name: 'test-client', version: '1.0.0' });

		expect(capturedBody).toBeTruthy();
		expect(typeof capturedBody).toBe('string');
		const parsed = JSON.parse(capturedBody as string);
		expect(parsed.clientInfo).toMatchObject({
			name: 'test-client',
			version: '1.0.0',
		});
	});

	it('should support token refresh scenario', async () => {
		let currentToken = 'initial-token';
		let refreshCallCount = 0;

		// Simulate a token refresh function
		const refreshToken = async (): Promise<string> => {
			refreshCallCount++;
			await new Promise((resolve) => setTimeout(resolve, 10));
			currentToken = `refreshed-token-${refreshCallCount}`;
			return currentToken;
		};

		const hooks: ClientHooks = {
			preRequest: async (context) => {
				// Refresh token before each request
				const token = await refreshToken();

				return {
					headers: {
						...context.currentHeaders,
						Authorization: `Bearer ${token}`,
					},
				};
			},
		};

		const client = new AgentToolProtocolClient({ baseUrl: serverUrl, hooks });

		await client.init({ name: 'test-client' });
		await client.connect();
		await client.getServerInfo();

		// Should have refreshed token for each request
		expect(refreshCallCount).toBeGreaterThanOrEqual(3);
		expect(currentToken).toMatch(/^refreshed-token-\d+$/);
	});

	it('should work without hooks (backward compatibility)', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: serverUrl,
			headers: { Authorization: 'Bearer static-token' },
		});

		await client.init({ name: 'test-client' });
		await client.connect();

		const info = await client.getServerInfo();
		expect(info).toHaveProperty('version');
	});

	it('should provide correct currentHeaders in context', async () => {
		let capturedHeaders: Record<string, string> | null = null;

		const hooks: ClientHooks = {
			preRequest: async (context) => {
				if (context.url.includes('/api/definitions')) {
					capturedHeaders = { ...context.currentHeaders };
				}
				return { headers: context.currentHeaders };
			},
		};

		const client = new AgentToolProtocolClient({
			baseUrl: serverUrl,
			headers: {
				Authorization: 'Bearer test-token',
				'X-Custom-Header': 'custom-value',
			},
			hooks,
		});

		await client.init({ name: 'test-client' });
		await client.connect();

		expect(capturedHeaders).toBeTruthy();
		expect(capturedHeaders).toMatchObject({
			'Content-Type': 'application/json',
			Authorization: expect.stringContaining('Bearer'),
			'X-Client-ID': expect.any(String),
		});
	});

	it('should call hook for execute requests', async () => {
		const hookCalls: string[] = [];

		const hooks: ClientHooks = {
			preRequest: async (context) => {
				hookCalls.push(context.url);
				return { headers: context.currentHeaders };
			},
		};

		const client = new AgentToolProtocolClient({ baseUrl: serverUrl, hooks });

		await client.init({ name: 'test-client' });
		await client.connect();

		hookCalls.length = 0; // Clear previous calls

		await client.execute('return { result: "test" }');

		expect(hookCalls.length).toBeGreaterThanOrEqual(1);
		expect(hookCalls[0]).toContain('/api/execute');
	});
});
