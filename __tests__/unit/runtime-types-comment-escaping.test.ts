/**
 * Regression tests for generateRuntimeTypes() comment escaping.
 * Same class of bug as https://github.com/mondaycom/agent-tool-protocol/issues/72:
 * runtime API / method / param descriptions are embedded in JSDoc comments and must not
 * be able to break out of them.
 */
import { describe, it, expect } from '@jest/globals';
import ts from 'typescript';
import { GENERATED_METADATA, generateRuntimeTypes } from '@mondaydotcomorg/atp-runtime';
import type { RuntimeAPIMetadata, RuntimeAPIName } from '@mondaydotcomorg/atp-runtime';

function syntaxErrors(code: string): string[] {
	const sf = ts.createSourceFile('runtime.d.ts', code, ts.ScriptTarget.Latest, true);
	const diags = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
	return diags.map((d) => {
		const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
		const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
		return `TS${d.code} line ${line + 1}: ${msg}  >>  ${code.split('\n')[line]}`;
	});
}

function makeMetadata(descriptions: {
	api?: string;
	method?: string;
	param?: string;
}): RuntimeAPIMetadata {
	return {
		name: 'cache',
		description: descriptions.api ?? 'Cache API',
		methods: [
			{
				name: 'get',
				description: descriptions.method ?? 'Gets a value',
				params: [{ name: 'key', type: 'string', description: descriptions.param ?? 'Cache key' }],
				returns: 'Promise<unknown>',
			},
		],
	};
}

function generate(meta: RuntimeAPIMetadata): string {
	return generateRuntimeTypes([meta], { requestedApis: ['cache'] });
}

describe('generateRuntimeTypes comment escaping', () => {
	it('baseline: plain descriptions produce valid TypeScript', () => {
		expect(syntaxErrors(generate(makeMetadata({})))).toEqual([]);
	});

	it.each<[string, 'api' | 'method' | 'param']>([
		['API description', 'api'],
		['method description', 'method'],
		['param description', 'param'],
	])('"*/" in the %s does not terminate the JSDoc block', (_label, field) => {
		const out = generate(makeMetadata({ [field]: 'Keys like src/**/*.ts */ end' }));
		expect(syntaxErrors(out)).toEqual([]);
		expect(out).toContain('src/**\\/*.ts *\\/ end');
	});

	it.each([
		['LF', '\n'],
		['CR', '\r'],
		['CRLF', '\r\n'],
		['U+2028', '\u2028'],
		['U+2029', '\u2029'],
	])('%s line break in method/param descriptions stays inside the JSDoc block', (_label, nl) => {
		// "*/" on the second line proves the break did not escape the comment
		const out = generate(
			makeMetadata({ method: `first${nl}*/ second`, param: `first${nl}*/ second` })
		);
		expect(syntaxErrors(out)).toEqual([]);
	});

	it('keeps multi-line API descriptions as separate JSDoc lines', () => {
		const out = generate(makeMetadata({ api: 'Line one\r\nLine two\u2028Line */ three' }));
		expect(syntaxErrors(out)).toEqual([]);
		expect(out).toContain('   * Line one\n   * Line two\n   * Line *\\/ three\n');
	});

	it('guard: the real built-in runtime metadata produces valid TypeScript', () => {
		const allApis = GENERATED_METADATA.map((api) => api.name as RuntimeAPIName);
		const out = generateRuntimeTypes(GENERATED_METADATA, { requestedApis: allApis });
		expect(out).toContain('declare const atp');
		expect(syntaxErrors(out)).toEqual([]);
	});
});
