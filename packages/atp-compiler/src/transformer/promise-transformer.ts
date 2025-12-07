import * as t from '@babel/types';
import { generateUniqueId } from '../runtime/context.js';
import { BatchParallelDetector } from './batch-detector.js';
import { RuntimeFunction } from '../runtime/runtime-functions.js';
import type { BatchCallInfo } from '../types.js';

const TOOL_OPERATION_CALL = 'call';

export class PromiseTransformer {
	private transformCount = 0;
	private batchDetector: BatchParallelDetector;
	private enableBatchParallel: boolean;

	constructor(enableBatchParallel = true) {
		this.batchDetector = new BatchParallelDetector();
		this.enableBatchParallel = enableBatchParallel;
	}

	transformPromiseAll(path: any): boolean {
		const node = path.node as t.CallExpression;

		if (!this.isPromiseAll(node)) {
			return false;
		}

		const arrayArg = node.arguments[0];

		if (this.enableBatchParallel && this.batchDetector.canBatch(node)) {
			return this.transformToBatchParallel(path, node);
		}

		if (t.isArrayExpression(arrayArg)) {
			return this.transformToSequential(path, node);
		}

		return false;
	}

	transformPromiseAllSettled(path: any): boolean {
		const node = path.node as t.CallExpression;

		if (!this.isPromiseAllSettled(node)) {
			return false;
		}

		const arrayArg = node.arguments[0];

		if (t.isArrayExpression(arrayArg)) {
			const parallelId = generateUniqueId('allSettled');

			const runtimeCall = t.awaitExpression(
				t.callExpression(
					t.memberExpression(
						t.identifier('__runtime'),
						t.identifier(RuntimeFunction.RESUMABLE_PROMISE_ALL_SETTLED)
					),
					[arrayArg, t.stringLiteral(parallelId)]
				)
			);

			path.replaceWith(runtimeCall);
			this.transformCount++;
			return true;
		}

		return false;
	}

	private transformToBatchParallel(path: any, node: t.CallExpression): boolean {
		const arrayArg = node.arguments[0];
		if (!t.isArrayExpression(arrayArg)) {
			return false;
		}

		const batchId = generateUniqueId('batch');

		const batchCallsArray = t.arrayExpression(
			arrayArg.elements.map((el) => {
				if (!el || t.isSpreadElement(el)) {
					return t.nullLiteral();
				}

				let callNode: t.Node = el;
				if (t.isAwaitExpression(callNode)) {
					callNode = callNode.argument;
				}

				if (!t.isCallExpression(callNode) || !t.isMemberExpression(callNode.callee)) {
					return t.nullLiteral();
				}

				const callInfo = this.batchDetector.extractCallInfo(callNode);
				if (!callInfo) {
					return t.nullLiteral();
				}

				const payloadArg = callNode.arguments[0];
				return this.buildBatchCallObject(callInfo, payloadArg);
			})
		);

		const runtimeCall = t.awaitExpression(
			t.callExpression(
				t.memberExpression(t.identifier('__runtime'), t.identifier('batchParallel')),
				[batchCallsArray, t.stringLiteral(batchId)]
			)
		);

		path.replaceWith(runtimeCall);
		this.transformCount++;
		return true;
	}

	/**
	 * Builds the AST for a batch call object.
	 * For client tools, wraps payload with toolName and input structure.
	 */
	private buildBatchCallObject(
		callInfo: BatchCallInfo,
		payloadArg: t.Node | undefined
	): t.ObjectExpression {
		const payloadExpr =
			payloadArg && t.isExpression(payloadArg) ? payloadArg : t.objectExpression([]);

		if (callInfo.type === 'tool') {
			// Client tools: operation is always 'call', payload contains toolName and input
			return t.objectExpression([
				t.objectProperty(t.identifier('type'), t.stringLiteral(callInfo.type)),
				t.objectProperty(t.identifier('operation'), t.stringLiteral(TOOL_OPERATION_CALL)),
				t.objectProperty(
					t.identifier('payload'),
					t.objectExpression([
						t.objectProperty(t.identifier('toolName'), t.stringLiteral(callInfo.operation)),
						t.objectProperty(t.identifier('input'), payloadExpr),
					])
				),
			]);
		}

		// Standard services (llm, approval, embedding)
		return t.objectExpression([
			t.objectProperty(t.identifier('type'), t.stringLiteral(callInfo.type)),
			t.objectProperty(t.identifier('operation'), t.stringLiteral(callInfo.operation)),
			t.objectProperty(t.identifier('payload'), payloadExpr),
		]);
	}

	private transformToSequential(path: any, node: t.CallExpression): boolean {
		const arrayArg = node.arguments[0];
		if (!t.isArrayExpression(arrayArg)) {
			return false;
		}

		const parallelId = generateUniqueId('parallel');

		const runtimeCall = t.awaitExpression(
			t.callExpression(
				t.memberExpression(t.identifier('__runtime'), t.identifier('resumablePromiseAll')),
				[arrayArg, t.stringLiteral(parallelId)]
			)
		);

		path.replaceWith(runtimeCall);
		this.transformCount++;
		return true;
	}

	private payloadToExpression(payload: Record<string, unknown>): t.ObjectExpression {
		const properties: t.ObjectProperty[] = [];

		for (const [key, value] of Object.entries(payload)) {
			properties.push(t.objectProperty(t.identifier(key), this.valueToExpression(value)));
		}

		return t.objectExpression(properties);
	}

	private valueToExpression(value: unknown): t.Expression {
		if (typeof value === 'string') {
			return t.stringLiteral(value);
		}
		if (typeof value === 'number') {
			return t.numericLiteral(value);
		}
		if (typeof value === 'boolean') {
			return t.booleanLiteral(value);
		}
		if (value === null) {
			return t.nullLiteral();
		}
		if (Array.isArray(value)) {
			return t.arrayExpression(value.map((v) => this.valueToExpression(v)));
		}
		if (typeof value === 'object') {
			return this.payloadToExpression(value as Record<string, unknown>);
		}

		return t.identifier('undefined');
	}

	private isPromiseAll(node: t.CallExpression): boolean {
		const callee = node.callee;
		return (
			t.isMemberExpression(callee) &&
			t.isIdentifier(callee.object, { name: 'Promise' }) &&
			t.isIdentifier(callee.property, { name: 'all' })
		);
	}

	private isPromiseAllSettled(node: t.CallExpression): boolean {
		const callee = node.callee;
		return (
			t.isMemberExpression(callee) &&
			t.isIdentifier(callee.object, { name: 'Promise' }) &&
			t.isIdentifier(callee.property, { name: 'allSettled' })
		);
	}

	getTransformCount(): number {
		return this.transformCount;
	}

	resetTransformCount(): void {
		this.transformCount = 0;
	}
}
