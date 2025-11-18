/**
 * Factory function to create a PluggableCompiler with all default plugins
 * 
 * This makes PluggableCompiler a drop-in replacement for ATPCompiler
 */

import { PluggableCompiler } from './pluggable-compiler.js';
import { DefaultDetectionPlugin } from './default-plugins/detection-plugin.js';
import { DefaultLoopTransformerPlugin } from './default-plugins/loop-transformer-plugin.js';
import { DefaultArrayTransformerPlugin } from './default-plugins/array-transformer-plugin.js';
import { DefaultPromiseTransformerPlugin } from './default-plugins/promise-transformer-plugin.js';
import type { CompilerConfig } from '../types.js';

/**
 * Create a PluggableCompiler with all default ATP transformations
 * 
 * This provides the same functionality as ATPCompiler but with plugin extensibility.
 * 
 * @example
 * ```typescript
 * // Drop-in replacement for ATPCompiler
 * const compiler = createDefaultCompiler({
 *     enableBatchParallel: true,
 *     maxBatchSize: 10,
 * });
 * 
 * // Works exactly like ATPCompiler
 * const result = await compiler.transform(code);
 * 
 * // But you can also add custom plugins!
 * compiler.use(myCustomPlugin);
 * ```
 */
export function createDefaultCompiler(config: Partial<CompilerConfig> = {}): PluggableCompiler {
	const compiler = new PluggableCompiler(config);

	// Register default plugins that provide all ATP compiler functionality
	compiler.use(new DefaultDetectionPlugin());
	compiler.use(new DefaultLoopTransformerPlugin(config.batchSizeThreshold));
	compiler.use(new DefaultArrayTransformerPlugin(config.batchSizeThreshold));
	compiler.use(new DefaultPromiseTransformerPlugin(config.enableBatchParallel));

	return compiler;
}

/**
 * Type alias for backward compatibility
 * 
 * This allows:
 * ```typescript
 * import type { ATPCompilerLike } from '@mondaydotcomorg/atp-compiler';
 * 
 * const compiler: ATPCompilerLike = createDefaultCompiler();
 * ```
 */
export type ATPCompilerLike = PluggableCompiler;

