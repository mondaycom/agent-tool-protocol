/**
 * Regression tests for https://github.com/mondaycom/agent-tool-protocol/issues/72
 *
 * APIAggregator interpolates user-supplied descriptions into TypeScript comments.
 * A newline inside a `//` comment, or a `*\/` inside a block comment, breaks out of
 * the comment and produces invalid TypeScript for consumers of /api/definitions.
 *
 * Detection strategy: parse the generated output with the TypeScript compiler and
 * assert there are zero syntactic diagnostics.
 */
import { describe, it, expect } from '@jest/globals';
import ts from 'typescript';
import fc from 'fast-check';
import { APIAggregator } from '../../packages/server/src/aggregator/index';
import type { APIGroupConfig, CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';

function syntaxErrors(code: string): string[] {
	const sf = ts.createSourceFile('generated.d.ts', code, ts.ScriptTarget.Latest, true);
	const diags = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
	return diags.map((d) => {
		const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
		const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
		return `TS${d.code} line ${line + 1}: ${msg}  >>  ${code.split('\n')[line]}`;
	});
}

function makeFunc(overrides: Partial<CustomFunctionDef> = {}): CustomFunctionDef {
	return {
		name: 'search',
		description: 'Search files',
		inputSchema: {
			type: 'object',
			required: ['pattern'],
			properties: {
				pattern: { type: 'string', description: 'Glob pattern' },
			},
		},
		outputSchema: { type: 'array' },
		handler: async () => [],
		...overrides,
	} as CustomFunctionDef;
}

function makeAggregator(func: CustomFunctionDef): APIAggregator {
	const group: APIGroupConfig = { name: 'files', type: 'custom', functions: [func] };
	return new APIAggregator([group]);
}

/** Turns the compact `async function api.x.y(...)` signature into a parseable declaration. */
function compactAsDeclaration(compact: string): string {
	// The compact form puts a bare type literal in parameter position; name it so it parses as a type.
	return compact.replace(/^async function [^(]+\(/, 'declare function f(params: ') + ';\n';
}

describe('APIAggregator comment escaping (issue #72)', () => {
	describe('generateTypeScript', () => {
		it('baseline: plain descriptions produce valid TypeScript', async () => {
			const out = await makeAggregator(makeFunc()).generateTypeScript();
			expect(syntaxErrors(out)).toEqual([]);
		});

		it('exact repro from issue: multi-line property description + "*/" in function description', async () => {
			const out = await makeAggregator(
				makeFunc({
					description: 'Search files by glob, e.g. src/**/*.ts',
					inputSchema: {
						type: 'object',
						required: ['pattern'],
						properties: {
							pattern: { type: 'string', description: 'Glob pattern.\nExample: src/**/*.ts' },
						},
					},
				})
			).generateTypeScript();
			expect(syntaxErrors(out)).toEqual([]);
			// Description text is preserved (escaped), not dropped
			expect(out).toContain('pattern: string; // Glob pattern. Example: src/**\\/*.ts');
			expect(out).toContain('* Search files by glob, e.g. src/**\\/*.ts');
		});

		it.each([
			['LF', 'Line one\nline two'],
			['CRLF', 'Line one\r\nline two'],
			['CR only', 'Line one\rline two'],
			['U+2028 line separator', 'Line one\u2028line two'],
			['U+2029 paragraph separator', 'Line one\u2029line two'],
		])(
			'property description with %s newline stays inside the // comment',
			async (_label, description) => {
				const out = await makeAggregator(
					makeFunc({
						inputSchema: {
							type: 'object',
							properties: { pattern: { type: 'string', description } },
						},
					})
				).generateTypeScript();
				expect(syntaxErrors(out)).toEqual([]);
			}
		);

		it.each([
			['"*/" in function description', 'Closes early */ oops'],
			['glob in function description', 'Matches src/**/*.ts files'],
			['CR in function description', 'First\rsecond */ third'],
		])('%s does not terminate the JSDoc block', async (_label, description) => {
			const out = await makeAggregator(makeFunc({ description })).generateTypeScript();
			expect(syntaxErrors(out)).toEqual([]);
		});
	});

	describe('generateCompactFunctionDefinition', () => {
		it('baseline: plain descriptions produce a parseable signature', () => {
			const agg = makeAggregator(makeFunc());
			const out = agg.generateCompactFunctionDefinition(makeFunc(), 'files');
			expect(syntaxErrors(compactAsDeclaration(out))).toEqual([]);
		});

		it('"*/" in an input property description does not escape the inline comment', () => {
			const func = makeFunc({
				inputSchema: {
					type: 'object',
					properties: { pattern: { type: 'string', description: 'e.g. src/**/*.ts' } },
				},
			});
			const out = makeAggregator(func).generateCompactFunctionDefinition(func, 'files');
			expect(syntaxErrors(compactAsDeclaration(out))).toEqual([]);
		});

		it('"*/" in an output property description does not escape the inline comment', () => {
			const func = makeFunc({
				outputSchema: {
					type: 'object',
					properties: { path: { type: 'string', description: 'Matched path like src/**/*.ts' } },
				},
			});
			const out = makeAggregator(func).generateCompactFunctionDefinition(func, 'files');
			expect(syntaxErrors(compactAsDeclaration(out))).toEqual([]);
		});
	});

	describe('property-based: arbitrary descriptions always yield valid TypeScript', () => {
		// Bias generation toward comment-breaking fragments, mixed with arbitrary unicode.
		const dangerous = fc.constantFrom(
			'*/',
			'/*',
			'/**',
			'//',
			'*',
			'/',
			'**/',
			'\n',
			'\r',
			'\r\n',
			'\u2028',
			'\u2029',
			'`',
			'${',
			'"',
			"'"
		);
		const description = fc
			.array(fc.oneof(dangerous, fc.fullUnicode(), fc.string()), { maxLength: 40 })
			.map((parts) => parts.join(''));

		it('generateTypeScript() and the compact signature parse cleanly', async () => {
			await fc.assert(
				fc.asyncProperty(description, description, description, async (fnDesc, inDesc, outDesc) => {
					const func = makeFunc({
						description: fnDesc,
						inputSchema: {
							type: 'object',
							required: ['req'],
							properties: {
								req: { type: 'string', description: inDesc },
								opt: { type: 'number', description: inDesc },
							},
						},
						outputSchema: {
							type: 'object',
							properties: { path: { type: 'string', description: outDesc } },
						},
					});
					const agg = makeAggregator(func);
					expect(syntaxErrors(await agg.generateTypeScript())).toEqual([]);
					expect(
						syntaxErrors(compactAsDeclaration(agg.generateCompactFunctionDefinition(func, 'files')))
					).toEqual([]);
				}),
				{ numRuns: 300 }
			);
		});
	});
});
