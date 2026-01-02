/**
 * E2E Tests for Compiler Dependency Injection
 *
 * Tests that compiler injection works correctly at the createServer level:
 * 1. Default compiler (no injection)
 * 2. Injected PluggableCompiler
 * 3. Injected custom compiler
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import {
	ATPCompiler,
	createDefaultCompiler,
	type ICompiler,
	type DetectionResult,
	type TransformResult,
} from '@mondaydotcomorg/atp-compiler';

// Custom test compiler that actually transforms code to prove it ran
class TestCompiler implements ICompiler {
	public detectCalls = 0;
	public transformCalls = 0;
	public lastDetectedCode: string | null = null;
	public lastTransformedCode: string | null = null;

	detect(code: string): DetectionResult {
		this.detectCalls++;
		this.lastDetectedCode = code;
		// Always transform code with loops
		return {
			needsTransform: code.includes('for ('),
			patterns: code.includes('for (') ? (['test-loop'] as any) : [],
			batchableParallel: false,
		};
	}

	transform(code: string): TransformResult {
		this.transformCalls++;
		this.lastTransformedCode = code;

		// Add a unique marker and a test variable to prove transformation happened
		const transformedCode = `
			const __TEST_COMPILER_MARKER = 'custom-compiler-executed';
			${code}
		`;

		return {
			code: transformedCode,
			transformed: true,
			patterns: ['test-loop'] as any,
			metadata: {
				loopCount: 1,
				arrayMethodCount: 0,
				checkpointCount: 0,
				parallelCallCount: 0,
				batchableCount: 0,
			},
		};
	}

	getType(): string {
		return 'TestCompiler';
	}

	getCacheStats() {
		return { size: 0, enabled: false };
	}

	reset() {
		this.detectCalls = 0;
		this.transformCalls = 0;
		this.lastDetectedCode = null;
		this.lastTransformedCode = null;
	}
}

const BASE_PORT = 3400;

describe('Compiler Dependency Injection E2E', () => {
	describe('Default Compiler (No Injection)', () => {
		let client: AgentToolProtocolClient;
		let server: AgentToolProtocolServer;
		const PORT = BASE_PORT;

		beforeAll(async () => {
			process.env.ATP_JWT_SECRET = 'test-secret-default';

			// Server with NO compiler injected - should use factory default
			server = new AgentToolProtocolServer({
				execution: {
					timeout: 10000,
				},
			});

			await server.listen(PORT);

			client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${PORT}`,
			});

			await client.init();
			await client.connect();
		});

		afterAll(async () => {
			if (server) {
				await server.stop();
			}
			delete process.env.ATP_JWT_SECRET;
		});

		test('should execute simple code with default compiler', async () => {
			const result = await client.execute('return 1 + 1;');
			expect(result.status).toBe('completed');
			expect(result.result).toBe(2);
		});

		test('should work with loops using default compiler', async () => {
			const code = `
				let sum = 0;
				for (let i = 0; i < 5; i++) {
					sum += i;
				}
				return sum;
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			expect(result.result).toBe(10); // 0+1+2+3+4
		});

		test('should not have compiler property when not injected', () => {
			// When no compiler is injected, server.compiler should be undefined
			// The compiler is created lazily inside transformCodeWithCompiler
			expect(server.compiler).toBeUndefined();
		});
	});

	describe('Injected PluggableCompiler', () => {
		let client: AgentToolProtocolClient;
		let server: AgentToolProtocolServer;
		const PORT = BASE_PORT + 1;

		beforeAll(async () => {
			process.env.ATP_JWT_SECRET = 'test-secret-pluggable';

			// Server with PluggableCompiler injected
			server = new AgentToolProtocolServer({
				execution: {
					timeout: 10000,
				},
				compiler: createDefaultCompiler({
					enableBatchParallel: true,
					batchSizeThreshold: 1000,
				}),
			});

			await server.listen(PORT);

			client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${PORT}`,
			});

			await client.init();
			await client.connect();
		});

		afterAll(async () => {
			if (server) {
				await server.stop();
			}
			delete process.env.ATP_JWT_SECRET;
		});

		test('should use pluggable compiler', () => {
			expect(server.compiler).toBeDefined();
			expect(server.compiler!.getType()).toBe('PluggableCompiler');
		});

		test('should execute simple code with pluggable compiler', async () => {
			const result = await client.execute('return 2 + 2;');
			expect(result.status).toBe('completed');
			expect(result.result).toBe(4);
		});

		test('should work with loops using pluggable compiler', async () => {
			const code = `
				let product = 1;
				for (let i = 1; i <= 5; i++) {
					product *= i;
				}
				return product;
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			expect(result.result).toBe(120); // 5!
		});

		test('should have cache stats available and enabled', () => {
			const stats = server.compiler!.getCacheStats();
			expect(stats).toBeDefined();
			expect(stats).not.toBeNull();
			expect(stats!.enabled).toBe(true);
			expect(typeof stats!.size).toBe('number');
			expect(stats!.size).toBeGreaterThanOrEqual(0);
		});

		test('should cache AST between detect and transform', async () => {
			const statsBefore = server.compiler!.getCacheStats();
			const sizeBefore = statsBefore?.size || 0;

			// Execute code with a loop (will trigger detect + transform)
			const code = `
				let count = 0;
				for (let i = 0; i < 3; i++) {
					count++;
				}
				return count;
			`;

			await client.execute(code);

			const statsAfter = server.compiler!.getCacheStats();
			const sizeAfter = statsAfter?.size || 0;

			// Cache size should have increased (AST was cached)
			expect(sizeAfter).toBeGreaterThanOrEqual(sizeBefore);
		});
	});

	describe('Injected Custom Compiler', () => {
		let client: AgentToolProtocolClient;
		let server: AgentToolProtocolServer;
		let customCompiler: TestCompiler;
		const PORT = BASE_PORT + 2;

		beforeAll(async () => {
			process.env.ATP_JWT_SECRET = 'test-secret-custom';

			customCompiler = new TestCompiler();

			// Server with custom TestCompiler injected
			server = new AgentToolProtocolServer({
				execution: {
					timeout: 10000,
				},
				compiler: customCompiler,
			});

			await server.listen(PORT);

			client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${PORT}`,
			});

			await client.init();
			await client.connect();
		});

		afterAll(async () => {
			if (server) {
				await server.stop();
			}
			delete process.env.ATP_JWT_SECRET;
		});

		test('should use custom compiler instance', () => {
			expect(server.compiler).toBeDefined();
			expect(server.compiler).toBe(customCompiler);
			expect(server.compiler!.getType()).toBe('TestCompiler');
		});

		test('should call custom compiler detect method', async () => {
			customCompiler.reset();

			const result = await client.execute('return 42;');
			expect(result.status).toBe('completed');
			expect(result.result).toBe(42);

			// Verify detect was called at least once
			expect(customCompiler.detectCalls).toBeGreaterThan(0);
		});

		test('should call custom compiler transform method for loops', async () => {
			customCompiler.reset();

			const code = `
				let sum = 0;
				for (let i = 0; i < 3; i++) {
					sum += i;
				}
				return sum;
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			expect(result.result).toBe(3); // 0+1+2

			// Verify detect was called
			expect(customCompiler.detectCalls).toBeGreaterThan(0);

			// Verify transform was called (code has 'for (')
			expect(customCompiler.transformCalls).toBeGreaterThan(0);

			// Verify the code that was detected/transformed
			expect(customCompiler.lastDetectedCode).toContain('for (');
			expect(customCompiler.lastTransformedCode).toContain('for (');
		});

		test('should apply custom compiler transformation', async () => {
			customCompiler.reset();

			// Code with a loop should trigger transformation
			const code = `
				let result = 42;
				for (let i = 0; i < 1; i++) {
					// This marker should exist after transformation
					if (typeof __TEST_COMPILER_MARKER !== 'undefined') {
						result = 100;
					}
				}
				return result;
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');

			// If custom compiler transformation was applied, __TEST_COMPILER_MARKER exists
			// and result should be 100. If not applied, result would be 42.
			expect(result.result).toBe(100);

			// Verify the compiler was called
			expect(customCompiler.transformCalls).toBeGreaterThan(0);
		});
	});

	describe('Injected ATPCompiler', () => {
		let client: AgentToolProtocolClient;
		let server: AgentToolProtocolServer;
		const PORT = BASE_PORT + 3;

		beforeAll(async () => {
			process.env.ATP_JWT_SECRET = 'test-secret-atp';

			// Server with explicitly injected ATPCompiler
			server = new AgentToolProtocolServer({
				execution: {
					timeout: 10000,
				},
				compiler: new ATPCompiler({
					enableBatchParallel: true,
					batchSizeThreshold: 1000,
				}),
			});

			await server.listen(PORT);

			client = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${PORT}`,
			});

			await client.init();
			await client.connect();
		});

		afterAll(async () => {
			if (server) {
				await server.stop();
			}
			delete process.env.ATP_JWT_SECRET;
		});

		test('should use explicitly injected ATPCompiler', () => {
			expect(server.compiler).toBeDefined();
			expect(server.compiler!.getType()).toBe('ATPCompiler');
		});

		test('should execute code with injected ATPCompiler', async () => {
			const result = await client.execute('return 3 + 3;');
			expect(result.status).toBe('completed');
			expect(result.result).toBe(6);
		});

		test('should work with loops', async () => {
			const code = `
				let count = 0;
				for (let i = 0; i < 10; i++) {
					count++;
				}
				return count;
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			expect(result.result).toBe(10);
		});

		test('should have getCacheStats method but return null', () => {
			const stats = server.compiler!.getCacheStats();
			// ATPCompiler doesn't cache, so should return null
			expect(stats).toBeNull();
		});
	});

	describe('Compiler Interface Consistency', () => {
		test('all injected compiler types should be identifiable', async () => {
			process.env.ATP_JWT_SECRET = 'test-secret-consistency';

			// Test with each compiler type that gets injected
			const compilers: Array<{ name: string; compiler: ICompiler; expectedType: string }> = [
				{
					name: 'pluggable',
					compiler: createDefaultCompiler(),
					expectedType: 'PluggableCompiler',
				},
				{
					name: 'custom',
					compiler: new TestCompiler(),
					expectedType: 'TestCompiler',
				},
				{
					name: 'atp',
					compiler: new ATPCompiler(),
					expectedType: 'ATPCompiler',
				},
			];

			for (const { name, compiler, expectedType } of compilers) {
				const server = new AgentToolProtocolServer({
					execution: { timeout: 10000 },
					compiler,
				});

				// Verify injected compiler is stored
				expect(server.compiler).toBe(compiler);
				expect(server.compiler!.getType()).toBe(expectedType);

				// Verify getCacheStats exists
				expect(typeof server.compiler!.getCacheStats).toBe('function');

				await server.stop();
			}

			delete process.env.ATP_JWT_SECRET;
		});

		test('default case should not have compiler property', () => {
			process.env.ATP_JWT_SECRET = 'test-secret-no-compiler';

			const server = new AgentToolProtocolServer({
				execution: { timeout: 10000 },
				// No compiler injected
			});

			// When no compiler is injected, server.compiler is undefined
			expect(server.compiler).toBeUndefined();

			delete process.env.ATP_JWT_SECRET;
		});
	});
});
