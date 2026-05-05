/**
 * Verifies that `toolRulesProvider` runs for the in-process session path,
 * not only for HTTP requests. The provider reads rules from ctx.headers,
 * which the session populates from per-call `headers` options.
 *
 * Before this change, callers in the same process had to supply
 * `body.toolRules` (via client.execute(code, { toolRules })) — the
 * provider registered on createServer was dormant for in-process calls.
 */

import { createServer, type AgentToolProtocolServer } from '../../packages/server/src/index';
import { AgentToolProtocolClient } from '../../packages/client/src/index';

describe('toolRulesProvider runs for the in-process session path', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;

	beforeAll(async () => {
		server = createServer({
			// Provider reads an opaque header and returns per-call rules.
			toolRulesProvider: (ctx) => {
				const raw = ctx.headers['x-test-tool-rules'];
				if (!raw) return undefined;
				try {
					return JSON.parse(raw);
				} catch {
					return undefined;
				}
			},
		});

		server.use({
			name: 'math',
			type: 'custom',
			functions: [
				{
					name: 'add',
					description: 'Add two numbers',
					inputSchema: {
						type: 'object',
						properties: { a: { type: 'number' }, b: { type: 'number' } },
						required: ['a', 'b'],
					},
					handler: async (input: unknown) => {
						const { a, b } = input as { a: number; b: number };
						return { result: a + b };
					},
				},
			],
		});
		server.use({
			name: 'text',
			type: 'custom',
			functions: [
				{
					name: 'uppercase',
					description: 'Uppercase text',
					inputSchema: {
						type: 'object',
						properties: { text: { type: 'string' } },
						required: ['text'],
					},
					handler: async (input: unknown) => {
						const { text } = input as { text: string };
						return { result: text.toUpperCase() };
					},
				},
			],
		});

		await server.start();
		client = new AgentToolProtocolClient({ server: server as any });
		await client.init({ name: 'test-client', version: '1.0.0' });
		await client.connect();
	});

	describe('handleExplore', () => {
		test('provider applies rules from per-call headers', async () => {
			// With math-only rules coming from the provider's header read,
			// the text group should disappear from the explore tree.
			const rules = JSON.stringify({ allowOnlyApiGroups: ['math'] });
			const r = (await client.exploreAPI('/custom', {
				headers: { 'x-test-tool-rules': rules },
			} as any)) as { items: Array<{ name: string }> };

			const groupNames = r.items.map((i) => i.name);
			expect(groupNames).toContain('math');
			expect(groupNames).not.toContain('text');
		});

		test('body.toolRules takes precedence over provider', async () => {
			// Provider says math-only, but caller's explicit body.toolRules says
			// text-only. Explicit wins.
			const providerRules = JSON.stringify({ allowOnlyApiGroups: ['math'] });
			const r = (await client.exploreAPI('/custom', {
				headers: { 'x-test-tool-rules': providerRules },
				toolRules: { allowOnlyApiGroups: ['text'] },
			} as any)) as { items: Array<{ name: string }> };

			const groupNames = r.items.map((i) => i.name);
			expect(groupNames).toContain('text');
			expect(groupNames).not.toContain('math');
		});

		test('no provider header and no body rules: unrestricted', async () => {
			const r = (await client.exploreAPI('/custom')) as {
				items: Array<{ name: string }>;
			};
			const groupNames = r.items.map((i) => i.name);
			expect(groupNames).toEqual(expect.arrayContaining(['math', 'text']));
		});
	});
});
