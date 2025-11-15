/**
 * E2E Tests for Runtime API Definitions Endpoint
 * Tests the filtering behavior based on client capabilities and requested APIs
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';

describe('Runtime API Definitions', () => {
	let server: any;
	let baseUrl: string;
	const port = 3444;

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
		process.env.ATP_JWT_SECRET = 'test-secret-key-runtime-tests-' + Date.now();

		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		// Add a test tool
		server.tool('test', {
			description: 'Test tool',
			input: { value: 'string' },
			handler: async (params: any) => ({ result: params.value }),
		});

		await server.listen(port);
		await waitForServer(port);
		baseUrl = `http://localhost:${port}`;
	});

	afterAll(async () => {
		if (server?.httpServer) {
			await new Promise<void>((resolve, reject) => {
				server.httpServer.close((err: Error | undefined) => {
					if (err) reject(err);
					else resolve();
				});
			});
		}
		delete process.env.ATP_JWT_SECRET;
	});

	describe('Default behavior (client capability filtering)', () => {
		it('should return only cache API when client has no services', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			await client.init();
			const definitions = await client.getRuntimeDefinitions();

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).not.toContain('llm:');
			expect(definitions).not.toContain('approval:');
			expect(definitions).not.toContain('embedding:');
		});

		it('should return cache and llm APIs when client provides LLM', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			client.provideLLM({
				call: async () => 'mock response',
			});

			await client.init();
			const definitions = await client.getRuntimeDefinitions();

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).toContain('llm:');
			expect(definitions).not.toContain('approval:');
			expect(definitions).not.toContain('embedding:');
		});

		it('should return cache and approval APIs when client provides approval', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			client.provideApproval({
				request: async () => ({ approved: true, timestamp: Date.now() }),
			});

			await client.init();
			const definitions = await client.getRuntimeDefinitions();

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).toContain('approval:');
			expect(definitions).not.toContain('llm:');
			expect(definitions).not.toContain('embedding:');
		});

		it('should return cache and embedding APIs when client provides embedding', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			client.provideEmbedding({
				embed: async () => [0.1, 0.2, 0.3],
			});

			await client.init();
			const definitions = await client.getRuntimeDefinitions();

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).toContain('embedding:');
			expect(definitions).not.toContain('llm:');
			expect(definitions).not.toContain('approval:');
		});

		it('should return all supported APIs when client provides all services', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			client.provideLLM({
				call: async () => 'mock response',
			});

			client.provideApproval({
				request: async () => ({ approved: true, timestamp: Date.now() }),
			});

			client.provideEmbedding({
				embed: async () => [0.1, 0.2, 0.3],
			});

			await client.init();
			const definitions = await client.getRuntimeDefinitions();

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).toContain('llm:');
			expect(definitions).toContain('approval:');
			expect(definitions).toContain('embedding:');
		});
	});

	describe('Specific API filtering', () => {
		it('should return only requested APIs that client supports', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			client.provideLLM({
				call: async () => 'mock response',
			});

			await client.init();

			const definitions = await client.getRuntimeDefinitions({ apis: ['llm', 'cache'] });

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).toContain('llm:');
			expect(definitions).not.toContain('approval:');
			expect(definitions).not.toContain('embedding:');
		});

		it('should return requested APIs regardless of client support', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			await client.init();

			const definitions = await client.getRuntimeDefinitions({ apis: ['llm'] });

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('llm:');
			expect(definitions).not.toContain('cache:');
		});

		it('should return all requested APIs ignoring client capabilities', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			client.provideLLM({
				call: async () => 'mock response',
			});

			await client.init();

			const definitions = await client.getRuntimeDefinitions({
				apis: ['llm', 'embedding', 'cache'],
			});

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).toContain('llm:');
			expect(definitions).toContain('embedding:');
			expect(definitions).not.toContain('approval:');
		});

		it('should return only cache when requesting it specifically', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			client.provideLLM({
				call: async () => 'mock response',
			});

			await client.init();

			const definitions = await client.getRuntimeDefinitions({ apis: ['cache'] });

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).not.toContain('llm:');
			expect(definitions).not.toContain('approval:');
			expect(definitions).not.toContain('embedding:');
		});
	});

	describe('TypeScript type definitions', () => {
		it('should include supporting type definitions', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			client.provideLLM({
				call: async () => 'mock response',
			});

			client.provideApproval({
				request: async () => ({ approved: true, timestamp: Date.now() }),
			});

			client.provideEmbedding({
				embed: async () => [0.1, 0.2, 0.3],
			});

			await client.init();
			const definitions = await client.getRuntimeDefinitions();

			expect(definitions).toContain('export interface ApprovalResponse');
			expect(definitions).toContain('interface SearchOptions');
			expect(definitions).toContain('interface SearchResult');
			expect(definitions).toContain('interface LLMCallOptions');
			expect(definitions).toContain('interface EmbeddingRecord');
		});

		it('should include JSDoc comments for APIs', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			await client.init();
			const definitions = await client.getRuntimeDefinitions({ apis: ['cache'] });

			expect(definitions).toContain('/**');
			expect(definitions).toContain('* Cache API');
			expect(definitions).toContain('@param');
			expect(definitions).toContain('@returns');
		});

		it('should have valid TypeScript syntax', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			await client.init();
			const definitions = await client.getRuntimeDefinitions();

			expect(definitions).toContain('declare const atp: {');
			expect(definitions).toMatch(/};[\s\n]*$/);
			expect(definitions.split('declare const atp').length).toBe(2);
		});
	});

	describe('Edge cases', () => {
		it('should handle invalid API names gracefully', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			await client.init();

			const definitions = await client.getRuntimeDefinitions({
				apis: ['nonexistent', 'invalid'] as any,
			});

			expect(definitions).toContain('declare const atp');
			expect(definitions).not.toContain('nonexistent:');
			expect(definitions).not.toContain('invalid:');
		});

		it('should handle mixed valid and invalid API names', async () => {
			const client = new AgentToolProtocolClient({
				baseUrl,
				headers: { Authorization: 'Bearer test-token' },
			});

			await client.init();

			const definitions = await client.getRuntimeDefinitions({
				apis: ['cache', 'invalid', 'llm', 'nonexistent'] as any,
			});

			expect(definitions).toContain('declare const atp');
			expect(definitions).toContain('cache:');
			expect(definitions).toContain('llm:');
			expect(definitions).not.toContain('invalid:');
			expect(definitions).not.toContain('nonexistent:');
		});
	});
});
