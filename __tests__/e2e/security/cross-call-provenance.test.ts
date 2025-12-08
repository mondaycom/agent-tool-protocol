/**
 * E2E tests for cross-call provenance tracking
 * Tests that provenance is maintained when data is JSON-serialized between calls
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ProvenanceMode, createCustomPolicy } from '@mondaydotcomorg/atp-server';
import { ProvenanceSource } from '@mondaydotcomorg/atp-provenance';
import { randomUUID } from 'node:crypto';

const TEST_PORT = 3891;
const TEST_API_KEY = `test-key-${randomUUID()}`;

describe('Cross-Call Provenance Tracking', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-cross-call';
		process.env.PROVENANCE_SECRET = 'provenance-secret-32-bytes-minimum-length';

		// Create security policy that blocks tool-sourced data from going to external services
		const preventExfiltration = createCustomPolicy(
			'prevent-exfiltration',
			'Blocks tool-sourced data from external services',
			(toolName, args, getProvenance) => {
				if (toolName === 'exfiltrate' || toolName === 'sendExternal') {
					for (const [key, value] of Object.entries(args)) {
						const prov = getProvenance(value);
						if (prov?.source?.type === ProvenanceSource.TOOL) {
							return {
								action: 'block',
								reason: `Cannot exfiltrate tool-sourced data via ${toolName}`,
							};
						}
					}
				}
				return { action: 'log' };
			}
		);

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
				provenanceMode: ProvenanceMode.AST,
				securityPolicies: [preventExfiltration],
			},
		});

		// Register sensitive data source
		server.tool('getSensitive', {
			description: 'Get sensitive data',
			input: { id: 'string' },
			handler: async (params: any) => ({
				id: params.id,
				secret: 'TOP_SECRET_DATA',
				apiKey: 'sk-secret-key-12345',
			}),
		});

		// Register external exfiltration endpoint
		server.tool('exfiltrate', {
			description: 'Send data to external service',
			input: { data: 'object' },
			handler: async () => ({ sent: true }),
		});

		server.tool('sendExternal', {
			description: 'Send to external endpoint',
			input: { payload: 'string' },
			handler: async () => ({ delivered: true }),
		});

		// Register safe internal tool
		server.tool('processInternal', {
			description: 'Process data internally',
			input: { data: 'object' },
			handler: async (params: any) => ({
				processed: true,
				summary: `Processed ${Object.keys(params.data).length} fields`,
			}),
		});

		await server.listen(TEST_PORT);

		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer ${TEST_API_KEY}` },
		});
		await client.init();
		await client.connect();
	});

	afterAll(async () => {
		delete process.env.ATP_JWT_SECRET;
		delete process.env.PROVENANCE_SECRET;
		if (server) {
			await server.stop();
		}
	});

	test('should track provenance through JSON.stringify across calls', async () => {
		// Call 1: Get sensitive data
		const call1 = await client.execute(
			`const data = await api.custom.getSensitive({ id: '123' });
			 return data;`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(call1.status).toBe('completed');
		expect(call1.provenanceTokens).toBeDefined();
		expect(call1.provenanceTokens!.length).toBeGreaterThan(0);

		// Call 2: Use JSON.stringify to reconstruct data (the problematic case)
		const call2 = await client.execute(
			`const reconstructed = ${JSON.stringify(call1.result)};
			 const result = await api.custom.exfiltrate({ data: reconstructed });
			 return result;`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: call1.provenanceTokens?.map((t) => t.token),
			}
		);

		// Should be blocked because data came from tool
		expect(call2.status).toBe('failed');
		expect(call2.error?.message).toContain('exfiltrate');
	});

	test('should block property extraction across calls', async () => {
		const call1 = await client.execute(
			`const data = await api.custom.getSensitive({ id: '456' });
			 return data.secret;`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(call1.status).toBe('completed');

		const call2 = await client.execute(
			`const secret = "${call1.result}";
			 const result = await api.custom.sendExternal({ payload: secret });
			 return result;`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: call1.provenanceTokens?.map((t) => t.token),
			}
		);

		expect(call2.status).toBe('failed');
	});

	test('should block encoded data exfiltration', async () => {
		const call1 = await client.execute(
			`const data = await api.custom.getSensitive({ id: '789' });
			 return data.apiKey;`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		const call2 = await client.execute(
			`const encoded = btoa("${call1.result}");
			 const result = await api.custom.sendExternal({ payload: encoded });
			 return result;`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: call1.provenanceTokens?.map((t) => t.token),
			}
		);

		expect(call2.status).toBe('failed');
	});

	test('should allow legitimate safe operations', async () => {
		const call1 = await client.execute(
			`const result = await api.custom.processInternal({ data: { info: 'test' } });
			 return result;`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(call1.status).toBe('completed');

		const call2 = await client.execute(
			`const safeData = { message: 'Hello', status: 'OK' };
			 const result = await api.custom.sendExternal({ payload: JSON.stringify(safeData) });
			 return result;`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: call1.provenanceTokens?.map((t) => t.token),
			}
		);

		expect(call2.status).toBe('completed');
	});

	test('should track through multiple hops', async () => {
		const call1 = await client.execute(
			`const data = await api.custom.getSensitive({ id: 'hop1' });
			 return data;`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		const call2 = await client.execute(
			`const prev = ${JSON.stringify(call1.result)};
			 const processed = await api.custom.processInternal({ data: prev });
			 return { original: prev, processed };`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: call1.provenanceTokens?.map((t) => t.token),
			}
		);

		expect(call2.status).toBe('completed');

		const call3 = await client.execute(
			`const prev = ${JSON.stringify(call2.result)};
			 const result = await api.custom.exfiltrate({ data: prev.original });
			 return result;`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: [
					...(call1.provenanceTokens?.map((t) => t.token) || []),
					...(call2.provenanceTokens?.map((t) => t.token) || []),
				],
			}
		);

		expect(call3.status).toBe('failed');
	});

	test('should handle nested objects in JSON serialization', async () => {
		const call1 = await client.execute(
			`const data = await api.custom.getSensitive({ id: 'nested' });
			 return { outer: { middle: { inner: data.secret } } };`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		const call2 = await client.execute(
			`const nested = ${JSON.stringify(call1.result)};
			 const result = await api.custom.exfiltrate({ data: nested });
			 return result;`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: call1.provenanceTokens?.map((t) => t.token),
			}
		);

		expect(call2.status).toBe('failed');
	});

	test('should handle arrays with sensitive data', async () => {
		const call1 = await client.execute(
			`const data = await api.custom.getSensitive({ id: 'array' });
			 return [data.secret, 'safe', data.apiKey];`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		const call2 = await client.execute(
			`const arr = ${JSON.stringify(call1.result)};
			 const result = await api.custom.exfiltrate({ data: arr });
			 return result;`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: call1.provenanceTokens?.map((t) => t.token),
			}
		);

		expect(call2.status).toBe('failed');
	});
});
