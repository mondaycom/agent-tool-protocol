import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = (_traverse as any).default || _traverse;
import _generate from '@babel/generator';
const generate = (_generate as any).default || _generate;
import * as t from '@babel/types';
import { AsyncIterationDetector } from './detector.js';
import { LoopTransformer } from './loop-transformer.js';
import { ArrayTransformer } from './array-transformer.js';
import { PromiseTransformer } from './promise-transformer.js';
import type { TransformResult, CompilerConfig, TransformMetadata } from '../types.js';
import { DEFAULT_COMPILER_CONFIG } from '../types.js';
import { TransformationError } from '../runtime/errors.js';
import { resetIdCounter } from '../runtime/context.js';
import type { ICompiler } from '../types/compiler-interface.js';

/**
 * ATP Compiler - Standard compiler for transforming code to support resumability
 * Implements ICompiler interface for consistency and dependency injection support
 */
export class ATPCompiler implements ICompiler {
	private config: CompilerConfig;
	private detector: AsyncIterationDetector;
	private loopTransformer: LoopTransformer;
	private arrayTransformer: ArrayTransformer;
	private promiseTransformer: PromiseTransformer;

	constructor(config: Partial<CompilerConfig> = {}) {
		this.config = { ...DEFAULT_COMPILER_CONFIG, ...config };
		this.detector = new AsyncIterationDetector();
		this.loopTransformer = new LoopTransformer(this.config.batchSizeThreshold);
		this.arrayTransformer = new ArrayTransformer(this.config.batchSizeThreshold);
		this.promiseTransformer = new PromiseTransformer(this.config.enableBatchParallel);
	}

	detect(code: string) {
		return this.detector.detect(code);
	}

	transform(code: string): TransformResult {
		resetIdCounter();

		const detection = this.detector.detect(code);

		if (!detection.needsTransform) {
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

		try {
			const ast = parse(code, {
				sourceType: 'module',
				plugins: ['typescript'],
				allowAwaitOutsideFunction: true,
				allowReturnOutsideFunction: true,
			});

			this.loopTransformer.resetTransformCount();
			this.arrayTransformer.resetTransformCount();
			this.promiseTransformer.resetTransformCount();

			traverse(ast, {
				ForOfStatement: (path: any) => {
					this.loopTransformer.transformForOfLoop(path);
				},

				WhileStatement: (path: any) => {
					this.loopTransformer.transformWhileLoop(path);
				},

				ForStatement: (path: any) => {
					this.loopTransformer.transformForLoop(path);
				},

				CallExpression: (path: any) => {
					if (this.isArrayMethodCall(path.node)) {
						this.arrayTransformer.transformArrayMethod(path);
					} else if (this.isPromiseAllCall(path.node)) {
						this.promiseTransformer.transformPromiseAll(path);
					} else if (this.isPromiseAllSettledCall(path.node)) {
						this.promiseTransformer.transformPromiseAllSettled(path);
					}
				},
			});

			const output = generate(ast, {
				sourceMaps: false,
				retainLines: true,
				comments: true,
			});

			const metadata: TransformMetadata = {
				loopCount: this.loopTransformer.getTransformCount(),
				arrayMethodCount: this.arrayTransformer.getTransformCount(),
				parallelCallCount: this.promiseTransformer.getTransformCount(),
				batchableCount: detection.batchableParallel ? 1 : 0,
			};

			return {
				code: output.code,
				transformed: true,
				patterns: detection.patterns,
				metadata,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new TransformationError(message, code, 'unknown');
		}
	}

	private isArrayMethodCall(node: t.CallExpression): boolean {
		if (!t.isMemberExpression(node.callee)) {
			return false;
		}

		const property = node.callee.property;
		if (!t.isIdentifier(property)) {
			return false;
		}

		const arrayMethods = ['map', 'forEach', 'filter', 'reduce', 'find', 'some', 'every', 'flatMap'];

		return arrayMethods.includes(property.name);
	}

	private isPromiseAllCall(node: t.CallExpression): boolean {
		const callee = node.callee;
		return (
			t.isMemberExpression(callee) &&
			t.isIdentifier(callee.object, { name: 'Promise' }) &&
			t.isIdentifier(callee.property, { name: 'all' })
		);
	}

	private isPromiseAllSettledCall(node: t.CallExpression): boolean {
		const callee = node.callee;
		return (
			t.isMemberExpression(callee) &&
			t.isIdentifier(callee.object, { name: 'Promise' }) &&
			t.isIdentifier(callee.property, { name: 'allSettled' })
		);
	}

	/**
	 * Get the compiler type identifier (ICompiler interface requirement)
	 */
	getType(): string {
		return 'ATPCompiler';
	}

	/**
	 * Get cache statistics (ICompiler interface requirement)
	 * ATPCompiler doesn't cache ASTs, so returns null
	 */
	getCacheStats() {
		return null;
	}
}

export * from './detector.js';
export * from './batch-detector.js';
export * from './batch-optimizer.js';
export * from './loop-transformer.js';
export * from './array-transformer.js';
export * from './array-transformer-batch-reconstruct.js';
export * from './promise-transformer.js';
export * from './utils.js';
