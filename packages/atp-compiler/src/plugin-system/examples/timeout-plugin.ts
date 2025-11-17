/**
 * Example Plugin: Async Timeout Wrapper
 * 
 * Automatically wraps await expressions with timeout protection
 * 
 * @example
 * // Before:
 * const result = await fetch('https://api.example.com');
 * 
 * // After:
 * const result = await Promise.race([
 *   fetch('https://api.example.com'),
 *   new Promise((_, reject) => 
 *     setTimeout(() => reject(new Error('Timeout')), 5000)
 *   )
 * ]);
 */

import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import type { TransformationPlugin, BabelVisitor } from '../plugin-api.js';
import type { CompilerConfig, TransformMetadata } from '../../types.js';

export interface TimeoutPluginOptions {
	/**
	 * Default timeout in milliseconds
	 */
	timeout?: number;

	/**
	 * Patterns to match (namespace.method)
	 */
	patterns?: string[];

	/**
	 * Whether to add timeout to all await expressions
	 */
	wrapAll?: boolean;
}

export class AsyncTimeoutPlugin implements TransformationPlugin {
	name = 'async-timeout';
	version = '1.0.0';
	priority = 40; // Run after main transformations

	private options: TimeoutPluginOptions;
	private transformCount = 0;

	constructor(options: TimeoutPluginOptions = {}) {
		this.options = {
			timeout: options.timeout || 5000,
			patterns: options.patterns || ['fetch', 'axios.*', 'http.*'],
			wrapAll: options.wrapAll || false,
		};
	}

	getVisitor(config: CompilerConfig): BabelVisitor {
		return {
			AwaitExpression: (path: NodePath<t.AwaitExpression>) => {
				// Check if should wrap this await
				if (!this.shouldWrap(path.node.argument)) {
					return;
				}

				// Create timeout promise
				const timeoutPromise = t.newExpression(
					t.identifier('Promise'),
					[
						t.arrowFunctionExpression(
							[t.identifier('_'), t.identifier('reject')],
							t.blockStatement([
								t.expressionStatement(
									t.callExpression(t.identifier('setTimeout'), [
										t.arrowFunctionExpression(
											[],
											t.callExpression(t.identifier('reject'), [
												t.newExpression(t.identifier('Error'), [
													t.stringLiteral(
														`Timeout after ${this.options.timeout}ms`
													),
												]),
											])
										),
										t.numericLiteral(this.options.timeout!),
									])
								),
							])
						),
					]
				);

				// Wrap in Promise.race
				const raceCall = t.callExpression(
					t.memberExpression(t.identifier('Promise'), t.identifier('race')),
					[t.arrayExpression([path.node.argument, timeoutPromise])]
				);

				// Replace await expression
				path.node.argument = raceCall;
				this.transformCount++;
			},
		};
	}

	getMetadata(): Partial<TransformMetadata> {
		return {
			// Custom metadata
			loopCount: 0,
			arrayMethodCount: 0,
			parallelCallCount: this.transformCount,
			batchableCount: 0,
		};
	}

	reset(): void {
		this.transformCount = 0;
	}

	/**
	 * Check if this await should be wrapped with timeout
	 */
	private shouldWrap(node: t.Expression): boolean {
		if (this.options.wrapAll) {
			return true;
		}

		// Check if matches patterns
		if (t.isCallExpression(node)) {
			const funcName = this.getFunctionName(node);
			if (funcName) {
				return this.options.patterns!.some((pattern) => {
					const regex = new RegExp(pattern.replace('*', '.*'));
					return regex.test(funcName);
				});
			}
		}

		return false;
	}

	/**
	 * Get function name from call expression
	 */
	private getFunctionName(node: t.CallExpression): string | null {
		if (t.isIdentifier(node.callee)) {
			return node.callee.name;
		}

		if (t.isMemberExpression(node.callee)) {
			const obj = t.isIdentifier(node.callee.object) ? node.callee.object.name : '';
			const prop = t.isIdentifier(node.callee.property) ? node.callee.property.name : '';
			return `${obj}.${prop}`;
		}

		return null;
	}
}

