/**
 * Example Plugin: Security Validator
 *
 * Validates code for security issues before transformation
 *
 * @example
 * const compiler = new PluggableCompiler();
 * compiler.use(new SecurityValidatorPlugin({
 *   forbiddenPatterns: [/eval\s*\(/],
 *   maxComplexity: 20
 * }));
 */

import type * as t from '@babel/types';
import _traverse from '@babel/traverse';
const traverse = (_traverse as any).default || _traverse;
import type { ValidatorPlugin } from '../plugin-api.js';
import type { CompilerConfig } from '../../types.js';

export interface SecurityValidatorOptions {
	/**
	 * Forbidden patterns (regex)
	 */
	forbiddenPatterns?: RegExp[];

	/**
	 * Maximum cyclomatic complexity
	 */
	maxComplexity?: number;

	/**
	 * Maximum nesting depth
	 */
	maxNesting?: number;

	/**
	 * Forbidden global access
	 */
	forbiddenGlobals?: string[];
}

export class SecurityValidatorPlugin implements ValidatorPlugin {
	name = 'security-validator';
	version = '1.0.0';
	priority = 100; // Run first

	private options: SecurityValidatorOptions;

	constructor(options: SecurityValidatorOptions = {}) {
		this.options = {
			forbiddenPatterns: options.forbiddenPatterns || [
				/\beval\s*\(/,
				/new\s+Function\s*\(/,
				/constructor\s*\[\s*['"`]constructor['"`]\s*\]/,
			],
			maxComplexity: options.maxComplexity || 50,
			maxNesting: options.maxNesting || 10,
			forbiddenGlobals: options.forbiddenGlobals || [
				'process',
				'require',
				'__dirname',
				'__filename',
			],
		};
	}

	async validate(code: string, ast: t.File, phase: 'pre' | 'post'): Promise<void> {
		// Only validate before transformation
		if (phase === 'post') {
			return;
		}

		// 1. Check forbidden patterns
		for (const pattern of this.options.forbiddenPatterns!) {
			if (pattern.test(code)) {
				throw new SecurityValidationError(
					`Forbidden pattern detected: ${pattern}`,
					'forbidden-pattern'
				);
			}
		}

		// 2. Check complexity and nesting
		let maxNestingFound = 0;
		let complexityScore = 0;

		traverse(ast, {
			enter(path: any) {
				const depth = path.scope.path.node ? getDepth(path) : 0;
				maxNestingFound = Math.max(maxNestingFound, depth);

				// Increment complexity for control flow
				if (
					path.isIfStatement() ||
					path.isWhileStatement() ||
					path.isForStatement() ||
					path.isForOfStatement() ||
					path.isSwitchCase() ||
					path.isCatchClause()
				) {
					complexityScore++;
				}
			},

			// 3. Check forbidden globals
			Identifier: (path: any) => {
				if (
					this.options.forbiddenGlobals!.includes(path.node.name) &&
					!path.scope.hasBinding(path.node.name)
				) {
					throw new SecurityValidationError(
						`Access to forbidden global: ${path.node.name}`,
						'forbidden-global'
					);
				}
			},
		});

		if (maxNestingFound > this.options.maxNesting!) {
			throw new SecurityValidationError(
				`Maximum nesting depth exceeded: ${maxNestingFound} > ${this.options.maxNesting}`,
				'max-nesting'
			);
		}

		if (complexityScore > this.options.maxComplexity!) {
			throw new SecurityValidationError(
				`Maximum complexity exceeded: ${complexityScore} > ${this.options.maxComplexity}`,
				'max-complexity'
			);
		}
	}
}

/**
 * Security validation error
 */
export class SecurityValidationError extends Error {
	constructor(
		message: string,
		public code: string
	) {
		super(message);
		this.name = 'SecurityValidationError';
	}
}

/**
 * Get nesting depth of a path
 */
function getDepth(path: any): number {
	let depth = 0;
	let current = path;

	while (current.parentPath) {
		if (
			current.isBlockStatement() ||
			current.isFunctionDeclaration() ||
			current.isArrowFunctionExpression()
		) {
			depth++;
		}
		current = current.parentPath;
	}

	return depth;
}
