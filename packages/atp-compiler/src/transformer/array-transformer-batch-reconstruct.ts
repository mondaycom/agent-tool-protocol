import * as t from '@babel/types';
import _traverse from '@babel/traverse';
const traverse = typeof (_traverse as any).default === 'function' ? (_traverse as any).default : _traverse;
import { generateUniqueId } from '../runtime/context.js';
import { BatchParallelDetector } from './batch-detector.js';
import { findLLMCallExpression } from './array-transformer-utils.js';

/**
 * Transform array method to batch LLM calls while preserving callback logic.
 * 
 * This creates a two-step transformation:
 * 1. Batch all LLM calls in parallel
 * 2. Reconstruct objects using the batched results 
 */
export function transformToBatchWithReconstruction(
	path: any,
	node: t.CallExpression,
	methodName: string,
	callback: t.Function,
	batchDetector: BatchParallelDetector,
	onTransform: () => void
): boolean {
	if (methodName !== 'map') {
		return false;
	}

	const paramName = callback.params[0];
	if (!t.isIdentifier(paramName)) {
		return false;
	}

	const param = paramName.name;
	const array = (node.callee as t.MemberExpression).object;

	const llmCall = findLLMCallExpression(callback.body);
	if (!llmCall) {
		return false;
	}

	const callInfo = batchDetector.extractCallInfo(llmCall);
	if (!callInfo) {
		return false;
	}

	const payloadNode = batchDetector.extractPayloadNode(llmCall);
	if (!payloadNode) {
		return false;
	}

	const methodId = generateUniqueId(`${methodName}_batch_reconstruct`);
	const resultsVar = `__batch_results_${methodId.replace(/[^a-zA-Z0-9]/g, '_')}`;
	const indexVar = '__idx';

	const payloadMapper = t.arrowFunctionExpression(
		[t.identifier(param)],
		t.objectExpression([
			t.objectProperty(t.identifier('type'), t.stringLiteral(callInfo.type)),
			t.objectProperty(t.identifier('operation'), t.stringLiteral(callInfo.operation)),
			t.objectProperty(t.identifier('payload'), t.cloneNode(payloadNode, true)),
		])
	);

	const clonedBody = t.cloneNode(callback.body, true);
	
	const resultAccess = t.memberExpression(
		t.identifier(resultsVar),
		t.identifier(indexVar),
		true
	);

	let traversableNode: t.Statement;
	if (t.isBlockStatement(clonedBody)) {
		traversableNode = t.functionDeclaration(
			t.identifier('__temp'),
			[],
			clonedBody
		);
	} else {
		traversableNode = t.expressionStatement(clonedBody as t.Expression);
	}

	let replaced = false;
	traverse(t.file(t.program([traversableNode])), {
		AwaitExpression(awaitPath: any) {
			if (replaced) return;
			const arg = awaitPath.node.argument;
			if (t.isCallExpression(arg)) {
				const info = batchDetector.extractCallInfo(arg);
				if (info && info.type === callInfo.type && info.operation === callInfo.operation) {
					awaitPath.replaceWith(resultAccess);
					replaced = true;
				}
			}
		},
		noScope: true,
	});

	if (!replaced) {
		return false;
	}

	let reconstructBody: t.BlockStatement | t.Expression;
	if (t.isBlockStatement(clonedBody)) {
		reconstructBody = clonedBody;
	} else {
		reconstructBody = clonedBody as t.Expression;
	}

	const reconstructMapper = t.arrowFunctionExpression(
		[t.identifier(param), t.identifier(indexVar)],
		reconstructBody
	);
	reconstructMapper.async = false;

	const batchCall = t.awaitExpression(
		t.callExpression(
			t.memberExpression(t.identifier('__runtime'), t.identifier('batchParallel')),
			[
				t.callExpression(
					t.memberExpression(t.cloneNode(array, true), t.identifier('map')),
					[payloadMapper]
				),
				t.stringLiteral(methodId),
			]
		)
	);

	const resultsDeclaration = t.variableDeclaration('const', [
		t.variableDeclarator(t.identifier(resultsVar), batchCall),
	]);

	const reconstructCall = t.callExpression(
		t.memberExpression(t.cloneNode(array, true), t.identifier('map')),
		[reconstructMapper]
	);

	const iife = t.callExpression(
		t.arrowFunctionExpression(
			[],
			t.blockStatement([
				resultsDeclaration,
				t.returnStatement(reconstructCall),
			]),
			true
		),
		[]
	);

	const awaitIife = t.awaitExpression(iife);

	path.replaceWith(awaitIife);
	onTransform();
	return true;
}

