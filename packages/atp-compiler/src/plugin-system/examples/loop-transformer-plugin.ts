/**
 * Example: Loop Transformer as a Plugin
 *
 * Shows how to migrate existing LoopTransformer to plugin architecture
 * This demonstrates the migration path for built-in transformers
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { TransformationPlugin, BabelVisitor } from '../plugin-api.js';
import type { CompilerConfig, TransformMetadata } from '../../types.js';
import { LoopTransformer } from '../../transformer/loop-transformer.js';

/**
 * Loop Transformer Plugin
 *
 * Transforms for...of, while, and for loops into resumable versions
 * with checkpoint-based state management
 */
export class LoopTransformerPlugin implements TransformationPlugin {
	name = 'loop-transformer';
	version = '1.0.0';
	priority = 50; // Standard priority for core transformations

	private transformer: LoopTransformer;

	constructor(batchSizeThreshold: number = 10) {
		this.transformer = new LoopTransformer(batchSizeThreshold);
	}

	initialize(config: CompilerConfig): void {
		// Initialize with config if needed
		console.log('[LoopTransformerPlugin] Initialized');
	}

	getVisitor(config: CompilerConfig): BabelVisitor {
		return {
			ForOfStatement: (path: NodePath<t.ForOfStatement>) => {
				this.transformer.transformForOfLoop(path as any);
			},

			WhileStatement: (path: NodePath<t.WhileStatement>) => {
				this.transformer.transformWhileLoop(path as any);
			},

			ForStatement: (path: NodePath<t.ForStatement>) => {
				this.transformer.transformForLoop(path as any);
			},
		};
	}

	getMetadata(): Partial<TransformMetadata> {
		return {
			loopCount: this.transformer.getTransformCount(),
			arrayMethodCount: 0,
			parallelCallCount: 0,
			batchableCount: 0,
		};
	}

	reset(): void {
		this.transformer.resetTransformCount();
	}

	dispose(): void {
		console.log('[LoopTransformerPlugin] Disposed');
	}
}

/**
 * Factory function for easy creation
 */
export function createLoopTransformerPlugin(batchSizeThreshold?: number): LoopTransformerPlugin {
	return new LoopTransformerPlugin(batchSizeThreshold);
}
