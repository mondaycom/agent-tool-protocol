/**
 * Unit tests for OperationCheckpointTransformer
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = (_traverse as any).default || _traverse;
import _generate from '@babel/generator';
const generate = (_generate as any).default || _generate;
import {
	OperationCheckpointTransformer,
	CHECKPOINTABLE_PATTERNS,
	isCheckpointableCall,
	getOperationType,
} from '../src/transformer/checkpoint-transformer.js';
import { OperationType } from '../src/checkpoint/checkpoint-types.js';

function parseAndTransform(code: string, transformer: OperationCheckpointTransformer): string {
	const ast = parse(code, {
		sourceType: 'module',
		plugins: ['typescript'],
		allowAwaitOutsideFunction: true,
		allowReturnOutsideFunction: true,
	});

	traverse(ast, {
		AwaitExpression: (path: any) => {
			transformer.transformAwaitExpression(path);
		},
	});

	return generate(ast).code;
}

describe('OperationCheckpointTransformer', () => {
	let transformer: OperationCheckpointTransformer;

	beforeEach(() => {
		transformer = new OperationCheckpointTransformer();
	});

	describe('transformAwaitExpression', () => {
		it('should transform atp.api calls', () => {
			const code = `const user = await atp.api.github.getUser({ id: 123 });`;
			const result = parseAndTransform(code, transformer);

			expect(result).toContain('__checkpoint.buffer');
			expect(result).toContain('async () =>');
			expect(result).toContain('atp.api.github.getUser');
			expect(transformer.getTransformCount()).toBe(1);
		});

		it('should transform atp.llm calls', () => {
			const code = `const response = await atp.llm.call({ prompt: "hello" });`;
			const result = parseAndTransform(code, transformer);

			expect(result).toContain('__checkpoint.buffer');
			expect(result).toContain('atp.llm.call');
			expect(transformer.getTransformCount()).toBe(1);
		});

		it('should transform atp.embedding calls', () => {
			const code = `const embedding = await atp.embedding.embed("text");`;
			const result = parseAndTransform(code, transformer);

			expect(result).toContain('__checkpoint.buffer');
			expect(result).toContain('atp.embedding.embed');
			expect(transformer.getTransformCount()).toBe(1);
		});

		it('should transform atp.client calls', () => {
			const code = `const result = await atp.client.myTool({ data: "test" });`;
			const result = parseAndTransform(code, transformer);

			expect(result).toContain('__checkpoint.buffer');
			expect(result).toContain('atp.client.myTool');
			expect(transformer.getTransformCount()).toBe(1);
		});

		it('should NOT transform non-atp calls', () => {
			const code = `const data = await fetch("https://api.example.com");`;
			const result = parseAndTransform(code, transformer);

			expect(result).not.toContain('__checkpoint.buffer');
			expect(transformer.getTransformCount()).toBe(0);
		});

		it('should NOT transform atp.cache calls (not checkpointable)', () => {
			const code = `const cached = await atp.cache.get("key");`;
			const result = parseAndTransform(code, transformer);

			expect(result).not.toContain('__checkpoint.buffer');
			expect(transformer.getTransformCount()).toBe(0);
		});

		it('should transform multiple operations', () => {
			const code = `
				const user = await atp.api.users.get({ id: 1 });
				const repos = await atp.api.github.listRepos({ user: user.id });
				const summary = await atp.llm.call({ prompt: "summarize" });
			`;
			const result = parseAndTransform(code, transformer);

			expect(result).toContain('__checkpoint.buffer');
			expect(transformer.getTransformCount()).toBe(3);
			expect(transformer.getCheckpointIds()).toHaveLength(3);
		});

		it('should generate deterministic checkpoint IDs based on location', () => {
			const code = `const user = await atp.api.users.get({ id: 1 });`;
			parseAndTransform(code, transformer);

			const ids = transformer.getCheckpointIds();
			expect(ids).toHaveLength(1);
			// ID should contain line and column info
			expect(ids[0]).toMatch(/op_L\d+_C\d+/);
		});

		it('should include metadata in transformed code', () => {
			const code = `const user = await atp.api.github.getUser({ id: 123 });`;
			const result = parseAndTransform(code, transformer);

			// Check that metadata is present
			expect(result).toContain('type:');
			expect(result).toContain('"api"');
			expect(result).toContain('namespace:');
			expect(result).toContain('"atp"');
			expect(result).toContain('group:');
			expect(result).toContain('"api.github"');
			expect(result).toContain('method:');
			expect(result).toContain('"getUser"');
			expect(result).toContain('params:');
		});

		it('should handle nested member expressions', () => {
			const code = `const data = await atp.api.v2.users.admin.get({ id: 1 });`;
			const result = parseAndTransform(code, transformer);

			expect(result).toContain('__checkpoint.buffer');
			expect(result).toContain('"api.v2.users.admin"'); // group
			expect(result).toContain('"get"'); // method
		});

		it('should handle calls without arguments', () => {
			const code = `const list = await atp.api.users.list();`;
			const result = parseAndTransform(code, transformer);

			expect(result).toContain('__checkpoint.buffer');
			expect(result).toContain('params: {}');
		});

		it('should handle non-object arguments', () => {
			const code = `const user = await atp.api.users.get(userId);`;
			const result = parseAndTransform(code, transformer);

			expect(result).toContain('__checkpoint.buffer');
			expect(result).toContain('params:');
			expect(result).toContain('arg:'); // wrapped in arg property
		});
	});

	describe('isCheckpointable', () => {
		it('should return true for checkpointable patterns', () => {
			const ast = parse(`await atp.api.test();`, {
				sourceType: 'module',
				allowAwaitOutsideFunction: true,
			});

			let awaitNode: any = null;
			traverse(ast, {
				AwaitExpression: (path: any) => {
					awaitNode = path.node;
				},
			});

			expect(transformer.isCheckpointable(awaitNode)).toBe(true);
		});

		it('should return false for non-checkpointable patterns', () => {
			const ast = parse(`await someOtherCall();`, {
				sourceType: 'module',
				allowAwaitOutsideFunction: true,
			});

			let awaitNode: any = null;
			traverse(ast, {
				AwaitExpression: (path: any) => {
					awaitNode = path.node;
				},
			});

			expect(transformer.isCheckpointable(awaitNode)).toBe(false);
		});
	});

	describe('reset', () => {
		it('should reset transformer state', () => {
			const code = `const user = await atp.api.users.get({ id: 1 });`;
			parseAndTransform(code, transformer);

			expect(transformer.getTransformCount()).toBe(1);
			expect(transformer.getCheckpointIds()).toHaveLength(1);

			transformer.reset();

			expect(transformer.getTransformCount()).toBe(0);
			expect(transformer.getCheckpointIds()).toHaveLength(0);
		});
	});

	describe('getResult', () => {
		it('should return transformation result', () => {
			const code = `
				const a = await atp.api.test1();
				const b = await atp.api.test2();
			`;
			parseAndTransform(code, transformer);

			const result = transformer.getResult();

			expect(result.transformCount).toBe(2);
			expect(result.checkpointIds).toHaveLength(2);
		});
	});
});

describe('Utility functions', () => {
	describe('isCheckpointableCall', () => {
		it('should return true for atp.api paths', () => {
			expect(isCheckpointableCall('atp.api.users.get')).toBe(true);
			expect(isCheckpointableCall('atp.api.github.repos.list')).toBe(true);
		});

		it('should return true for atp.llm paths', () => {
			expect(isCheckpointableCall('atp.llm.call')).toBe(true);
			expect(isCheckpointableCall('atp.llm.extract')).toBe(true);
		});

		it('should return true for atp.embedding paths', () => {
			expect(isCheckpointableCall('atp.embedding.embed')).toBe(true);
		});

		it('should return true for atp.client paths', () => {
			expect(isCheckpointableCall('atp.client.myTool')).toBe(true);
		});

		it('should return false for non-checkpointable paths', () => {
			expect(isCheckpointableCall('atp.cache.get')).toBe(false);
			expect(isCheckpointableCall('atp.log.info')).toBe(false);
			expect(isCheckpointableCall('fetch')).toBe(false);
			expect(isCheckpointableCall('console.log')).toBe(false);
		});

		it('should return false for partial matches', () => {
			// Should not match just "atp.api" without a method
			expect(isCheckpointableCall('atp.api')).toBe(false);
			expect(isCheckpointableCall('atp')).toBe(false);
		});
	});

	describe('getOperationType', () => {
		it('should return correct operation type for each pattern', () => {
			expect(getOperationType('atp.api.users.get')).toBe('api');
			expect(getOperationType('atp.llm.call')).toBe('llm');
			expect(getOperationType('atp.embedding.embed')).toBe('embedding');
			expect(getOperationType('atp.client.myTool')).toBe('client_tool');
		});

		it('should return null for non-checkpointable paths', () => {
			expect(getOperationType('atp.cache.get')).toBeNull();
			expect(getOperationType('fetch')).toBeNull();
		});
	});
});

describe('CHECKPOINTABLE_PATTERNS', () => {
	it('should include expected patterns', () => {
		const namespaces = CHECKPOINTABLE_PATTERNS.map((p) => p.namespacePrefix);

		expect(namespaces).toContain('atp.api');
		expect(namespaces).toContain('atp.llm');
		expect(namespaces).toContain('atp.embedding');
		expect(namespaces).toContain('atp.client');
	});

	it('should map to correct operation types', () => {
		const apiPattern = CHECKPOINTABLE_PATTERNS.find((p) => p.namespacePrefix === 'atp.api');
		const llmPattern = CHECKPOINTABLE_PATTERNS.find((p) => p.namespacePrefix === 'atp.llm');

		expect(apiPattern?.operationType).toBe('api');
		expect(llmPattern?.operationType).toBe('llm');
	});
});

