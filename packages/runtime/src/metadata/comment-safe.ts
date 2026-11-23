/**
 * Helpers for embedding arbitrary text (e.g. API/property descriptions) in generated
 * TypeScript comments (`//`, `/* *\/`, or JSDoc) without breaking out of the comment.
 * See https://github.com/mondaycom/agent-tool-protocol/issues/72
 */

/** Every line terminator TypeScript recognizes: CRLF, CR, LF, U+2028, U+2029. */
const LINE_TERMINATOR = /\r\n|[\r\n\u2028\u2029]/;

/**
 * Splits text into comment-safe lines: splits on every line terminator TypeScript
 * recognizes and escapes `*\/` in each line so a block comment cannot be closed early.
 * Use when the output can span multiple comment lines (e.g. one ` * ` line each in JSDoc).
 */
export function toCommentSafeLines(text: string): string[] {
	return text.split(LINE_TERMINATOR).map((line) => line.replace(/\*\//g, '*\\/'));
}

/**
 * Makes text safe to embed in a single-line comment: line terminators collapse to a
 * single space (so `//` comments cannot spill onto a new line) and `*\/` is escaped.
 */
export function toCommentSafe(text: string): string {
	return toCommentSafeLines(text).join(' ');
}
