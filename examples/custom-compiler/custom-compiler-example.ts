/**
 * Example: How to create and inject a custom compiler
 * 
 * This demonstrates the power of dependency injection -
 * you can add new compilers WITHOUT modifying core code!
 */

import type { DetectionResult, TransformResult, AsyncPattern } from '@mondaydotcomorg/atp-compiler';

// These would come from compiler-config.ts in real usage
interface ICompiler {
	detect(code: string): DetectionResult | Promise<DetectionResult>;
	transform(code: string): TransformResult | Promise<TransformResult>;
	getType(): string;
	getCacheStats?(): { size: number; enabled: boolean } | null;
}

class CompilerWrapper {
	constructor(private compiler: ICompiler) {}

	async detect(code: string): Promise<DetectionResult> {
		const result = this.compiler.detect(code);
		return result instanceof Promise ? await result : result;
	}

	async transform(code: string): Promise<TransformResult> {
		const result = this.compiler.transform(code);
		return result instanceof Promise ? await result : result;
	}

	getType(): string {
		return this.compiler.getType();
	}

	getCacheStats() {
		return this.compiler.getCacheStats?.() ?? null;
	}
}

/**
 * Step 1: Define your custom compiler implementing ICompiler interface
 * 
 * Example: A compiler that adds timeout checks to every function
 */
class TimeoutEnforcingCompiler {
	private timeout: number;

	constructor(config: { timeout?: number } = {}) {
		this.timeout = config.timeout || 5000;
	}

	detect(code: string): DetectionResult {
		// Detect if code has functions that might run long
		const hasFunctions = /function|=>|\basync\b/.test(code);
		
		return {
			needsTransform: hasFunctions,
			patterns: hasFunctions ? (['timeout-enforcement'] as unknown as AsyncPattern[]) : [],
			batchableParallel: false,
		};
	}

	transform(code: string): TransformResult {
		// Wrap all async functions with timeout enforcement
		const transformedCode = code.replace(
			/async\s+function\s+(\w+)\s*\(/g,
			`async function $1(
				__timeout = ${this.timeout}
			) {
				const __timeoutPromise = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Timeout exceeded')), __timeout)
				);
				return Promise.race([__timeoutPromise, (async () => `
		);

		return {
			code: transformedCode,
			transformed: true,
			patterns: ['timeout-enforcement'] as unknown as AsyncPattern[],
			metadata: {
				loopCount: 0,
				arrayMethodCount: 0,
				parallelCallCount: 0,
				batchableCount: 0,
			},
		};
	}

	getType(): string {
		return 'TimeoutEnforcingCompiler';
	}

	getCacheStats() {
		return null; // This compiler doesn't cache
	}
}

/**
 * Step 2: Create an adapter (if needed) to match ICompiler interface exactly
 */
class TimeoutCompilerAdapter implements ICompiler {
	private compiler: TimeoutEnforcingCompiler;

	constructor(config: { timeout?: number }) {
		this.compiler = new TimeoutEnforcingCompiler(config);
	}

	detect(code: string): DetectionResult {
		return this.compiler.detect(code);
	}

	transform(code: string): TransformResult {
		return this.compiler.transform(code);
	}

	getType(): string {
		return this.compiler.getType();
	}

	getCacheStats() {
		return this.compiler.getCacheStats();
	}
}

/**
 * Step 3: Use it! Two ways:
 */

// ===== METHOD 1: Direct Injection (for testing/custom use) =====
async function useCustomCompilerDirectly() {
	// Create your custom compiler
	const customCompiler = new TimeoutCompilerAdapter({ timeout: 3000 });
	
	// Inject it into the wrapper
	const compiler = new CompilerWrapper(customCompiler);
	
	// Use it!
	const code = `
		async function processData(data) {
			// This might take too long
			return await heavyComputation(data);
		}
	`;
	
	const detection = await compiler.detect(code);
	console.log('Detection:', detection);
	// { needsTransform: true, patterns: ['timeout-enforcement'], ... }
	
	if (detection.needsTransform) {
		const transformed = await compiler.transform(code);
		console.log('Transformed code:', transformed.code);
		// Code now has timeout enforcement!
	}
}

// ===== METHOD 2: Add to Factory (for production use) =====
/**
 * In packages/server/src/executor/compiler-config.ts:
 * 
 * class CompilerFactory {
 *     static create(config): ICompiler {
 *         const compilerType = process.env.ATP_COMPILER_TYPE || 'atp';
 * 
 *         switch (compilerType) {
 *             case 'timeout':  // ADD THIS
 *                 return new TimeoutCompilerAdapter({
 *                     timeout: parseInt(process.env.TIMEOUT_MS || '5000')
 *                 });
 *             case 'pluggable':
 *                 return new PluggableCompilerAdapter(config);
 *             case 'atp':
 *             default:
 *                 return new ATPCompilerAdapter(config);
 *         }
 *     }
 * }
 * 
 * Then use it:
 * ATP_COMPILER_TYPE=timeout TIMEOUT_MS=3000 npm start
 */

// ===== TESTING EXAMPLE =====
/**
 * Testing is now trivial - just inject a mock!
 */
class MockCompiler implements ICompiler {
	detect(): DetectionResult {
		return {
			needsTransform: true,
			patterns: ['mock'] as unknown as AsyncPattern[],
			batchableParallel: false,
		};
	}

	transform(code: string): TransformResult {
		return {
			code: `// MOCKED\n${code}`,
			transformed: true,
			patterns: ['mock'] as unknown as AsyncPattern[],
			metadata: { loopCount: 0, arrayMethodCount: 0, parallelCallCount: 0, batchableCount: 0 },
		};
	}

	getType(): string {
		return 'MockCompiler';
	}

	getCacheStats() {
		return null;
	}
}

describe('Compiler integration tests', () => {
	it('should transform code correctly', async () => {
		// Inject mock - no need to mock internal compiler logic!
		const mockCompiler = new MockCompiler();
		const compiler = new CompilerWrapper(mockCompiler);

		const result = await compiler.transform('const x = 1;');
		expect(result.code).toContain('// MOCKED');
	});
});

// ===== ANOTHER EXAMPLE: Performance Monitoring Compiler =====
class PerformanceMonitoringCompiler implements ICompiler {
	private metrics: Map<string, number> = new Map();

	detect(code: string): DetectionResult {
		const startTime = performance.now();
		const result = {
			needsTransform: true,
			patterns: ['performance-monitoring'] as unknown as AsyncPattern[],
			batchableParallel: false,
		};
		this.metrics.set('detect', performance.now() - startTime);
		return result;
	}

	transform(code: string): TransformResult {
		const startTime = performance.now();
		
		// Add performance markers
		const transformedCode = `
			performance.mark('code-start');
			${code}
			performance.mark('code-end');
			performance.measure('code-execution', 'code-start', 'code-end');
		`;

		this.metrics.set('transform', performance.now() - startTime);

		return {
			code: transformedCode,
			transformed: true,
			patterns: ['performance-monitoring'] as unknown as AsyncPattern[],
			metadata: {
				loopCount: 0,
				arrayMethodCount: 0,
				parallelCallCount: 0,
				batchableCount: 0,
			},
		};
	}

	getType(): string {
		return 'PerformanceMonitoringCompiler';
	}

	getCacheStats() {
		return {
			size: this.metrics.size,
			enabled: true,
		};
	}

	getMetrics(): Record<string, number> {
		return Object.fromEntries(this.metrics);
	}
}

/**
 * The key point: You can add ANY compiler you want!
 * 
 * - Timeout enforcement
 * - Performance monitoring
 * - Security sandboxing
 * - Cost tracking
 * - Custom optimizations
 * - A/B testing different transformations
 * - Rate limiting
 * - Memory profiling
 * 
 * Just implement ICompiler and inject it!
 * NO CHANGES to core code required! 🎉
 */

export {
	TimeoutEnforcingCompiler,
	TimeoutCompilerAdapter,
	MockCompiler,
	PerformanceMonitoringCompiler,
};

