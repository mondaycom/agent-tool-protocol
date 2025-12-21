/**
 * Tool Rules Filtering Test
 *
 * This example validates that toolRules.allowOnlyApiGroups filtering works correctly
 * for all three ATP tools:
 * 1. execute_code - Code execution should only access allowed API groups
 * 2. explore_api - API exploration should only show allowed API groups
 * 3. search_api - API search should only return results from allowed API groups
 *
 * Run with: npx tsx examples/tool-rules-test/index.ts
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

interface TestResult {
	name: string;
	passed: boolean;
	details?: string;
}

const results: TestResult[] = [];

function log(message: string) {
	console.log(message);
}

function test(name: string, passed: boolean, details?: string) {
	results.push({ name, passed, details });
	const status = passed ? '✅ PASS' : '❌ FAIL';
	console.log(`${status}: ${name}`);
	if (details) {
		console.log(`   ${details}`);
	}
}

async function main() {
	console.log('=== Tool Rules Filtering Test ===\n');
	console.log('Testing toolRules.allowOnlyApiGroups filtering for:');
	console.log('- execute_code');
	console.log('- explore_api');
	console.log('- search_api\n');

	// Create server with two API groups
	const server = createServer();

	// Register "math" API group
	server.use({
		name: 'math',
		type: 'custom',
		functions: [
			{
				name: 'add',
				description: 'Add two numbers together',
				inputSchema: {
					type: 'object',
					properties: {
						a: { type: 'number' },
						b: { type: 'number' },
					},
					required: ['a', 'b'],
				},
				handler: async (input: unknown) => {
					const { a, b } = input as { a: number; b: number };
					return { result: a + b };
				},
			},
			{
				name: 'multiply',
				description: 'Multiply two numbers together',
				inputSchema: {
					type: 'object',
					properties: {
						a: { type: 'number' },
						b: { type: 'number' },
					},
					required: ['a', 'b'],
				},
				handler: async (input: unknown) => {
					const { a, b } = input as { a: number; b: number };
					return { result: a * b };
				},
			},
		],
	});

	// Register "text" API group
	server.use({
		name: 'text',
		type: 'custom',
		functions: [
			{
				name: 'uppercase',
				description: 'Convert text to uppercase',
				inputSchema: {
					type: 'object',
					properties: {
						text: { type: 'string' },
					},
					required: ['text'],
				},
				handler: async (input: unknown) => {
					const { text } = input as { text: string };
					return { result: text.toUpperCase() };
				},
			},
			{
				name: 'lowercase',
				description: 'Convert text to lowercase',
				inputSchema: {
					type: 'object',
					properties: {
						text: { type: 'string' },
					},
					required: ['text'],
				},
				handler: async (input: unknown) => {
					const { text } = input as { text: string };
					return { result: text.toLowerCase() };
				},
			},
		],
	});

	// Create in-process client
	const client = new AgentToolProtocolClient({ server: server as any });
	await client.init({ name: 'tool-rules-test', version: '1.0.0' });
	await client.connect();

	log('Server started with two API groups: math, text\n');

	// =====================================================
	// Test 1: execute_code without toolRules (baseline)
	// =====================================================
	console.log('--- Test Group 1: execute_code ---\n');

	const exec1 = await client.execute('return await api.math.add({ a: 2, b: 3 });');
	test(
		'execute_code: math.add works without toolRules',
		exec1.status === 'completed' && (exec1.result as any)?.result === 5,
		`status=${exec1.status}, result=${JSON.stringify(exec1.result)}`
	);

	const exec2 = await client.execute('return await api.text.uppercase({ text: "hello" });');
	test(
		'execute_code: text.uppercase works without toolRules',
		exec2.status === 'completed' && (exec2.result as any)?.result === 'HELLO',
		`status=${exec2.status}, result=${JSON.stringify(exec2.result)}`
	);

	// =====================================================
	// Test 2: execute_code WITH toolRules filtering
	// =====================================================
	const exec3 = await client.execute('return await api.math.add({ a: 10, b: 20 });', {
		toolRules: { allowOnlyApiGroups: ['math'] },
	});
	test(
		'execute_code: math.add works when toolRules allows math',
		exec3.status === 'completed' && (exec3.result as any)?.result === 30,
		`status=${exec3.status}, result=${JSON.stringify(exec3.result)}`
	);

	const exec4 = await client.execute('return await api.text.uppercase({ text: "blocked" });', {
		toolRules: { allowOnlyApiGroups: ['math'] },
	});
	test(
		'execute_code: text.uppercase BLOCKED when toolRules only allows math',
		exec4.status === 'failed',
		`status=${exec4.status}, error=${JSON.stringify(exec4.error)}`
	);

	const exec5 = await client.execute('return await api.text.lowercase({ text: "ALLOWED" });', {
		toolRules: { allowOnlyApiGroups: ['text'] },
	});
	test(
		'execute_code: text.lowercase works when toolRules allows text',
		exec5.status === 'completed' && (exec5.result as any)?.result === 'allowed',
		`status=${exec5.status}, result=${JSON.stringify(exec5.result)}`
	);

	const exec6 = await client.execute('return await api.math.multiply({ a: 5, b: 5 });', {
		toolRules: { allowOnlyApiGroups: ['text'] },
	});
	test(
		'execute_code: math.multiply BLOCKED when toolRules only allows text',
		exec6.status === 'failed',
		`status=${exec6.status}, error=${JSON.stringify(exec6.error)}`
	);

	// =====================================================
	// Test 3: explore_api without toolRules (baseline)
	// =====================================================
	console.log('\n--- Test Group 2: explore_api ---\n');

	const explore1 = await client.exploreAPI('/custom');
	const explore1Items = (explore1 as any).items?.map((i: any) => i.name) || [];
	test(
		'explore_api: shows both math and text without toolRules',
		explore1Items.includes('math') && explore1Items.includes('text'),
		`items=${JSON.stringify(explore1Items)}`
	);

	// =====================================================
	// Test 4: explore_api WITH toolRules filtering
	// =====================================================
	const explore2 = await client.exploreAPI('/custom', {
		toolRules: { allowOnlyApiGroups: ['math'] },
	});
	const explore2Items = (explore2 as any).items?.map((i: any) => i.name) || [];
	test(
		'explore_api: shows ONLY math when toolRules allows math',
		explore2Items.includes('math') && !explore2Items.includes('text'),
		`items=${JSON.stringify(explore2Items)}`
	);

	const explore3 = await client.exploreAPI('/custom', {
		toolRules: { allowOnlyApiGroups: ['text'] },
	});
	const explore3Items = (explore3 as any).items?.map((i: any) => i.name) || [];
	test(
		'explore_api: shows ONLY text when toolRules allows text',
		explore3Items.includes('text') && !explore3Items.includes('math'),
		`items=${JSON.stringify(explore3Items)}`
	);

	// =====================================================
	// Test 5: search_api without toolRules (baseline)
	// =====================================================
	console.log('\n--- Test Group 3: search_api ---\n');

	const search1 = await client.searchAPI('add');
	test(
		'search_api: finds math.add without toolRules',
		search1.length > 0 && search1.some((r) => r.functionName === 'add'),
		`results=${search1.length}, found=${search1.map((r) => r.functionName).join(',')}`
	);

	const search2 = await client.searchAPI('uppercase');
	test(
		'search_api: finds text.uppercase without toolRules',
		search2.length > 0 && search2.some((r) => r.functionName === 'uppercase'),
		`results=${search2.length}, found=${search2.map((r) => r.functionName).join(',')}`
	);

	// =====================================================
	// Test 6: search_api WITH toolRules filtering
	// =====================================================
	const search3 = await client.searchAPI('add', {
		query: 'add',
		toolRules: { allowOnlyApiGroups: ['math'] },
	});
	test(
		'search_api: finds math.add when toolRules allows math',
		search3.length > 0 && search3.some((r) => r.functionName === 'add'),
		`results=${search3.length}, found=${search3.map((r) => r.functionName).join(',')}`
	);

	const search4 = await client.searchAPI('uppercase', {
		query: 'uppercase',
		toolRules: { allowOnlyApiGroups: ['math'] },
	});
	test(
		'search_api: does NOT find text.uppercase when toolRules only allows math',
		search4.length === 0,
		`results=${search4.length}, found=${search4.map((r) => r.functionName).join(',')}`
	);

	const search5 = await client.searchAPI('lowercase', {
		query: 'lowercase',
		toolRules: { allowOnlyApiGroups: ['text'] },
	});
	test(
		'search_api: finds text.lowercase when toolRules allows text',
		search5.length > 0 && search5.some((r) => r.functionName === 'lowercase'),
		`results=${search5.length}, found=${search5.map((r) => r.functionName).join(',')}`
	);

	const search6 = await client.searchAPI('multiply', {
		query: 'multiply',
		toolRules: { allowOnlyApiGroups: ['text'] },
	});
	test(
		'search_api: does NOT find math.multiply when toolRules only allows text',
		search6.length === 0,
		`results=${search6.length}, found=${search6.map((r) => r.functionName).join(',')}`
	);

	// =====================================================
	// Summary
	// =====================================================
	console.log('\n=== Test Summary ===\n');

	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;
	const total = results.length;

	console.log(`Total: ${total} tests`);
	console.log(`Passed: ${passed}`);
	console.log(`Failed: ${failed}`);

	if (failed > 0) {
		console.log('\nFailed tests:');
		results
			.filter((r) => !r.passed)
			.forEach((r) => {
				console.log(`  ❌ ${r.name}`);
				if (r.details) console.log(`     ${r.details}`);
			});
		process.exit(1);
	} else {
		console.log('\n✅ All tests passed! Tool rules filtering is working correctly.');
		process.exit(0);
	}
}

main().catch((error) => {
	console.error('Test failed with error:', error);
	process.exit(1);
});

