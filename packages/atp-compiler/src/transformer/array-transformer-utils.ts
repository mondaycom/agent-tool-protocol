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
 * Collect all identifiers referenced in an expression
 */
function collectReferencedIdentifiers(node: t.Node): Set<string> {
	const identifiers = new Set<string>();

	const visit = (n: t.Node) => {
		if (t.isIdentifier(n)) {
			identifiers.add(n.name);
		}

		// Continue traversing
		Object.keys(n).forEach((key) => {
			// Skip 'type' and other metadata fields
			if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') return;
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
	return identifiers;
}

/**
 * Collect all variable names declared inside a callback body.
 * This includes: const/let/var declarations, function parameters, etc.
 */
function collectLocalVariables(body: t.Node): Set<string> {
	const locals = new Set<string>();

	const visit = (node: t.Node) => {
		// Variable declarations: const x = ..., let y = ..., var z = ...
		if (t.isVariableDeclaration(node)) {
			for (const decl of node.declarations) {
				if (t.isIdentifier(decl.id)) {
					locals.add(decl.id.name);
				} else if (t.isObjectPattern(decl.id)) {
					// Destructuring: const { a, b } = ...
					for (const prop of decl.id.properties) {
						if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
							locals.add(prop.value.name);
						} else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
							locals.add(prop.argument.name);
						}
					}
				} else if (t.isArrayPattern(decl.id)) {
					// Destructuring: const [a, b] = ...
					for (const elem of decl.id.elements) {
						if (t.isIdentifier(elem)) {
							locals.add(elem.name);
						}
					}
				}
			}
		}

		// Continue traversing (but don't descend into nested functions - their locals are their own scope)
		if (t.isFunction(node)) {
			return; // Don't traverse into nested functions
		}

		Object.keys(node).forEach((key) => {
			if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') return;
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
	return locals;
}

/**
 * Check if LLM call payloads depend on variables that are local to the callback.
 * This includes:
 * - Variables computed from other expressions (const x = item.name.toUpperCase())
 * - Results from previous LLM calls (const title = await atp.llm.call(...))
 * - Any other locally-defined variable
 *
 * When batch transforming, the payload mapper only has access to the array item parameter
 * and outer scope variables - NOT local variables defined inside the callback.
 *
 * @param body - The callback body
 * @param itemParamName - The name of the array item parameter (e.g., "item")
 * @param batchDetector - The batch detector for extracting LLM call info
 * @returns true if there are dependencies that prevent batch transformation
 */
export function hasLLMCallDependencies(
	body: t.Node,
	batchDetector: BatchParallelDetector,
	itemParamName?: string
): boolean {
	// Find all locally-defined variables in the callback body
	const localVariables = collectLocalVariables(body);

	// If no local variables, no dependencies possible
	if (localVariables.size === 0) {
		return false;
	}

	// Now check if any LLM call payload references these local variables
	const allCalls = findAllAwaitedMemberCalls(body);

	for (const call of allCalls) {
		const payloadNode = batchDetector.extractPayloadNode(call);
		if (payloadNode) {
			const referencedIds = collectReferencedIdentifiers(payloadNode);
			// Check if any referenced identifier is a local variable
			// (excluding the item parameter which is passed to the payload mapper)
			for (const id of referencedIds) {
				if (localVariables.has(id) && id !== itemParamName) {
					return true; // Found a dependency on a local variable
				}
			}
		}
	}

	return false;
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
