/**
 * Default Array Transformer Plugin
 * Wraps the existing ArrayTransformer
 */

import * as t from '@babel/types';
import type { TransformationPlugin, BabelVisitor } from '../plugin-api.js';
import type { CompilerConfig, TransformMetadata } from '../../types.js';
import { ArrayTransformer } from '../../transformer/array-transformer.js';

export class DefaultArrayTransformerPlugin implements TransformationPlugin {
	name = 'atp-array-transformer';
	version = '1.0.0';
	priority = 100;

	private transformer: ArrayTransformer;

	constructor(batchSizeThreshold?: number) {
		this.transformer = new ArrayTransformer(batchSizeThreshold);
	}

	getVisitor(config: CompilerConfig): BabelVisitor {
		return {
			CallExpression: (path: any) => {
				const node = path.node;
				if (this.isArrayMethodCall(node)) {
					this.transformer.transformArrayMethod(path);
				}
			},
		};
	}

	getMetadata(): Partial<TransformMetadata> {
		return {
			arrayMethodCount: this.transformer.getTransformCount(),
		};
	}

	reset(): void {
		this.transformer.resetTransformCount();
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
}
