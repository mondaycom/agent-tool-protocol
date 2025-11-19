/**
 * Core compiler interface for ATP
 * All ATP compilers must implement this interface to ensure consistency
 */

import type { DetectionResult, TransformResult } from '../types.js';

/**
 * ICompiler - The core interface that all ATP compilers must implement
 *
 * This interface defines the contract for any compiler in the ATP system,
 * enabling dependency injection and easy extensibility.
 *
 * @example
 * ```typescript
 * class MyCustomCompiler implements ICompiler {
 *   detect(code: string): DetectionResult {
 *     // Detection logic
 *   }
 *
 *   transform(code: string): TransformResult {
 *     // Transformation logic
 *   }
 *
 *   getType(): string {
 *     return 'MyCustomCompiler';
 *   }
 * }
 * ```
 */
export interface ICompiler {
	/**
	 * Detect if code needs transformation and what patterns it contains
	 * Can be synchronous or asynchronous
	 */
	detect(code: string): DetectionResult | Promise<DetectionResult>;

	/**
	 * Transform the code based on detected patterns
	 * Can be synchronous or asynchronous
	 */
	transform(code: string): TransformResult | Promise<TransformResult>;

	/**
	 * Get the compiler type identifier
	 */
	getType(): string;

	/**
	 * Get cache statistics (optional)
	 * Useful for performance monitoring and debugging
	 */
	getCacheStats?(): CacheStats | null;
}

/**
 * Cache statistics structure
 */
export interface CacheStats {
	size: number;
	enabled: boolean;
}

/**
 * Type guard to check if an object implements ICompiler
 */
export function isCompiler(obj: unknown): obj is ICompiler {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		'detect' in obj &&
		'transform' in obj &&
		'getType' in obj &&
		typeof (obj as any).detect === 'function' &&
		typeof (obj as any).transform === 'function' &&
		typeof (obj as any).getType === 'function'
	);
}
