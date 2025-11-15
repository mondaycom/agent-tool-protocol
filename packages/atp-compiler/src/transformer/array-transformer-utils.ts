import * as t from '@babel/types';
import { isArrayMethod } from './utils.js';

/**
 * Find LLM call expression in AST node
 */
export function findLLMCallExpression(body: t.Node): t.CallExpression | null {
	let found: t.CallExpression | null = null;

	const visit = (node: t.Node) => {
		if (found) return;

		if (t.isAwaitExpression(node) && t.isCallExpression(node.argument)) {
			const call = node.argument;
			if (t.isMemberExpression(call.callee)) {
				found = call;
				return;
			}
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
	return found;
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
