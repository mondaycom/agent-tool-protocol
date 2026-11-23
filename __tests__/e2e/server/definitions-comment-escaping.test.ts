/**
 * E2E regression test for https://github.com/mondaycom/agent-tool-protocol/issues/72
 *
 * Descriptions containing line terminators or "*\/" must not break the TypeScript
 * definitions served by GET /api/definitions and returned by client.getTypeDefinitions().
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import ts from 'typescript';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { initializeCache, initializeLogger } from '@mondaydotcomorg/atp-runtime';

function syntaxErrors(code: string): string[] {
	const sf = ts.createSourceFile('definitions.d.ts', code, ts.ScriptTarget.Latest, true);
	const diags = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
	return diags.map((d) => {
		const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
		return `TS${d.code} line ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
	});
}

describe('GET /api/definitions - descriptions cannot break generated TypeScript', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;
	const TEST_PORT = 3472;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-e2e-tests-' + Date.now();
		initializeLogger({ level: 'error', pretty: false });
		initializeCache({ type: 'memory', maxKeys: 1000, defaultTTL: 600 });

		server = new AgentToolProtocolServer({
			execution: { timeout: 30000, memory: 128 * 1024 * 1024, llmCalls: 5 },
		});

		server.use({
			name: 'files',
			type: 'custom',
			functions: [
				{
					name: 'search',
					description: 'Search files by glob, e.g. src/**/*.ts',
					inputSchema: {
						type: 'object',
						required: ['pattern'],
						properties: {
							pattern: { type: 'string', description: 'Glob pattern.\nExample: src/**/*.ts' },
							flags: { type: 'string', description: 'Windows line\r\nand old Mac line\rend' },
							note: { type: 'string', description: 'Unicode\u2028line\u2029separators */' },
						},
					},
					outputSchema: {
						type: 'object',
						properties: { path: { type: 'string', description: 'Matched path like lib/**/*.js' } },
					},
					handler: async () => ({ path: '' }),
				},
			],
		});

		await server.listen(TEST_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));

		client = new AgentToolProtocolClient({ baseUrl: `http://localhost:${TEST_PORT}` });
		await client.init();
		await client.connect();
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
	});

	test('HTTP response contains syntactically valid TypeScript', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/definitions`);
		expect(response.status).toBe(200);
		const data: any = await response.json();

		expect(syntaxErrors(data.typescript)).toEqual([]);
		// Descriptions are preserved in escaped form rather than dropped
		expect(data.typescript).toContain('// Glob pattern. Example: src/**\\/*.ts');
		expect(data.typescript).toContain('* Search files by glob, e.g. src/**\\/*.ts');
	});

	test('client.getTypeDefinitions() returns syntactically valid TypeScript', () => {
		const definitions = client.getTypeDefinitions();
		expect(definitions).toContain('search(params: search_Input)');
		expect(syntaxErrors(definitions)).toEqual([]);
	});
});
