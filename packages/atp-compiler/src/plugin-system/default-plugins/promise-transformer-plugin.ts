/**
 * Default Promise Transformer Plugin
 * Wraps the existing PromiseTransformer
 */

import * as t from '@babel/types';
import type { TransformationPlugin, BabelVisitor } from '../plugin-api.js';
import type { CompilerConfig, TransformMetadata } from '../../types.js';
import { PromiseTransformer } from '../../transformer/promise-transformer.js';

export class DefaultPromiseTransformerPlugin implements TransformationPlugin {
	name = 'atp-promise-transformer';
	version = '1.0.0';
	priority = 100;

	private transformer: PromiseTransformer;

	constructor(enableBatchParallel?: boolean) {
		this.transformer = new PromiseTransformer(enableBatchParallel);
	}

	getVisitor(config: CompilerConfig): BabelVisitor {
		return {
			CallExpression: (path: any) => {
				const node = path.node;
				if (this.isPromiseAllCall(node)) {
					this.transformer.transformPromiseAll(path);
				} else if (this.isPromiseAllSettledCall(node)) {
					this.transformer.transformPromiseAllSettled(path);
				}
			},
		};
	}

	getMetadata(): Partial<TransformMetadata> {
		return {
			parallelCallCount: this.transformer.getTransformCount(),
		};
	}

	reset(): void {
		this.transformer.resetTransformCount();
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
}
