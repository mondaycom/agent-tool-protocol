import * as t from '@babel/types';
import _traverse from '@babel/traverse';
const traverse = typeof (_traverse as any).default === 'function' ? (_traverse as any).default : _traverse;
import { generateUniqueId } from '../runtime/context.js';
import { BatchParallelDetector } from './batch-detector.js';
import { findAllLLMCallExpressions } from './array-transformer-utils.js';

/**
 * Transform array method to batch LLM calls while preserving callback logic.
 * Supports multiple LLM calls per callback.
 *
 * This creates a multi-step transformation:
 * 1. Batch all LLM calls in parallel (one batch per unique type:operation)
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

	// Find ALL LLM calls
	const llmCalls = findAllLLMCallExpressions(callback.body, batchDetector);
	if (llmCalls.length === 0) {
		return false;
	}

	const methodId = generateUniqueId(`${methodName}_batch_reconstruct`);

	const originalIndexParam = callback.params[1];
	const indexVar =
		originalIndexParam && t.isIdentifier(originalIndexParam) ? originalIndexParam.name : '__idx';

	// Create batch declarations - one per LLM call (in order of appearance)
	// This ensures each call gets its own result array
	const batchDeclarations: t.Statement[] = [];
	const resultVarByCallIndex = new Map<number, string>();

	for (let i = 0; i < llmCalls.length; i++) {
		const call = llmCalls[i]!;
		const resultsVar = `__batch_results_${i}_${methodId.replace(/[^a-zA-Z0-9]/g, '_')}`;
		resultVarByCallIndex.set(i, resultsVar);

		const payloadMapper = t.arrowFunctionExpression(
			[t.identifier(param)],
			t.objectExpression([
				t.objectProperty(t.identifier('type'), t.stringLiteral(call.callInfo.type)),
				t.objectProperty(
					t.identifier('operation'),
					t.stringLiteral(call.callInfo.operation)
				),
				t.objectProperty(t.identifier('payload'), t.cloneNode(call.payloadNode, true)),
			])
		);

		const batchCall = t.awaitExpression(
			t.callExpression(
				t.memberExpression(t.identifier('__runtime'), t.identifier('batchParallel')),
				[
					t.callExpression(
						t.memberExpression(t.cloneNode(array, true), t.identifier('map')),
						[payloadMapper]
					),
					t.stringLiteral(`${methodId}_${i}`),
				]
			)
		);

		batchDeclarations.push(
			t.variableDeclaration('const', [
				t.variableDeclarator(t.identifier(resultsVar), batchCall),
			])
		);
	}

	// Clone the callback body for reconstruction
	const clonedBody = t.cloneNode(callback.body, true);

	let traversableNode: t.Statement;
	if (t.isBlockStatement(clonedBody)) {
		traversableNode = t.functionDeclaration(t.identifier('__temp'), [], clonedBody);
	} else {
		traversableNode = t.expressionStatement(clonedBody as t.Expression);
	}

	// Replace each await expression with the corresponding result access
	// We match calls by comparing their structure to the original calls
	let replacementCount = 0;

	traverse(t.file(t.program([traversableNode])), {
		AwaitExpression(awaitPath: any) {
			const arg = awaitPath.node.argument;
			if (!t.isCallExpression(arg)) return;

			const info = batchDetector.extractCallInfo(arg);
			if (!info) return;

			const key = `${info.type}:${info.operation}`;

			// Find first unused call with matching key
			let matchedIndex = -1;
			for (let i = 0; i < llmCalls.length; i++) {
				const original = llmCalls[i]!;
				if (original.key === key && resultVarByCallIndex.has(i)) {
					matchedIndex = i;
					break;
				}
			}

			if (matchedIndex === -1) return;

			const resultsVar = resultVarByCallIndex.get(matchedIndex);
			if (!resultsVar) return;
			// Remove from map so we don't reuse it
			resultVarByCallIndex.delete(matchedIndex);

			const resultAccess = t.memberExpression(
				t.identifier(resultsVar),
				t.identifier(indexVar),
				true
			);

			awaitPath.replaceWith(resultAccess);
			replacementCount++;
		},
		noScope: true,
	});

	if (replacementCount === 0) {
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

	const reconstructCall = t.callExpression(
		t.memberExpression(t.cloneNode(array, true), t.identifier('map')),
		[reconstructMapper]
	);

	// Build the IIFE with all batch declarations followed by reconstruction
	const iife = t.callExpression(
		t.arrowFunctionExpression(
			[],
			t.blockStatement([...batchDeclarations, t.returnStatement(reconstructCall)]),
			true // async
		),
		[]
	);

	const awaitIife = t.awaitExpression(iife);

	path.replaceWith(awaitIife);
	onTransform();
	return true;
}
