/**
 * Makes arbitrary text safe to embed in a generated TypeScript comment (`//`, `/* *\/`, or JSDoc).
 * Collapses every line terminator TypeScript recognizes (CRLF, CR, LF, U+2028, U+2029) into a
 * single space so `//` comments cannot spill onto a new line, and escapes `*\/` so block comments
 * cannot be closed early.
 */
export function toCommentSafe(text: string): string {
	return text.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ').replace(/\*\//g, '*\\/');
}
