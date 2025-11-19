/**
 * Example: Dependency Injection of Custom Compiler at Server Level
 *
 * This demonstrates how to inject a custom compiler when creating the ATP server.
 * The compiler is injected at the top level (createServer) and flows down through the system.
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import type { ICompiler } from '@mondaydotcomorg/atp-compiler';
import { createDefaultCompiler, ATPCompiler } from '@mondaydotcomorg/atp-compiler';
import type { DetectionResult, TransformResult } from '@mondaydotcomorg/atp-compiler';

// ===================================================================
// Example 1: Use Default Compiler (No Injection)
// ===================================================================

const serverWithDefaultCompiler = createServer({
	execution: {
		timeout: 30000,
		memory: 128 * 1024 * 1024,
		llmCalls: 10,
	},
	// No compiler specified - will use ATPCompiler via CompilerFactory
});

// ===================================================================
// Example 2: Inject PluggableCompiler with Default Plugins
// ===================================================================

const serverWithPluggableCompiler = createServer({
	execution: {
		timeout: 30000,
		memory: 128 * 1024 * 1024,
		llmCalls: 10,
	},
	compiler: createDefaultCompiler({
		enableBatchParallel: true,
		batchSizeThreshold: 1000,
	}),
	// This gives you AST caching + plugin extensibility
});

// ===================================================================
// Example 3: Inject Standard ATPCompiler
// ===================================================================

const serverWithATPCompiler = createServer({
	execution: {
		timeout: 30000,
		memory: 128 * 1024 * 1024,
		llmCalls: 10,
	},
	compiler: new ATPCompiler({
		enableBatchParallel: true,
		batchSizeThreshold: 1000,
	}),
	// Explicitly use ATPCompiler
});

// ===================================================================
// Example 4: Inject Custom Compiler
// ===================================================================

class CustomTimeoutCompiler implements ICompiler {
	private timeoutMs: number;

	constructor(timeoutMs: number = 5000) {
		this.timeoutMs = timeoutMs;
	}

	detect(code: string): DetectionResult {
		// Detect if code might need timeout enforcement
		const hasLongRunning = /while|for|recursion/.test(code);
		return {
			needsTransform: hasLongRunning,
			patterns: hasLongRunning ? (['timeout-check'] as any[]) : [],
			batchableParallel: false,
		};
	}

	transform(code: string): TransformResult {
		// Add timeout checks to the code
		const transformedCode = `
			const __startTime = Date.now();
			const __checkTimeout = () => {
				if (Date.now() - __startTime > ${this.timeoutMs}) {
					throw new Error('Operation timed out after ${this.timeoutMs}ms');
				}
			};
			
			// Original code with timeout checks injected
			${code}
		`;

		return {
			code: transformedCode,
			transformed: true,
			patterns: ['timeout-check'] as any[],
			metadata: {
				loopCount: 0,
				arrayMethodCount: 0,
				parallelCallCount: 0,
				batchableCount: 0,
			},
		};
	}

	getType(): string {
		return 'CustomTimeoutCompiler';
	}

	getCacheStats() {
		return null;
	}
}

const serverWithCustomCompiler = createServer({
	execution: {
		timeout: 30000,
		memory: 128 * 1024 * 1024,
		llmCalls: 10,
	},
	compiler: new CustomTimeoutCompiler(5000),
	// Inject your custom compiler!
});

// ===================================================================
// Example 5: Use Environment Variable to Switch Compilers
// ===================================================================

function getCompilerFromEnv(): ICompiler | undefined {
	const compilerType = process.env.ATP_COMPILER_TYPE;

	switch (compilerType) {
		case 'pluggable':
			return createDefaultCompiler({
				enableBatchParallel: true,
				batchSizeThreshold: 1000,
			});
		case 'custom-timeout':
			return new CustomTimeoutCompiler(5000);
		case 'atp':
			return new ATPCompiler({
				enableBatchParallel: true,
				batchSizeThreshold: 1000,
			});
		default:
			// No compiler specified - use default
			return undefined;
	}
}

const serverWithEnvBasedCompiler = createServer({
	execution: {
		timeout: 30000,
		memory: 128 * 1024 * 1024,
		llmCalls: 10,
	},
	compiler: getCompilerFromEnv(),
	// Compiler selection based on environment variable
});

// Start the server
await serverWithEnvBasedCompiler.listen(3000);

// ===================================================================
// Example 6: Testing with Mock Compiler
// ===================================================================

class MockCompiler implements ICompiler {
	detect(): DetectionResult {
		return {
			needsTransform: false,
			patterns: [],
			batchableParallel: false,
		};
	}

	transform(code: string): TransformResult {
		return {
			code,
			transformed: false,
			patterns: [],
			metadata: {
				loopCount: 0,
				arrayMethodCount: 0,
				parallelCallCount: 0,
				batchableCount: 0,
			},
		};
	}

	getType(): string {
		return 'MockCompiler';
	}

	getCacheStats() {
		return null;
	}
}

// In tests
const testServer = createServer({
	execution: {
		timeout: 1000,
		memory: 64 * 1024 * 1024,
		llmCalls: 5,
	},
	compiler: new MockCompiler(),
	// Mock compiler for fast, predictable tests
});

// ===================================================================
// Key Benefits of This Approach
// ===================================================================

/**
 * 1. **Top-Level Injection**: Compiler is injected at server creation,
 *    not deep in the execution flow.
 *
 * 2. **Testability**: Easy to inject mock compilers for testing.
 *
 * 3. **Flexibility**: Switch compilers at runtime via environment variables.
 *
 * 4. **No Code Changes**: Existing code continues to work (uses default).
 *
 * 5. **Explicit Configuration**: Clear what compiler is being used.
 *
 * 6. **Follows SOLID**: Dependency Inversion Principle properly applied.
 */

export {
	serverWithDefaultCompiler,
	serverWithPluggableCompiler,
	serverWithATPCompiler,
	serverWithCustomCompiler,
	serverWithEnvBasedCompiler,
	testServer,
	CustomTimeoutCompiler,
	MockCompiler,
};
