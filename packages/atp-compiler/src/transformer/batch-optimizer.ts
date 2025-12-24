import * as t from '@babel/types';
import { isPausableCallExpression } from './utils.js';

export interface BatchOptimizationResult {
	canBatch: boolean;
	reason?: string;
	llmCallPattern?: 'single' | 'multiple' | 'conditional';
	hasConditionals?: boolean;
	hasLoops?: boolean;
}

export interface SmartBatchDecision {
	shouldBatch: boolean;
	reason: string;
	strategy: 'always-batch' | 'size-dependent' | 'never-batch';
}

export class BatchOptimizer {
	private arrayMethodsWithEarlyExit = ['find', 'some', 'every'];

	canBatchArrayMethod(callback: t.Function): BatchOptimizationResult {
		if (!callback.async) {
			return { canBatch: false, reason: 'Not async' };
		}

		const body = callback.body;

		if (!t.isBlockStatement(body)) {
			if (t.isAwaitExpression(body)) {
				if (this.isDirectPausableCall(body.argument)) {
					return { canBatch: true, llmCallPattern: 'single', hasConditionals: false };
				}
			}
			return { canBatch: false, reason: 'Non-block body without direct call' };
		}

		const statements = body.body;

		if (statements.length === 0) {
			return { canBatch: false, reason: 'Empty body' };
		}

		let hasConditionals = false;
		let hasLoops = false;
		let hasTryCatch = false;

		for (const stmt of statements) {
			if (t.isIfStatement(stmt) || t.isSwitchStatement(stmt)) {
				hasConditionals = true;
			}

			if (t.isTryStatement(stmt)) {
				hasTryCatch = true;
			}

			if (
				t.isForStatement(stmt) ||
				t.isForOfStatement(stmt) ||
				t.isForInStatement(stmt) ||
				t.isWhileStatement(stmt) ||
				t.isDoWhileStatement(stmt)
			) {
				hasLoops = true;
			}

			if (t.isBreakStatement(stmt) || t.isContinueStatement(stmt)) {
				return { canBatch: false, reason: 'Contains break/continue' };
			}

			if (t.isReturnStatement(stmt) && stmt !== statements[statements.length - 1]) {
				return { canBatch: false, reason: 'Early return' };
			}
		}

		if (hasLoops) {
			return { canBatch: false, reason: 'Contains loops', hasLoops: true };
		}

		if (hasTryCatch) {
			return { canBatch: false, reason: 'Contains try-catch' };
		}

		const pausableCalls = this.countPausableCalls(body);
		if (pausableCalls === 0) {
			return { canBatch: false, reason: 'No pausable calls' };
		}

		if (pausableCalls > 1) {
			return { canBatch: false, reason: 'Multiple pausable calls', llmCallPattern: 'multiple' };
		}

		if (hasConditionals) {
			return {
				canBatch: true,
				llmCallPattern: 'conditional',
				hasConditionals: true,
				reason: 'Simple conditional - can batch but consider array size',
			};
		}

		const lastStmt = statements[statements.length - 1];
		if (t.isReturnStatement(lastStmt) && lastStmt.argument) {
			if (t.isObjectExpression(lastStmt.argument)) {
				return {
					canBatch: false,
					reason: 'Return statement is object expression - batch would lose structure',
				};
			}
			if (t.isArrayExpression(lastStmt.argument)) {
				return {
					canBatch: false,
					reason: 'Return statement is array expression - batch would lose structure',
				};
			}
		}

		return { canBatch: true, llmCallPattern: 'single', hasConditionals: false };
	}

	/**
	 * Smart decision: Should we batch based on array size and method type?
	 */
	makeSmartBatchDecision(
		methodName: string,
		batchResult: BatchOptimizationResult,
		arrayNode: t.Expression,
		threshold: number = 10
	): SmartBatchDecision {
		if (!batchResult.canBatch) {
			return {
				shouldBatch: false,
				reason: 'Complex callback - use sequential',
				strategy: 'never-batch',
			};
		}

		if (!batchResult.hasConditionals) {
			return {
				shouldBatch: true,
				reason: 'Simple callback - batching is faster',
				strategy: 'always-batch',
			};
		}

		const hasEarlyExitBenefit = this.arrayMethodsWithEarlyExit.includes(methodName);

		if (!hasEarlyExitBenefit) {
			const arraySize = this.estimateArraySize(arrayNode);

			if (arraySize !== null && arraySize < threshold) {
				return {
					shouldBatch: true,
					reason: `Small array (${arraySize} < ${threshold}) - batch despite conditionals`,
					strategy: 'size-dependent',
				};
			}

			return {
				shouldBatch: false,
				reason: 'Conditionals + large/unknown array - sequential for safety',
				strategy: 'size-dependent',
			};
		}

		const arraySize = this.estimateArraySize(arrayNode);

		if (arraySize !== null && arraySize < threshold) {
			return {
				shouldBatch: true,
				reason: `Small array (${arraySize} < ${threshold}) - batch for speed`,
				strategy: 'size-dependent',
			};
		}

		if (arraySize !== null && arraySize >= threshold) {
			return {
				shouldBatch: false,
				reason: `Large array (${arraySize} >= ${threshold}) + conditionals - sequential for early-exit savings`,
				strategy: 'size-dependent',
			};
		}

		if (t.isArrayExpression(arrayNode)) {
			return {
				shouldBatch: true,
				reason: 'Array literal (likely small) - batch',
				strategy: 'size-dependent',
			};
		}

		return {
			shouldBatch: false,
			reason: 'Unknown array size + conditionals - sequential for safety',
			strategy: 'size-dependent',
		};
	}

	private estimateArraySize(arrayNode: t.Expression): number | null {
		if (t.isArrayExpression(arrayNode)) {
			return arrayNode.elements.length;
		}

		return null;
	}

	canBatchForOfLoop(loopNode: t.ForOfStatement): BatchOptimizationResult {
		const body = loopNode.body;

		if (!t.isBlockStatement(body)) {
			return { canBatch: false, reason: 'Loop body not a block' };
		}

		const statements = body.body;

		if (statements.length === 0) {
			return { canBatch: false, reason: 'Empty loop body' };
		}

		const hasBreakOrContinue = this.containsBreakOrContinue(body);
		if (hasBreakOrContinue) {
			return { canBatch: false, reason: 'Contains break/continue' };
		}

		let hasConditionals = false;

		for (const stmt of statements) {
			if (t.isIfStatement(stmt) || t.isSwitchStatement(stmt)) {
				hasConditionals = true;
			}

			if (
				t.isForStatement(stmt) ||
				t.isForOfStatement(stmt) ||
				t.isForInStatement(stmt) ||
				t.isWhileStatement(stmt) ||
				t.isDoWhileStatement(stmt)
			) {
				return { canBatch: false, reason: 'Contains nested loops', hasLoops: true };
			}
		}

		const pausableCalls = this.countPausableCalls(body);
		if (pausableCalls === 0) {
			return { canBatch: false, reason: 'No pausable calls' };
		}

		if (pausableCalls > 1) {
			return { canBatch: false, reason: 'Multiple pausable calls', llmCallPattern: 'multiple' };
		}

		if (hasConditionals) {
			return {
				canBatch: true,
				llmCallPattern: 'conditional',
				hasConditionals: true,
				reason: 'Simple conditional - can batch but consider array size',
			};
		}

		return { canBatch: true, llmCallPattern: 'single', hasConditionals: false };
	}

	private containsBreakOrContinue(node: t.Node): boolean {
		let found = false;

		const visit = (n: t.Node) => {
			if (found) return;

			if (t.isBreakStatement(n) || t.isContinueStatement(n)) {
				found = true;
				return;
			}

			if (
				t.isForStatement(n) ||
				t.isForOfStatement(n) ||
				t.isForInStatement(n) ||
				t.isWhileStatement(n) ||
				t.isDoWhileStatement(n)
			) {
				return;
			}

			Object.keys(n).forEach((key) => {
				const value = (n as any)[key];
				if (Array.isArray(value)) {
					value.forEach((item) => {
						if (item && typeof item === 'object' && item.type) {
							visit(item);
						}
					});
				} else if (value && typeof value === 'object' && value.type) {
					visit(value);
				}
			});
		};

		visit(node);
		return found;
	}

	private isDirectPausableCall(node: t.Node): boolean {
		if (!t.isCallExpression(node)) {
			return false;
		}

		return isPausableCallExpression(node);
	}

	private countPausableCalls(body: t.BlockStatement): number {
		let count = 0;

		const visit = (node: t.Node) => {
			if (t.isAwaitExpression(node) && this.isDirectPausableCall(node.argument)) {
				count++;
				return;
			}

			Object.keys(node).forEach((key) => {
				const value = (node as any)[key];
				if (Array.isArray(value)) {
					value.forEach((item) => {
						if (item && typeof item === 'object' && item.type) {
							visit(item);
						}
					});
				} else if (value && typeof value === 'object' && value.type) {
					visit(value);
				}
			});
		};

		visit(body);
		return count;
	}
}
