/**
 * Unit tests for toCommentSafe / toCommentSafeLines — the sanitizers used whenever
 * APIAggregator or generateRuntimeTypes embed descriptions in generated TypeScript comments.
 * See https://github.com/mondaycom/agent-tool-protocol/issues/72
 */
import { describe, it, expect } from '@jest/globals';
import { toCommentSafe, toCommentSafeLines } from '@mondaydotcomorg/atp-runtime';

describe('toCommentSafe', () => {
	it('leaves plain text untouched', () => {
		expect(toCommentSafe('Search files by name')).toBe('Search files by name');
		expect(toCommentSafe('')).toBe('');
	});

	it('leaves harmless comment-like fragments untouched', () => {
		expect(toCommentSafe('a // b')).toBe('a // b');
		expect(toCommentSafe('a /* b')).toBe('a /* b');
		expect(toCommentSafe('5 * 3 / 2')).toBe('5 * 3 / 2');
	});

	it.each([
		['LF', 'a\nb'],
		['CR', 'a\rb'],
		['CRLF (collapsed to a single space)', 'a\r\nb'],
		['U+2028 line separator', 'a\u2028b'],
		['U+2029 paragraph separator', 'a\u2029b'],
	])('replaces %s with a space', (_label, input) => {
		expect(toCommentSafe(input)).toBe('a b');
	});

	it('replaces every line terminator, not just the first', () => {
		expect(toCommentSafe('a\nb\rc\r\nd\u2028e\u2029f')).toBe('a b c d e f');
	});

	it('escapes "*/" so a block comment cannot be closed early', () => {
		expect(toCommentSafe('ends */ here')).toBe('ends *\\/ here');
	});

	it('escapes every "*/" occurrence, including in globs', () => {
		expect(toCommentSafe('src/**/*.ts and lib/**/*.js')).toBe('src/**\\/*.ts and lib/**\\/*.js');
	});

	it('handles "*/" split across a removed line break', () => {
		// "*\n/" becomes "* /" — not a comment terminator, so nothing more to escape
		expect(toCommentSafe('*\n/')).toBe('* /');
	});

	it('never returns a string containing a line terminator or "*/"', () => {
		const nasty = '*/\r\n*/\n\r\u2028*/\u2029**/***//';
		const out = toCommentSafe(nasty);
		expect(out).not.toMatch(/[\r\n\u2028\u2029]/);
		expect(out).not.toContain('*/');
	});

	it('is idempotent', () => {
		const input = 'src/**/*.ts\r\nnext line */';
		expect(toCommentSafe(toCommentSafe(input))).toBe(toCommentSafe(input));
	});
});

describe('toCommentSafeLines', () => {
	it('returns a single line for text without line terminators', () => {
		expect(toCommentSafeLines('just one line')).toEqual(['just one line']);
	});

	it('splits on every line terminator TypeScript recognizes', () => {
		expect(toCommentSafeLines('a\nb\rc\r\nd\u2028e\u2029f')).toEqual([
			'a',
			'b',
			'c',
			'd',
			'e',
			'f',
		]);
	});

	it('treats CRLF as a single break (no empty line in between)', () => {
		expect(toCommentSafeLines('a\r\nb')).toEqual(['a', 'b']);
	});

	it('keeps intentional blank lines', () => {
		expect(toCommentSafeLines('a\n\nb')).toEqual(['a', '', 'b']);
	});

	it('escapes "*/" in every line', () => {
		expect(toCommentSafeLines('x */ y\nsrc/**/*.ts')).toEqual(['x *\\/ y', 'src/**\\/*.ts']);
	});

	it('agrees with toCommentSafe when joined with a space', () => {
		const input = 'one */\r\ntwo\u2028three';
		expect(toCommentSafeLines(input).join(' ')).toBe(toCommentSafe(input));
	});
});
