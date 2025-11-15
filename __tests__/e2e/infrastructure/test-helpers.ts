import { AgentToolProtocolServer, createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let portCounter = 5000;

export function getTestPort(): number {
	return portCounter++;
}

/**
 * Kill any process listening on the specified port
 * This helps clean up zombie processes from previous test runs
 */
export async function killPortProcess(port: number): Promise<void> {
	try {
		const { stdout } = await execAsync(`lsof -ti :${port} 2>/dev/null || true`);
		const pid = stdout.trim();

		if (pid && pid.length > 0) {
			await execAsync(`kill -9 ${pid} 2>/dev/null || true`);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	} catch (error) {
		// Ignore errors - port might not be in use
	}
}

export async function waitForServer(port: number, maxAttempts: number = 20): Promise<void> {
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const response = await fetch(`http://localhost:${port}/api/info`);
			if (response.ok) {
				return;
			}
		} catch (e) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`Server did not start on port ${port} after ${maxAttempts} attempts`);
}

export interface TestServerConfig {
	port?: number;
	apiGroups?: any[];
	execution?: {
		timeout?: number;
		memory?: number;
		llmCalls?: number;
	};
	enableAuth?: boolean;
	approvalHandler?: (request: {
		message: string;
		context?: any;
	}) => Promise<{ approved: boolean; data?: any }>;
}

export interface TestServer {
	server: AgentToolProtocolServer;
	port: number;
	stop: () => Promise<void>;
}

export async function createTestATPServer(config: TestServerConfig = {}): Promise<TestServer> {
	let port = config.port || getTestPort();
	let lastError: Error | null = null;

	// Try up to 3 times with different ports if there's a conflict
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			// Clean up any zombie process on this port first
			await killPortProcess(port);

			const cacheProvider = new MemoryCache();

			const server = createServer({
				execution: {
					timeout: config.execution?.timeout || 30000,
					memory: config.execution?.memory || 128 * 1024 * 1024,
					llmCalls: config.execution?.llmCalls || 10,
				},
				providers: {
					cache: cacheProvider,
				},
				logger: 'error',
			});

			if (config.apiGroups) {
				for (const group of config.apiGroups) {
					server.use(group);
				}
			}

			if (config.approvalHandler) {
				server.onApproval(config.approvalHandler);
			}

			await server.listen(port);
			await waitForServer(port);

			return {
				server,
				port,
				stop: async () => {
					await server.stop();
				},
			};
		} catch (error: any) {
			lastError = error;

			if (error.message?.includes('EADDRINUSE') || error.code === 'EADDRINUSE') {
				port = getTestPort();
				await new Promise((resolve) => setTimeout(resolve, 200));
				continue;
			}

			throw error;
		}
	}

	throw new Error(
		`Failed to create test server after 3 attempts. Last error: ${lastError?.message}`
	);
}

export interface OAuthSetup {
	accessToken: string;
	refreshToken: string;
	scopes: string[];
	userId: string;
}

export async function setupMockOAuth(
	oauthProviderPort: number,
	userId: string,
	scopes: string[]
): Promise<OAuthSetup> {
	const MockOAuthProvider = (await import('./mock-servers/oauth-provider-mock')).MockOAuthProvider;
	const provider = new MockOAuthProvider(oauthProviderPort);

	const tokenResponse = provider.issueToken(userId, scopes);

	return {
		accessToken: tokenResponse.access_token,
		refreshToken: tokenResponse.refresh_token!,
		scopes: tokenResponse.scope.split(' '),
		userId,
	};
}

export interface CleanupTracker {
	servers: TestServer[];
	httpServers: any[];
	clients: AgentToolProtocolClient[];
}

export function createCleanupTracker(): CleanupTracker {
	return {
		servers: [],
		httpServers: [],
		clients: [],
	};
}

export async function cleanupAll(tracker: CleanupTracker): Promise<void> {
	// Cleanup all ATP servers
	for (const server of tracker.servers) {
		try {
			await Promise.race([
				server.stop(),
				new Promise<void>((resolve) => setTimeout(resolve, 2000)),
			]);
		} catch (e) {
			try {
				const port = server.port;
				await killPortProcess(port);
			} catch (killError) {
				// Ignore
			}
		}
	}

	for (const httpServer of tracker.httpServers) {
		try {
			const stopPromise = new Promise<void>((resolve, reject) => {
				if (httpServer.stop) {
					httpServer.stop().then(resolve).catch(reject);
				} else if (httpServer.close) {
					httpServer.close((err: any) => {
						if (err) reject(err);
						else resolve();
					});
				} else {
					resolve();
				}
			});

			await Promise.race([stopPromise, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);

			if ((httpServer as any).server) {
				(httpServer as any).server.closeAllConnections?.();
			}
		} catch (e) {
			// Ignore errors during cleanup
		}
	}

	for (const client of tracker.clients) {
		try {
			(client as any).serviceProviders = null;
		} catch (e) {
			// Ignore
		}
	}

	tracker.servers = [];
	tracker.httpServers = [];
	tracker.clients = [];

	await new Promise((resolve) => setTimeout(resolve, 100));
}

export function createTestClient(baseUrl: string): AgentToolProtocolClient {
	return new AgentToolProtocolClient({
		baseUrl,
	});
}

export function loadOpenAPISpec(specName: string): any {
	const specPath = join(__dirname, 'openapi-specs', `${specName}.json`);
	const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
	return spec;
}

export function replacePortInSpec(spec: any, portMap: Record<string, number>): any {
	const specStr = JSON.stringify(spec);
	let replaced = specStr;

	for (const [key, port] of Object.entries(portMap)) {
		replaced = replaced.replace(new RegExp(key, 'g'), String(port));
	}

	return JSON.parse(replaced);
}

export async function waitMs(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
