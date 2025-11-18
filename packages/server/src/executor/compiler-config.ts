import type { Logger } from '@mondaydotcomorg/atp-runtime';
import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';
import {
	ATPCompiler,
	createDefaultCompiler,
	initializeRuntime as initializeCompilerRuntime,
	resumableForOf,
	resumableWhile,
	resumableForLoop,
	resumableMap,
	resumableForEach,
	resumableFilter,
	resumableReduce,
	resumableFind,
	resumableSome,
	resumableEvery,
	resumableFlatMap,
	resumablePromiseAll,
	resumablePromiseAllSettled,
	batchParallel,
	type TransformResult,
	type DetectionResult,
	type ICompiler,
	type CacheStats,
} from '@mondaydotcomorg/atp-compiler';
import { ATP_COMPILER_ENABLED, ATP_BATCH_SIZE_THRESHOLD } from './constants.js';

/**
 * Adapter for ATPCompiler to match ICompiler interface
 */
class ATPCompilerAdapter implements ICompiler {
	private compiler: ATPCompiler;

	constructor(config: { enableBatchParallel: boolean; batchSizeThreshold: number }) {
		this.compiler = new ATPCompiler(config);
	}

	detect(code: string): DetectionResult {
		return this.compiler.detect(code);
	}

	transform(code: string): TransformResult {
		return this.compiler.transform(code);
	}

	getType(): string {
		return 'ATPCompiler';
	}

	getCacheStats() {
		return null;
	}
}

/**
 * Adapter for PluggableCompiler to match ICompiler interface
 */
class PluggableCompilerAdapter implements ICompiler {
	private compiler: ReturnType<typeof createDefaultCompiler>;

	constructor(config: { enableBatchParallel: boolean; batchSizeThreshold: number }) {
		this.compiler = createDefaultCompiler(config);
	}

	async detect(code: string): Promise<DetectionResult> {
		return await this.compiler.detect(code);
	}

	async transform(code: string): Promise<TransformResult> {
		return await this.compiler.transform(code);
	}

	getType(): string {
		return 'PluggableCompiler';
	}

	getCacheStats() {
		return this.compiler.getCacheStats();
	}
}

/**
 * Compiler factory - creates the appropriate compiler based on configuration
 * This is where you can easily add new compiler types
 */
class CompilerFactory {
	static create(config: { enableBatchParallel: boolean; batchSizeThreshold: number }): ICompiler {
		const compilerType = process.env.ATP_USE_PLUGGABLE_COMPILER === 'true' 
			? 'pluggable' 
			: 'atp';

		switch (compilerType) {
			case 'pluggable':
				return new PluggableCompilerAdapter(config);
			case 'atp':
			default:
				return new ATPCompilerAdapter(config);
		}
	}

	/**
	 * Allow custom compiler injection for testing or custom implementations
	 */
	static createCustom(compiler: ICompiler): ICompiler {
		return compiler;
	}
}

/**
 * Unified compiler wrapper - works with any ICompiler implementation
 * This abstracts sync/async differences and provides a consistent API
 */
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

const transformCache = new Map<string, string>();

function getCodeHash(code: string): string {
	let hash = 0;
	for (let i = 0; i < code.length; i++) {
		const char = code.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return hash.toString(36);
}

export interface CompilerResult {
	code: string;
	useCompiler: boolean;
	metadata?: {
		patterns?: string[];
		batchable?: boolean;
		loopCount?: number;
		arrayMethodCount?: number;
		parallelCallCount?: number;
	};
}

export function getCompilerRuntime() {
	return {
		resumableForOf,
		resumableWhile,
		resumableForLoop,
		resumableMap,
		resumableForEach,
		resumableFilter,
		resumableReduce,
		resumableFind,
		resumableSome,
		resumableEvery,
		resumableFlatMap,
		resumablePromiseAll,
		resumablePromiseAllSettled,
		batchParallel,
	};
}

export async function transformCodeWithCompiler(
	code: string,
	executionId: string,
	cacheProvider: CacheProvider,
	executionLogger: Logger,
	injectedCompiler?: ICompiler
): Promise<CompilerResult> {
	if (!ATP_COMPILER_ENABLED) {
		return { code, useCompiler: false };
	}

	try {
		// Use injected compiler or create default via factory
		const compilerImpl = injectedCompiler ?? CompilerFactory.create({
			enableBatchParallel: true,
			batchSizeThreshold: ATP_BATCH_SIZE_THRESHOLD,
		});
		const compiler = new CompilerWrapper(compilerImpl);

		executionLogger.debug('Using ATP compiler', {
			type: compiler.getType(),
			batchSizeThreshold: ATP_BATCH_SIZE_THRESHOLD,
		});

		// Detect patterns (abstracted sync/async handling)
		const detection = await compiler.detect(code);

		executionLogger.info('ATP Compiler detection result', {
			needsTransform: detection.needsTransform,
			patterns: detection.patterns,
			batchable: detection.batchableParallel,
		});

		if (detection.needsTransform) {
			const codeHash = getCodeHash(code);
			const cached = transformCache.get(codeHash);
			if (cached) {
				executionLogger.debug('Using cached transformed code', { codeHash });
				initializeCompilerRuntime({
					executionId,
					cache: cacheProvider,
				});
				return {
					code: cached,
					useCompiler: true,
					metadata: {
						patterns: detection.patterns,
						batchable: detection.batchableParallel,
					},
				};
			}

			initializeCompilerRuntime({
				executionId,
				cache: cacheProvider,
			});

			// Transform code (abstracted sync/async handling)
			const transformed = await compiler.transform(code);

			transformCache.set(codeHash, transformed.code);

			// Log transformation results with optional cache stats
			const logData: Record<string, unknown> = {
				patterns: detection.patterns,
				batchable: detection.batchableParallel,
				loopCount: transformed.metadata.loopCount,
				arrayMethodCount: transformed.metadata.arrayMethodCount,
				parallelCallCount: transformed.metadata.parallelCallCount,
				batchSizeThreshold: ATP_BATCH_SIZE_THRESHOLD,
			};

			// Add cache stats if available
			const cacheStats = compiler.getCacheStats();
			if (cacheStats) {
				logData.astCacheSize = cacheStats.size;
				logData.astCacheEnabled = cacheStats.enabled;
			}

			executionLogger.info('Code transformed by ATP compiler', logData);

			return {
				code: transformed.code,
				useCompiler: true,
				metadata: {
					patterns: detection.patterns,
					batchable: detection.batchableParallel,
					loopCount: transformed.metadata.loopCount,
					arrayMethodCount: transformed.metadata.arrayMethodCount,
					parallelCallCount: transformed.metadata.parallelCallCount,
				},
			};
		}
	} catch (error) {
		executionLogger.error('ATP compiler transformation failed, falling back', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
	}

	return { code, useCompiler: false };
}
