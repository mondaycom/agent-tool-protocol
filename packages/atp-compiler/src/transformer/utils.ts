import * as t from '@babel/types';
import { PAUSABLE_CALL_PATTERNS } from '../types.js';

export function isPausableCall(node: t.Node): boolean {
	if (!t.isAwaitExpression(node)) {
		return false;
	}

	const argument = node.argument;
	if (!t.isCallExpression(argument)) {
		return false;
	}

	return isPausableCallExpression(argument);
}

export function isPausableCallExpression(node: t.CallExpression): boolean {
	const callee = node.callee;

	if (!t.isMemberExpression(callee)) {
		return false;
	}

	const fullPath = getMemberExpressionPath(callee);

	return PAUSABLE_CALL_PATTERNS.some(
		(pattern) => fullPath === `${pattern.namespace}.${pattern.method}`
	);
}

export function getMemberExpressionPath(node: t.MemberExpression): string {
	const parts: string[] = [];

	let current: t.Node = node;
	while (t.isMemberExpression(current)) {
		if (t.isIdentifier(current.property)) {
			parts.unshift(current.property.name);
		}
		current = current.object;
	}

	if (t.isIdentifier(current)) {
		parts.unshift(current.name);
	}

	return parts.join('.');
}

export function containsAwait(node: t.Node): boolean {
	let hasAwait = false;

	const checkNode = (n: t.Node): void => {
		if (t.isAwaitExpression(n)) {
			hasAwait = true;
			return;
		}

		if (hasAwait) return;

		Object.keys(n).forEach((key) => {
			const value = (n as any)[key];
			if (Array.isArray(value)) {
				value.forEach((item) => {
					if (item && typeof item === 'object' && item.type) {
						checkNode(item);
					}
				});
			} else if (value && typeof value === 'object' && value.type) {
				checkNode(value);
			}
		});
	};

	checkNode(node);
	return hasAwait;
}

export function containsPausableCall(node: t.Node): boolean {
	let hasPausable = false;

	const checkNode = (n: t.Node): void => {
		if (t.isAwaitExpression(n) && isPausableCall(n)) {
			hasPausable = true;
			return;
		}

		if (hasPausable) return;

		Object.keys(n).forEach((key) => {
			const value = (n as any)[key];
			if (Array.isArray(value)) {
				value.forEach((item) => {
					if (item && typeof item === 'object' && item.type) {
						checkNode(item);
					}
				});
			} else if (value && typeof value === 'object' && value.type) {
				checkNode(value);
			}
		});
	};

	checkNode(node);
	return hasPausable;
}

export function isAsyncFunction(node: t.Node): boolean {
	return (
		(t.isFunctionDeclaration(node) ||
			t.isFunctionExpression(node) ||
			t.isArrowFunctionExpression(node)) &&
		node.async === true
	);
}

export function getNodeLocation(node: t.Node): { line: number; column: number } | undefined {
	if (node.loc) {
		return {
			line: node.loc.start.line,
			column: node.loc.start.column,
		};
	}
	return undefined;
}

export function createRuntimeCall(fnName: string, args: t.Expression[]): t.AwaitExpression {
	return t.awaitExpression(
		t.callExpression(t.memberExpression(t.identifier('__runtime'), t.identifier(fnName)), args)
	);
}

export function wrapInAsyncFunction(body: t.Statement[]): t.FunctionExpression {
	return t.functionExpression(null, [], t.blockStatement(body), false, true);
}

export function isArrayMethod(node: t.Node, methodName: string): boolean {
	if (!t.isCallExpression(node)) {
		return false;
	}

	const callee = node.callee;
	if (!t.isMemberExpression(callee)) {
		return false;
	}

	return t.isIdentifier(callee.property) && callee.property.name === methodName;
}

/**
 * Extract parameter name from ForOfStatement left side
 */
export function extractForOfParamName(left: t.VariableDeclaration | t.LVal): string {
	if (t.isVariableDeclaration(left)) {
		const id = left.declarations[0]?.id;
		return t.isIdentifier(id) ? id.name : 'item';
	} else if (t.isIdentifier(left)) {
		return left.name;
	} else {
		return 'item';
	}
}
