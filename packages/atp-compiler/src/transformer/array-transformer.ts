import * as t from '@babel/types';
import { BatchOptimizer } from './batch-optimizer.js';
import { BatchParallelDetector } from './batch-detector.js';
import {
	getArrayMethodName,
	canUseBatchParallel,
	findLLMCallExpression,
	hasLLMCallDependencies,
} from './array-transformer-utils.js';
import { transformToBatchParallel } from './array-transformer-batch.js';
import { transformToSequential } from './array-transformer-sequential.js';
import { transformToBatchWithReconstruction } from './array-transformer-batch-reconstruct.js';

export class ArrayTransformer {
	private transformCount = 0;
	private batchOptimizer: BatchOptimizer;
	private batchDetector: BatchParallelDetector;
	private batchSizeThreshold: number;

	constructor(batchSizeThreshold: number = 10) {
		this.batchOptimizer = new BatchOptimizer();
		this.batchDetector = new BatchParallelDetector();
		this.batchSizeThreshold = batchSizeThreshold;
	}

	transformArrayMethod(path: any): boolean {
		const node = path.node as t.CallExpression;

		const methodName = getArrayMethodName(node);
		if (!methodName) {
			return false;
		}

		const callback = node.arguments[0];
		if (!callback || !t.isFunction(callback) || !callback.async) {
			return false;
		}

		const batchResult = this.batchOptimizer.canBatchArrayMethod(callback);
		if (!batchResult.canBatch && methodName === 'map') {
			const reason = batchResult.reason || '';
			// Try batch-with-reconstruction for:
			// 1. Object/array returns (would lose structure with simple batch)
			// 2. Multiple pausable calls (can batch each call type separately)
			const canTryBatchReconstruct =
				reason.includes('object expression') ||
				reason.includes('array expression') ||
				reason.includes('Multiple pausable calls');

			if (canTryBatchReconstruct) {
				const llmCall = findLLMCallExpression(callback.body);
				// Get the item parameter name (e.g., "item" in items.map(async (item) => ...))
				const itemParam = callback.params[0];
				const itemParamName = t.isIdentifier(itemParam) ? itemParam.name : undefined;
				// Check for dependencies on local variables (e.g., computed values, previous LLM results)
				// If dependencies exist, we can't batch because payload mapper only has access to item + outer scope
				const hasDependencies = hasLLMCallDependencies(
					callback.body,
					this.batchDetector,
					itemParamName
				);
				if (llmCall && !hasDependencies) {
					const success = transformToBatchWithReconstruction(
						path,
						node,
						methodName,
						callback,
						this.batchDetector,
						() => this.transformCount++
					);
					if (success) {
						return true;
					}
				}
			}
		}

		if (batchResult.canBatch && canUseBatchParallel(methodName)) {
			const array = (node.callee as t.MemberExpression).object;
			const decision = this.batchOptimizer.makeSmartBatchDecision(
				methodName,
				batchResult,
				array,
				this.batchSizeThreshold
			);

			if (decision.shouldBatch) {
				return transformToBatchParallel(
					path,
					node,
					methodName,
					callback,
					this.batchDetector,
					() => this.transformCount++,
					() => this.doTransformToSequential(path, node, methodName, callback)
				);
			}
		}

		return this.doTransformToSequential(path, node, methodName, callback);
	}

	private doTransformToSequential(
		path: any,
		node: t.CallExpression,
		methodName: string,
		callback: t.Function
	): boolean {
		return transformToSequential(path, node, methodName, callback, () => this.transformCount++);
	}

	getTransformCount(): number {
		return this.transformCount;
	}

	resetTransformCount(): void {
		this.transformCount = 0;
	}
}
