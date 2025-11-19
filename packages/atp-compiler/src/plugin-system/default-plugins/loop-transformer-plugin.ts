/**
 * Default Loop Transformer Plugin
 * Wraps the existing LoopTransformer
 */

import type { TransformationPlugin, BabelVisitor } from '../plugin-api.js';
import type { CompilerConfig, TransformMetadata } from '../../types.js';
import { LoopTransformer } from '../../transformer/loop-transformer.js';

export class DefaultLoopTransformerPlugin implements TransformationPlugin {
	name = 'atp-loop-transformer';
	version = '1.0.0';
	priority = 100;

	private transformer: LoopTransformer;

	constructor(batchSizeThreshold?: number) {
		this.transformer = new LoopTransformer(batchSizeThreshold);
	}

	getVisitor(config: CompilerConfig): BabelVisitor {
		return {
			ForOfStatement: (path: any) => {
				this.transformer.transformForOfLoop(path);
			},

			WhileStatement: (path: any) => {
				this.transformer.transformWhileLoop(path);
			},

			ForStatement: (path: any) => {
				this.transformer.transformForLoop(path);
			},
		};
	}

	getMetadata(): Partial<TransformMetadata> {
		return {
			loopCount: this.transformer.getTransformCount(),
		};
	}

	reset(): void {
		this.transformer.resetTransformCount();
	}
}
