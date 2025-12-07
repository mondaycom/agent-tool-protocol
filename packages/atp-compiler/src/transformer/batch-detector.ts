import * as t from '@babel/types';
import type { BatchCallInfo, BatchServiceType } from '../types.js';
import { isPausableCallExpression, getMemberExpressionPath } from './utils.js';

export class BatchParallelDetector {
	canBatch(promiseAllNode: t.CallExpression): boolean {
		const arrayArg = promiseAllNode.arguments[0];

		if (!t.isArrayExpression(arrayArg)) {
			return false;
		}

		if (arrayArg.elements.length === 0) {
			return false;
		}

		return arrayArg.elements.every((el) => {
			if (!el || t.isSpreadElement(el)) {
				return false;
			}

			return this.isDirectPausableCall(el);
		});
	}

	private isDirectPausableCall(node: t.Node): boolean {
		if (t.isAwaitExpression(node)) {
			node = node.argument;
		}

		if (!t.isCallExpression(node)) {
			return false;
		}

		return isPausableCallExpression(node);
	}

	extractBatchCalls(arrayNode: t.ArrayExpression): BatchCallInfo[] {
		const calls: BatchCallInfo[] = [];

		for (const el of arrayNode.elements) {
			if (!el || t.isSpreadElement(el)) {
				continue;
			}

			let callNode: t.Node = el;
			if (t.isAwaitExpression(callNode)) {
				callNode = callNode.argument;
			}

			if (!t.isCallExpression(callNode)) {
				continue;
			}

			const callInfo = this.extractCallInfo(callNode);
			if (callInfo) {
				calls.push(callInfo);
			}
		}

		return calls;
	}

	extractCallInfo(callNode: t.CallExpression): BatchCallInfo | null {
		if (!t.isMemberExpression(callNode.callee)) {
			return null;
		}

		const path = getMemberExpressionPath(callNode.callee);
		const parts = path.split('.');

		if (parts.length < 3) {
			return null;
		}

		const [namespace, service, method] = parts;
		if (!service || !method) {
			return null;
		}

		let type: BatchServiceType;
		if (namespace === 'atp') {
			if (!['llm', 'approval', 'embedding'].includes(service)) {
				return null;
			}
			type = service as BatchServiceType;
		} else if (namespace === 'api' && service === 'client') {
			type = 'tool';
		} else {
			return null;
		}
		const payload = this.extractPayload(callNode.arguments as t.Expression[]);

		return {
			type,
			operation: method,
			payload,
		};
	}

	/**
	 * Extract payload AST node directly
	 */
	extractPayloadNode(callNode: t.CallExpression): t.Expression | null {
		if (callNode.arguments.length === 0) {
			return t.objectExpression([]);
		}

		const firstArg = callNode.arguments[0];
		if (!firstArg || t.isSpreadElement(firstArg) || !t.isExpression(firstArg)) {
			return null;
		}

		return firstArg;
	}

	private extractPayload(args: Array<t.Expression | t.SpreadElement>): Record<string, unknown> {
		if (args.length === 0) {
			return {};
		}

		const firstArg = args[0];
		if (t.isSpreadElement(firstArg)) {
			return {};
		}

		if (t.isObjectExpression(firstArg)) {
			return this.objectExpressionToRecord(firstArg);
		}

		if (t.isStringLiteral(firstArg)) {
			return { message: firstArg.value };
		}

		return {};
	}

	private objectExpressionToRecord(obj: t.ObjectExpression): Record<string, unknown> {
		const record: Record<string, unknown> = {};

		for (const prop of obj.properties) {
			if (t.isObjectProperty(prop) && !prop.computed) {
				const key = t.isIdentifier(prop.key) ? prop.key.name : String(prop.key);
				const value = this.extractValue(prop.value);
				record[key] = value;
			}
		}

		return record;
	}

	private extractValue(node: t.Node): unknown {
		if (t.isStringLiteral(node)) {
			return node.value;
		}
		if (t.isNumericLiteral(node)) {
			return node.value;
		}
		if (t.isBooleanLiteral(node)) {
			return node.value;
		}
		if (t.isNullLiteral(node)) {
			return null;
		}
		if (t.isArrayExpression(node)) {
			return node.elements.map((el) =>
				el && !t.isSpreadElement(el) ? this.extractValue(el) : null
			);
		}
		if (t.isObjectExpression(node)) {
			return this.objectExpressionToRecord(node);
		}

		return undefined;
	}
}
