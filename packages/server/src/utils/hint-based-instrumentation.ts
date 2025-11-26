/**
 * Pre-process code to mark string literals that match provenance hints as tainted
 * This enables cross-execution provenance tracking
 */

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as escodegen from 'escodegen';
import type { ProvenanceMetadata } from '@mondaydotcomorg/atp-provenance';
import { computeDigest } from '@mondaydotcomorg/atp-provenance';
import { log } from '@mondaydotcomorg/atp-runtime';

/**
 * Instrument string literals in code that match hint digests
 * Wraps them in __mark_tainted(value, hintId) calls
 */
export function instrumentLiteralsFromHints(
	code: string,
	hintMetadata: Map<string, ProvenanceMetadata>
): { code: string; taintedCount: number } {
	if (!hintMetadata || hintMetadata.size === 0) {
		return { code, taintedCount: 0 };
	}

	let taintedCount = 0;

	const valueMap = (hintMetadata as any).__valueMap as Map<string, ProvenanceMetadata> | undefined;

	try {
		const isAlreadyWrapped = code.trim().startsWith('(async function');

		const wrappedCode = isAlreadyWrapped ? code : `(async function() {\n${code}\n})`;

		const ast = acorn.parse(wrappedCode, {
			ecmaVersion: 2022,
			sourceType: 'script',
		}) as any;

		walk.simple(ast, {
			Literal(node: any) {
				if (typeof node.value === 'string') {
					let shouldTaint = false;

					const digest = computeDigest(node.value);
					if (digest && hintMetadata.has(digest)) {
						shouldTaint = true;
					}

					if (!shouldTaint && valueMap && valueMap.size > 0) {
						for (const hintValue of valueMap.keys()) {
							if (node.value.includes(hintValue)) {
								shouldTaint = true;
								break;
							}
						}
					}

					if (shouldTaint) {
						const originalValue = node.value;
						const originalRaw = (node as any).raw || JSON.stringify(originalValue);
						(node as any).type = 'CallExpression';
						(node as any).callee = {
							type: 'Identifier',
							name: '__mark_tainted',
						};
						(node as any).arguments = [
							{
								type: 'Literal',
								value: originalValue,
								raw: originalRaw,
							},
						];
						delete (node as any).value;
						delete (node as any).raw;
						taintedCount++;
					}
				}
			},
		});

		let instrumentedCode = escodegen.generate(ast);

		if (!isAlreadyWrapped) {
			const unwrapPrefix = '(async function () {\n';
			const unwrapSuffix = '\n})';
			if (instrumentedCode.startsWith(unwrapPrefix) && instrumentedCode.endsWith(unwrapSuffix)) {
				instrumentedCode = instrumentedCode.slice(unwrapPrefix.length, -unwrapSuffix.length);
			}
		} else {
			if (instrumentedCode.endsWith(');')) {
				instrumentedCode = instrumentedCode.slice(0, -1);
			}
		}

		return { code: instrumentedCode, taintedCount };
	} catch (error) {
		log.error('Failed to instrument literals from hints', { error });
		return { code, taintedCount: 0 };
	}
}
