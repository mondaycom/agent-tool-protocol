/**
 * In-process client tests
 * Tests client using direct server instance without HTTP/port binding
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';

describe('In-Process Client', () => {
	let server: ReturnType<typeof createServer>;
	let client: AgentToolProtocolClient;

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-e2e-tests-' + Date.now();
	});

	afterEach(async () => {
		server = null as unknown as ReturnType<typeof createServer>;
		client = null as unknown as AgentToolProtocolClient;
	});

	afterAll(() => {
		delete process.env.ATP_JWT_SECRET;
	});

	test('should create client with server instance (no port)', () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		client = new AgentToolProtocolClient({ server });
		expect(client).toBeDefined();
	});

	test('should throw if neither baseUrl nor server provided', () => {
		expect(() => {
			new AgentToolProtocolClient({} as any);
		}).toThrow('Either baseUrl or server must be provided');
	});

	test('should throw if both baseUrl and server provided', () => {
		server = createServer();
		expect(() => {
			new AgentToolProtocolClient({
				baseUrl: 'http://localhost:3000',
				server,
			});
		}).toThrow('Cannot provide both baseUrl and server');
	});

	test('should initialize client in-process', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		client = new AgentToolProtocolClient({ server });

		const result = await client.init({ name: 'test-client', version: '1.0.0' });

		expect(result.clientId).toBeDefined();
		expect(result.token).toBeDefined();
		expect(result.clientId).toMatch(/^cli_[a-f0-9]{32}$/);
	});

	test('should get server info in-process', async () => {
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 128 * 1024 * 1024,
				llmCalls: 5,
			},
			providers: {
				cache: new MemoryCache(),
			},
		});

		client = new AgentToolProtocolClient({ server });
		await client.init();

		const info = await client.getServerInfo();
		expect(info.version).toBeDefined();
		expect(info.capabilities).toBeDefined();
	});

	test('should connect and get definitions in-process', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		server.tool('testTool', {
			description: 'A test tool',
			input: { name: 'string' },
			handler: async (input: any) => ({ message: `Hello ${input.name}` }),
		});

		client = new AgentToolProtocolClient({ server });
		await client.init();

		const result = await client.connect();
		expect(result.serverVersion).toBeDefined();
		expect(result.apiGroups).toBeDefined();
		expect(result.apiGroups).toContain('custom');

		const types = client.getTypeDefinitions();
		expect(types).toContain('testTool');
	});

	test('should execute code in-process', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		server.tool('greet', {
			description: 'Greet a person',
			input: { name: 'string' },
			handler: async (input: any) => ({ greeting: `Hello, ${input.name}!` }),
		});

		client = new AgentToolProtocolClient({ server });
		await client.init();

		const result = await client.execute(`
			const result = await api.custom.greet({ name: 'World' });
			return result;
		`);

		expect(result.status).toBe('completed');
		expect(result.result).toEqual({ greeting: 'Hello, World!' });
	});

	test('should search APIs in-process', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		server.tool('searchableFunction', {
			description: 'A function that can be found by search',
			input: { query: 'string' },
			handler: async () => ({}),
		});

		client = new AgentToolProtocolClient({ server });
		await client.init();

		const results = await client.searchAPI('searchable');
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.functionName.includes('searchableFunction'))).toBe(true);
	});

	test('should explore API in-process', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		server.tool('explorerTest', {
			description: 'Test tool for explorer',
			input: {},
			handler: async () => ({}),
		});

		client = new AgentToolProtocolClient({ server });
		await client.init();

		const result = await client.exploreAPI('/');
		expect(result).toBeDefined();
		expect(result.type).toBe('directory');
		if (result.type === 'directory') {
			expect(result.items).toBeDefined();
		}
	});

	test('should work with multiple tools in-process', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		server.tool('add', {
			description: 'Add two numbers',
			input: { a: 'number', b: 'number' },
			handler: async (input: any) => ({ result: input.a + input.b }),
		});

		server.tool('multiply', {
			description: 'Multiply two numbers',
			input: { a: 'number', b: 'number' },
			handler: async (input: any) => ({ result: input.a * input.b }),
		});

		client = new AgentToolProtocolClient({ server });
		await client.init();

		const result = await client.execute(`
			const sum = await api.custom.add({ a: 5, b: 3 });
			const product = await api.custom.multiply({ a: sum.result, b: 2 });
			return product;
		`);

		expect(result.status).toBe('completed');
		expect(result.result).toEqual({ result: 16 });
	});

	test('should get runtime definitions in-process', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		client = new AgentToolProtocolClient({ server });
		await client.init();

		const definitions = await client.getRuntimeDefinitions();
		expect(definitions).toBeDefined();
		expect(typeof definitions).toBe('string');
		expect(definitions).toContain('atp');
	});

	test('multiple in-process clients should not conflict', async () => {
		const server1 = createServer({
			providers: { cache: new MemoryCache() },
		});
		server1.tool('tool1', {
			description: 'Tool from server 1',
			input: {},
			handler: async () => ({ source: 'server1' }),
		});

		const server2 = createServer({
			providers: { cache: new MemoryCache() },
		});
		server2.tool('tool2', {
			description: 'Tool from server 2',
			input: {},
			handler: async () => ({ source: 'server2' }),
		});

		const client1 = new AgentToolProtocolClient({ server: server1 });
		const client2 = new AgentToolProtocolClient({ server: server2 });

		await Promise.all([client1.init(), client2.init()]);

		const [result1, result2] = await Promise.all([
			client1.execute('return await api.custom.tool1({})'),
			client2.execute('return await api.custom.tool2({})'),
		]);

		expect(result1.result).toEqual({ source: 'server1' });
		expect(result2.result).toEqual({ source: 'server2' });
	});
});

