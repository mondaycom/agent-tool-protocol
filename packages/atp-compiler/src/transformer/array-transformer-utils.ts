import * as t from '@babel/types';
import { isArrayMethod } from './utils.js';
import type { BatchParallelDetector } from './batch-detector.js';
import type { BatchCallInfo } from '../types.js';

export interface LLMCallInfo {
	callNode: t.CallExpression;
	callInfo: BatchCallInfo;
	payloadNode: t.Expression;
	// Unique key for grouping: "type:operation"
	key: string;
}

/**
 * Find all awaited member expression calls in AST node
 */
function findAllAwaitedMemberCalls(body: t.Node): t.CallExpression[] {
	const calls: t.CallExpression[] = [];

	const visit = (node: t.Node) => {
		if (t.isAwaitExpression(node) && t.isCallExpression(node.argument)) {
			const call = node.argument;
			if (t.isMemberExpression(call.callee)) {
				calls.push(call);
			}
		}

		// Continue traversing
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
	return calls;
}

/**
 * Find ALL LLM call expressions in AST node with batch info
 */
export function findAllLLMCallExpressions(
	body: t.Node,
	batchDetector: BatchParallelDetector
): LLMCallInfo[] {
	const allCalls = findAllAwaitedMemberCalls(body);
	const llmCalls: LLMCallInfo[] = [];

	for (const call of allCalls) {
		const callInfo = batchDetector.extractCallInfo(call);
		const payloadNode = batchDetector.extractPayloadNode(call);

		if (callInfo && payloadNode) {
			llmCalls.push({
				callNode: call,
				callInfo,
				payloadNode,
				key: `${callInfo.type}:${callInfo.operation}`,
			});
		}
	}

	return llmCalls;
}

/**
 * Find first LLM call expression in AST node
 */
export function findLLMCallExpression(body: t.Node): t.CallExpression | null {
	const calls = findAllAwaitedMemberCalls(body);
	return calls[0] ?? null;
}

/**
 * Get array method name from call expression
 */
export function getArrayMethodName(node: t.CallExpression): string | null {
	const arrayMethods = ['map', 'forEach', 'filter', 'reduce', 'find', 'some', 'every', 'flatMap'];
	for (const method of arrayMethods) {
		if (isArrayMethod(node, method)) {
			return method;
		}
	}

	return null;
}

/**
 * Get runtime method name for array method
 */
export function getRuntimeMethodName(arrayMethod: string): string | null {
	const mapping: Record<string, string> = {
		map: 'resumableMap',
		forEach: 'resumableForEach',
		filter: 'resumableFilter',
		reduce: 'resumableReduce',
		find: 'resumableFind',
		some: 'resumableSome',
		every: 'resumableEvery',
		flatMap: 'resumableFlatMap',
	};

	return mapping[arrayMethod] || null;
}

/**
 * Check if method can use batch parallel optimization
 */
export function canUseBatchParallel(methodName: string): boolean {
	return ['map', 'forEach', 'filter', 'find', 'some', 'every'].includes(methodName);
}
