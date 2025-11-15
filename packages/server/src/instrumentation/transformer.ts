/**
 * Code Instrumentation Engine
 */
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
// @ts-ignore - CommonJS/ESM compatibility
const traverse =
	typeof (_traverse as any).default === 'function' ? (_traverse as any).default : _traverse;
import _generate from '@babel/generator';
// @ts-ignore - CommonJS/ESM compatibility
const generate = (_generate as any).default || _generate;
import * as t from '@babel/types';
import type { InstrumentedCode, InstrumentationMetadata } from './types.js';

export class CodeInstrumentor {
	private statementId = 0;

	/**
	 * Instrument code with state capture calls
	 */
	instrument(code: string): InstrumentedCode {
		this.statementId = 0;

		let ast;
		try {
			ast = parse(code, {
				sourceType: 'module',
				plugins: ['typescript'],
				allowAwaitOutsideFunction: true,
				allowReturnOutsideFunction: true,
			});
		} catch (parseError) {
			const error = parseError as Error;
			const positionMatch = error.message.match(/\((\d+):(\d+)\)/);
			const position =
				positionMatch && positionMatch[1] && positionMatch[2]
					? { line: parseInt(positionMatch[1], 10), column: parseInt(positionMatch[2], 10) }
					: null;

			throw new SyntaxError(
				`Failed to parse code for instrumentation: ${error.message}${position ? ` at line ${position.line}, column ${position.column}` : ''}`
			);
		}

		const metadata: InstrumentationMetadata = {
			statements: [],
			variables: new Set(),
			functions: [],
		};

		traverse(ast, {
			VariableDeclaration: (path: any) => {
				path.node.declarations.forEach((decl: any) => {
					if (t.isIdentifier(decl.id)) {
						metadata.variables.add(decl.id.name);
					}
				});
			},

			FunctionDeclaration: (path: any) => {
				if (path.node.id) {
					metadata.functions.push({
						name: path.node.id.name,
						line: path.node.loc?.start.line,
					});
				}
			},

			Statement: (path: any) => {
				if (
					t.isFunctionDeclaration(path.node) ||
					t.isClassDeclaration(path.node) ||
					t.isImportDeclaration(path.node) ||
					t.isExportDeclaration(path.node) ||
					path.node.type.includes('Export')
				) {
					return;
				}

				if (t.isBlockStatement(path.parent) && path.key !== 'body') {
					return;
				}

				const id = this.statementId++;

				metadata.statements.push({
					id,
					line: path.node.loc?.start.line,
					type: path.node.type,
				});
			},
		});

		const result = generate(ast, {
			sourceMaps: false,
		});

		return {
			code: result.code,
			metadata,
		};
	}
}
