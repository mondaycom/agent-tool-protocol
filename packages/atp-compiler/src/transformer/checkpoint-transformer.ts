/**
 * Operation Checkpoint Transformer
 * 
 * Transforms expensive operations (API calls, LLM calls, etc.) to wrap them
 * with checkpoint logic for recovery from failures.
 * 
 * Transforms:
 *   const user = await atp.api.github.getUser({ id: 123 });
 * 
 * Into:
 *   const user = await __checkpoint.wrap(
 *     'op_L15_C8',
 *     async () => atp.api.github.getUser({ id: 123 }),
 *     { type: 'api', namespace: 'atp', group: 'api.github', method: 'getUser', params: { id: 123 } }
 *   );
 */

import * as t from '@babel/types';
import { getMemberExpressionPath } from './utils.js';
import type { OperationType } from '../checkpoint/checkpoint-types.js';

/**
 * Patterns for operations that should be checkpointed
 */
export interface CheckpointablePattern {
	/** Namespace prefix to match (e.g., 'atp.api', 'atp.llm') */
	namespacePrefix: string;
	/** Operation type for metadata */
	operationType: OperationType;
}

/**
 * Default patterns for checkpointable operations
 * 
 */
export const CHECKPOINTABLE_PATTERNS: CheckpointablePattern[] = [
	// Current sandbox namespace (api.*)
	{ namespacePrefix: 'api', operationType: 'api' as OperationType },
	// LLM operations
	{ namespacePrefix: 'llm', operationType: 'llm' as OperationType },
	{ namespacePrefix: 'atp.llm', operationType: 'llm' as OperationType },
	// Embedding operations  
	{ namespacePrefix: 'embedding', operationType: 'embedding' as OperationType },
	{ namespacePrefix: 'atp.embedding', operationType: 'embedding' as OperationType },
	// Client tools
	{ namespacePrefix: 'client', operationType: 'client_tool' as OperationType },
	{ namespacePrefix: 'atp.client', operationType: 'client_tool' as OperationType },
	// Legacy atp.api namespace (for backwards compatibility)
	{ namespacePrefix: 'atp.api', operationType: 'api' as OperationType },
];

/**
 * Result of transforming an operation
 */
export interface CheckpointTransformResult {
	/** Number of operations transformed */
	transformCount: number;
	/** List of checkpoint IDs generated */
	checkpointIds: string[];
}

/**
 * Transformer that wraps expensive operations with checkpoint logic
 */
export class OperationCheckpointTransformer {
	private transformCount = 0;
	private checkpointIds: string[] = [];
	private patterns: CheckpointablePattern[];
	/** Track loop locations that have been checkpointed (to skip individual ops inside) */
	private checkpointedLoopLocations: Set<string> = new Set();
	/** Track Promise.all locations that have been checkpointed (to skip individual ops inside) */
	private checkpointedPromiseAllLocations: Set<string> = new Set();

	constructor(patterns: CheckpointablePattern[] = CHECKPOINTABLE_PATTERNS) {
		this.patterns = patterns;
	}

	/**
	 * Transform a top-level Promise.all to checkpoint its result
	 * Only transforms Promise.all that are NOT nested inside loops or other Promise.all
	 * @returns true if transformation was applied
	 */
	transformTopLevelPromiseAll(path: any): boolean {
		const node = path.node as t.AwaitExpression;

		// Must be awaiting a call expression
		if (!t.isCallExpression(node.argument)) {
			return false;
		}

		const callExpr = node.argument;

		// Must be Promise.all
		if (!this.isPromiseAllCall(callExpr)) {
			return false;
		}

		// Skip if nested inside a loop or another Promise.all
		if (this.isInsideLoopOrPromiseAll(path)) {
			return false;
		}

		// Skip if already wrapped
		if (this.isInsideCheckpointWrapper(path)) {
			return false;
		}

		// Generate checkpoint ID
		const checkpointId = this.generateCheckpointId(node);

		// Find result variable names (e.g., 'results' from 'const results = await Promise.all(...)')
		const resultVariables = this.findPromiseAllResultVariables(path);

		// Find all APIs used within the Promise.all
		const usedAPIs = this.findUsedAPIs(path);

		// Create metadata for Promise.all checkpoint with enhanced context
		const metadata = t.objectExpression([
			t.objectProperty(t.identifier('type'), t.stringLiteral('parallel')),
			t.objectProperty(t.identifier('namespace'), t.stringLiteral('Promise')),
			t.objectProperty(t.identifier('group'), t.stringLiteral('')),
			t.objectProperty(t.identifier('method'), t.stringLiteral('all')),
			t.objectProperty(t.identifier('params'), t.objectExpression([
			t.objectProperty(
				t.identifier('resultVariables'),
				t.arrayExpression(resultVariables.map(v => t.stringLiteral(v)))
			),
			t.objectProperty(
				t.identifier('apis'),
				t.arrayExpression(usedAPIs.map(api => t.stringLiteral(api)))
			),
			])),
			// Add usedVariables at the top level for consistency
			...(resultVariables.length > 0 ? [
				t.objectProperty(
					t.identifier('usedVariables'),
					t.arrayExpression(resultVariables.map(v => t.stringLiteral(v)))
				)
			] : []),
		]);

		// Create the wrapped call
		const wrappedCall = this.createCheckpointWrap(checkpointId, callExpr, metadata);

		// Replace the original await argument
		path.node.argument = wrappedCall;

		// Skip traversing into the newly generated IIFE
		path.skip();

		this.transformCount++;
		this.checkpointIds.push(checkpointId);

		return true;
	}

	/**
	 * Transform a top-level loop to checkpoint its accumulated result
	 * Only transforms loops that are NOT nested inside other loops
	 * Inserts checkpoint AFTER the loop completes
	 * @returns true if transformation was applied
	 */
	transformTopLevelLoop(path: any): boolean {
		const node = path.node;

		// Skip if nested inside another loop
		if (this.isInsideLoop(path)) {
			return false;
		}

		// Check if loop contains any checkpointable operations
		if (!this.loopContainsCheckpointableOps(path)) {
			return false;
		}

		// Find accumulator variables (arrays that are pushed to, objects assigned)
		const accumulators = this.findLoopAccumulators(path);
		if (accumulators.length === 0) {
			return false;
		}

		// Find all APIs used within the loop
		const usedAPIs = this.findUsedAPIs(path);

		// Generate checkpoint ID for the loop
		const checkpointId = this.generateLoopCheckpointId(node);

		// Create metadata with enhanced context
		const metadata = t.objectExpression([
			t.objectProperty(t.identifier('type'), t.stringLiteral('loop')),
			t.objectProperty(t.identifier('namespace'), t.stringLiteral('loop')),
			t.objectProperty(t.identifier('group'), t.stringLiteral('')),
			t.objectProperty(t.identifier('method'), t.stringLiteral('completion')),
			t.objectProperty(t.identifier('params'), t.objectExpression([
			t.objectProperty(
				t.identifier('accumulators'),
				t.arrayExpression(accumulators.map(v => t.stringLiteral(v)))
			),
			t.objectProperty(
				t.identifier('apis'),
				t.arrayExpression(usedAPIs.map(api => t.stringLiteral(api)))
			),
			])),
			// Add usedVariables at the top level for consistency (accumulators are the used variables)
			...(accumulators.length > 0 ? [
				t.objectProperty(
					t.identifier('usedVariables'),
					t.arrayExpression(accumulators.map(v => t.stringLiteral(v)))
				)
			] : []),
		]);

		// Create result object with all accumulators: { var1, var2, ... }
		const resultObj = t.objectExpression(
			accumulators.map(varName =>
				t.objectProperty(
					t.identifier(varName),
					t.identifier(varName),
					false,
					true // shorthand
				)
			)
		);

		// Create checkpoint call: __checkpoint.buffer('loop_id', { accumulators }, metadata)
		const checkpointCall = t.expressionStatement(
			t.callExpression(
				t.memberExpression(
					t.identifier('__checkpoint'),
					t.identifier('buffer')
				),
				[t.stringLiteral(checkpointId), resultObj, metadata]
			)
		);

		// Insert checkpoint call AFTER the loop
		path.insertAfter(checkpointCall);

		// Track this loop's location to skip individual operations inside
		if (node.loc) {
			this.checkpointedLoopLocations.add(`${node.loc.start.line}:${node.loc.start.column}`);
		}

		this.transformCount++;
		this.checkpointIds.push(checkpointId);

		return true;
	}

	/**
	 * Check if path is inside a loop or Promise.all (for Promise.all nesting detection)
	 */
	private isInsideLoopOrPromiseAll(path: any): boolean {
		let current = path.parentPath;

		while (current) {
			// Check for loops
			if (current.isForStatement() ||
				current.isForOfStatement() ||
				current.isForInStatement() ||
				current.isWhileStatement() ||
				current.isDoWhileStatement()) {
				return true;
			}

			// Check for Promise.all (including __runtime.resumablePromiseAll)
			if (current.isCallExpression()) {
				const callee = current.node.callee;
				
				// Direct Promise.all
				if (t.isMemberExpression(callee) &&
					t.isIdentifier(callee.object) &&
					callee.object.name === 'Promise' &&
					t.isIdentifier(callee.property) &&
					callee.property.name === 'all') {
					return true;
				}

				// __runtime.resumablePromiseAll
				if (t.isMemberExpression(callee) &&
					t.isIdentifier(callee.object) &&
					callee.object.name === '__runtime' &&
					t.isIdentifier(callee.property) &&
					callee.property.name === 'resumablePromiseAll') {
					return true;
				}
			}

			// Check for map/forEach callbacks (common Promise.all pattern)
			if (current.isArrowFunctionExpression() || current.isFunctionExpression()) {
				const parent = current.parentPath;
				if (parent?.isCallExpression()) {
					const callee = parent.node.callee;
					if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
						const method = callee.property.name;
						if (['map', 'forEach', 'filter', 'reduce', 'flatMap'].includes(method)) {
							return true;
						}
					}
				}
			}

			current = current.parentPath;
		}

		return false;
	}

	/**
	 * Check if path is inside a loop that has been checkpointed
	 */
	private isInsideCheckpointedLoop(path: any): boolean {
		let current = path.parentPath;

		while (current) {
			if (current.isForStatement() ||
				current.isForOfStatement() ||
				current.isForInStatement() ||
				current.isWhileStatement() ||
				current.isDoWhileStatement()) {
				// Check if this loop has been checkpointed
				const loopNode = current.node;
				if (loopNode.loc) {
					const locKey = `${loopNode.loc.start.line}:${loopNode.loc.start.column}`;
					if (this.checkpointedLoopLocations.has(locKey)) {
						return true;
					}
				}
			}

			current = current.parentPath;
		}

		return false;
	}

	/**
	 * Check if path is inside a loop (for loop nesting detection)
	 */
	private isInsideLoop(path: any): boolean {
		let current = path.parentPath;

		while (current) {
			if (current.isForStatement() ||
				current.isForOfStatement() ||
				current.isForInStatement() ||
				current.isWhileStatement() ||
				current.isDoWhileStatement()) {
				return true;
			}

			// Also check for __runtime.resumableForLoop etc
			if (current.isCallExpression()) {
				const callee = current.node.callee;
				if (t.isMemberExpression(callee) &&
					t.isIdentifier(callee.object) &&
					callee.object.name === '__runtime' &&
					t.isIdentifier(callee.property)) {
					const method = callee.property.name;
					if (method.startsWith('resumableFor') || method.startsWith('resumableWhile')) {
						return true;
					}
				}
			}

			current = current.parentPath;
		}

		return false;
	}

	/**
	 * Check if a loop contains checkpointable operations
	 * This includes direct API/LLM calls AND Promise.all containing such calls
	 */
	private loopContainsCheckpointableOps(path: any): boolean {
		let hasCheckpointable = false;

		path.traverse({
			AwaitExpression: (innerPath: any) => {
				const node = innerPath.node as t.AwaitExpression;
				if (!t.isCallExpression(node.argument)) return;

				const callExpr = node.argument;
				
				// Check for direct checkpointable call (api.*, llm.*, etc.)
				if (t.isMemberExpression(callExpr.callee)) {
					const fullPath = getMemberExpressionPath(callExpr.callee);
					if (this.findMatchingPattern(fullPath)) {
						hasCheckpointable = true;
						innerPath.stop();
						return;
					}
				}

				// Check for Promise.all (which likely contains checkpointable operations)
				if (this.isPromiseAllCall(callExpr)) {
					hasCheckpointable = true;
					innerPath.stop();
				}
			}
		});

		return hasCheckpointable;
	}

	/**
	 * Find accumulator variables in a loop
	 * These are arrays that are pushed to or variables that are assigned
	 */
	private findLoopAccumulators(path: any): string[] {
		const accumulators = new Set<string>();
		const loopStart = path.node.start;

		path.traverse({
			// Detect array.push(), array.unshift(), etc.
			CallExpression: (innerPath: any) => {
				const callee = innerPath.node.callee;
				if (t.isMemberExpression(callee) &&
					t.isIdentifier(callee.object) &&
					t.isIdentifier(callee.property)) {
					const varName = callee.object.name;
					const method = callee.property.name;
					if (['push', 'unshift', 'splice'].includes(method)) {
						// Verify this variable is declared before the loop
						const binding = path.scope.getBinding(varName);
						if (binding?.path?.node?.start && binding.path.node.start < loopStart) {
							accumulators.add(varName);
						}
					}
				}
			},
			// Detect direct assignments like cursor = ...
			AssignmentExpression: (innerPath: any) => {
				const left = innerPath.node.left;
				if (t.isIdentifier(left)) {
					const varName = left.name;
					// Only track if declared before loop
					const binding = path.scope.getBinding(varName);
					if (binding?.path?.node?.start && binding.path.node.start < loopStart) {
						accumulators.add(varName);
					}
				}
				// Detect object property assignments like obj[key] = ... or obj.prop = ...
				else if (t.isMemberExpression(left)) {
					// Extract the base object (e.g., 'massive' from 'massive[key]' or 'obj' from 'obj.prop')
					let baseObject = left.object;
					// Handle nested member expressions like obj.nested[key]
					while (t.isMemberExpression(baseObject)) {
						baseObject = baseObject.object;
					}
					if (t.isIdentifier(baseObject)) {
						const varName = baseObject.name;
						// Only track if declared before loop
						const binding = path.scope.getBinding(varName);
						if (binding?.path?.node?.start && binding.path.node.start < loopStart) {
							accumulators.add(varName);
						}
					}
				}
			}
		});

		return Array.from(accumulators);
	}

	/**
	 * Check if call expression is Promise.all
	 */
	private isPromiseAllCall(callExpr: t.CallExpression): boolean {
		const callee = callExpr.callee;

		// Direct Promise.all
		if (t.isMemberExpression(callee) &&
			t.isIdentifier(callee.object) &&
			callee.object.name === 'Promise' &&
			t.isIdentifier(callee.property) &&
			callee.property.name === 'all') {
			return true;
		}

		return false;
	}

	/**
	 * Find the variable names that a Promise.all result is assigned to
	 * Handles both regular assignment and destructuring:
	 *   const results = await Promise.all(...) -> ['results']
	 *   const [a, b] = await Promise.all(...) -> ['a', 'b']
	 */
	private findPromiseAllResultVariables(path: any): string[] {
		return this.findResultVariables(path);
	}

	/**
	 * Find the variable names that an await expression result is assigned to
	 * Handles both regular assignment and destructuring:
	 *   const result = await api.call(...) -> ['result']
	 *   const [a, b] = await Promise.all(...) -> ['a', 'b']
	 *   const { data, error } = await api.call(...) -> ['data', 'error']
	 */
	private findResultVariables(path: any): string[] {
		const variables: string[] = [];

		// The path is an AwaitExpression. Check if it's part of a variable declaration
		let parent = path.parentPath;

		// Skip through expression wrappers
		while (parent && (parent.isExpressionStatement() || parent.isSequenceExpression())) {
			parent = parent.parentPath;
		}

		// Check for variable declarator: const x = await ...
		if (parent?.isVariableDeclarator()) {
			const id = parent.node.id;
			
			// Simple identifier: const results = ...
			if (t.isIdentifier(id)) {
				variables.push(id.name);
			}
			// Array destructuring: const [a, b] = ...
			else if (t.isArrayPattern(id)) {
				for (const element of id.elements) {
					if (t.isIdentifier(element)) {
						variables.push(element.name);
					}
				}
			}
			// Object destructuring: const { data, errors } = ...
			else if (t.isObjectPattern(id)) {
				for (const prop of id.properties) {
					if (t.isObjectProperty(prop) && t.isIdentifier(prop.value)) {
						variables.push(prop.value.name);
					}
				}
			}
		}

		return variables;
	}

	/**
	 * Find all API calls used within a loop or Promise.all
	 * Returns array of API paths like ['api.slack.conversations_list', 'api.slack.users_info']
	 */
	private findUsedAPIs(path: any): string[] {
		const apis = new Set<string>();

		path.traverse({
			CallExpression: (innerPath: any) => {
				const callee = innerPath.node.callee;
				
				// Check if it's a member expression call
				if (t.isMemberExpression(callee)) {
					const fullPath = getMemberExpressionPath(callee);
					
					// Check if it matches any checkpointable pattern
					if (this.findMatchingPattern(fullPath)) {
						apis.add(fullPath);
					}
				}
			}
		});

		return Array.from(apis);
	}

	/**
	 * Generate checkpoint ID for loops
	 */
	private generateLoopCheckpointId(node: t.Node): string {
		if (node.loc) {
			return `loop_L${node.loc.start.line}_C${node.loc.start.column}`;
		}
		return `loop_${this.transformCount}`;
	}

	/**
	 * Transform an await expression if it's a checkpointable operation
	 * Skips operations inside top-level loops/Promise.all that are already checkpointed
	 * @returns true if transformation was applied
	 */
	transformAwaitExpression(path: any): boolean {
		const node = path.node as t.AwaitExpression;

		// Must be awaiting a call expression
		if (!t.isCallExpression(node.argument)) {
			return false;
		}

		const callExpr = node.argument;

		// Check if we're inside a checkpoint wrapper (already transformed code on resume)
		// This prevents nesting when code is re-transformed
		if (this.isInsideCheckpointWrapper(path)) {
			return false;
		}

		// Skip if we're inside a loop that has been checkpointed
		// (top-level loops with checkpointable ops already have a loop checkpoint)
		if (this.isInsideCheckpointedLoop(path)) {
			return false;
		}

		// Must be a member expression (e.g., atp.api.github.getUser)
		if (!t.isMemberExpression(callExpr.callee)) {
			return false;
		}

		// Get the full path (e.g., "atp.api.github.getUser")
		const fullPath = getMemberExpressionPath(callExpr.callee);

		// Skip internal checkpoint calls to prevent infinite recursion
		if (fullPath.startsWith('__checkpoint.') || fullPath.startsWith('__restore.')) {
			return false;
		}

		// Check if it matches any checkpointable pattern
		const matchedPattern = this.findMatchingPattern(fullPath);
		if (!matchedPattern) {
			return false;
		}

		// Generate checkpoint ID based on location
		const checkpointId = this.generateCheckpointId(node);

		// Find result variable names
		const usedVariables = this.findResultVariables(path);

		// Extract metadata from the call
		const metadata = this.extractMetadata(fullPath, callExpr, matchedPattern, usedVariables);

		// Create the wrapped call
		const wrappedCall = this.createCheckpointWrap(
			checkpointId,
			callExpr,
			metadata
		);

		// Replace the original await argument with the wrapped call
		path.node.argument = wrappedCall;

		// Skip traversing into the newly generated IIFE to prevent infinite recursion
		path.skip();

		this.transformCount++;
		this.checkpointIds.push(checkpointId);

		return true;
	}

	/**
	 * Find matching checkpointable pattern for a path
	 */
	private findMatchingPattern(fullPath: string): CheckpointablePattern | null {
		for (const pattern of this.patterns) {
			if (fullPath.startsWith(pattern.namespacePrefix + '.')) {
				return pattern;
			}
		}
		return null;
	}

	/**
	 * Generate a deterministic checkpoint ID based on AST location
	 */
	private generateCheckpointId(node: t.Node): string {
		if (node.loc) {
			return `op_L${node.loc.start.line}_C${node.loc.start.column}`;
		}
		// Fallback to counter if no location info
		return `op_${this.transformCount}`;
	}

	/**
	 * Extract operation metadata from the call expression
	 */
	private extractMetadata(
		fullPath: string,
		callExpr: t.CallExpression,
		pattern: CheckpointablePattern,
		usedVariables?: string[]
	): t.ObjectExpression {
		// Parse the path: "atp.api.github.getUser" -> namespace: "atp", group: "api.github", method: "getUser"
		const parts = fullPath.split('.');
		const namespace = parts[0] || 'atp'; // "atp"
		const method = parts[parts.length - 1] || 'unknown'; // "getUser"

		// Group is everything between namespace and method
		// For "atp.api.github.getUser" -> group = "api.github"
		const groupParts = parts.slice(1, -1);
		const group = groupParts.join('.');

		// Extract params from arguments
		const paramsNode = this.extractParams(callExpr.arguments);

		const properties = [
			t.objectProperty(
				t.identifier('type'),
				t.stringLiteral(pattern.operationType)
			),
			t.objectProperty(
				t.identifier('namespace'),
				t.stringLiteral(namespace)
			),
			t.objectProperty(
				t.identifier('group'),
				t.stringLiteral(group)
			),
			t.objectProperty(
				t.identifier('method'),
				t.stringLiteral(method)
			),
			t.objectProperty(
				t.identifier('params'),
				paramsNode
			),
		];

		// Add usedVariables if available
		if (usedVariables && usedVariables.length > 0) {
			properties.push(
				t.objectProperty(
					t.identifier('usedVariables'),
					t.arrayExpression(usedVariables.map(v => t.stringLiteral(v)))
				)
			);
		}

		return t.objectExpression(properties);
	}

	/**
	 * Extract params from call arguments
	 * If it's a simple object, clone it. Otherwise, use empty object.
	 */
	private extractParams(args: (t.Expression | t.SpreadElement | t.ArgumentPlaceholder)[]): t.Expression {
		if (args.length === 0) {
			return t.objectExpression([]);
		}

		const firstArg = args[0];
		if (!firstArg) {
			return t.objectExpression([]);
		}

		// If it's an object expression, clone it
		if (t.isObjectExpression(firstArg)) {
			return t.cloneNode(firstArg, true) as t.ObjectExpression;
		}

		// For non-object arguments, wrap in an object with 'arg' key
		if (t.isExpression(firstArg)) {
			return t.objectExpression([
				t.objectProperty(t.identifier('arg'), t.cloneNode(firstArg, true) as t.Expression),
			]);
		}

		return t.objectExpression([]);
	}

	/**
	 * Create an IIFE that buffers checkpoint after execution (no auto-restore)
	 * This avoids passing functions across the isolated-vm boundary
	 * 
	 * Generates:
	 *   (async () => {
	 *     const __result = await originalCall;
	 *     __checkpoint.buffer('id', __result, metadata);
	 *     return __result;
	 *   })()
	 * 
	 * Note: Checkpoints are buffered in memory (synchronously), not persisted immediately.
	 * They are only persisted to cache when an error occurs (via flush()).
	 * Auto-restore was removed to avoid conflicts with the LLM pause/resume mechanism.
	 */
	private createCheckpointWrap(
		checkpointId: string,
		originalCall: t.CallExpression,
		metadata: t.ObjectExpression
	): t.CallExpression {
		// Create unique variable name to avoid conflicts
		const resultVar = t.identifier('__result_' + this.transformCount);

		// const __result = await originalCall;
		const resultDecl = t.variableDeclaration('const', [
			t.variableDeclarator(resultVar, t.awaitExpression(originalCall)),
		]);

		// __checkpoint.buffer('id', __result, metadata)
		// Note: This is synchronous - just buffers in memory, doesn't persist to cache
		const bufferCall = t.expressionStatement(
			t.callExpression(
				t.memberExpression(
					t.identifier('__checkpoint'),
					t.identifier('buffer')
				),
				[t.stringLiteral(checkpointId), resultVar, metadata]
			)
		);

		// return __result;
		const returnResult = t.returnStatement(resultVar);

		// Create the async IIFE body
		const body = t.blockStatement([
			resultDecl,
			bufferCall,
			returnResult,
		]);

		// async () => { ... }
		const asyncArrowFn = t.arrowFunctionExpression([], body, true);

		// (async () => { ... })()
		return t.callExpression(asyncArrowFn, []);
	}

	/**
	 * Check if this path is inside a checkpoint wrapper IIFE
	 * This prevents nested transformations when already-transformed code is re-processed
	 */
	private isInsideCheckpointWrapper(path: any): boolean {
		let current = path.parentPath;
		
		while (current) {
			// Check if we're inside an arrow function
			if (current.isArrowFunctionExpression()) {
				const arrowFn = current.node;
				
				// Check if this arrow function is immediately invoked (IIFE pattern)
				if (current.parentPath?.isCallExpression()) {
					const callExpr = current.parentPath.node;
					
					// Check if the arrow function body has our checkpoint pattern
					if (t.isBlockStatement(arrowFn.body) && arrowFn.body.body.length > 0) {
						const firstStmt = arrowFn.body.body[0];
						
						// Check for const __result_N = ... pattern
						if (t.isVariableDeclaration(firstStmt)) {
							const firstDecl = firstStmt.declarations[0];
							if (firstDecl && t.isIdentifier(firstDecl.id)) {
								if (firstDecl.id.name.startsWith('__result_') || 
									firstDecl.id.name.startsWith('__cached_')) {
									return true;
								}
							}
						}
					}
				}
			}
			
			current = current.parentPath;
		}
		
		return false;
	}

	/**
	 * Check if an await expression is a checkpointable operation
	 */
	isCheckpointable(node: t.AwaitExpression): boolean {
		if (!t.isCallExpression(node.argument)) {
			return false;
		}

		const callExpr = node.argument;
		if (!t.isMemberExpression(callExpr.callee)) {
			return false;
		}

		const fullPath = getMemberExpressionPath(callExpr.callee);
		return this.findMatchingPattern(fullPath) !== null;
	}

	/**
	 * Get the number of transformations applied
	 */
	getTransformCount(): number {
		return this.transformCount;
	}

	/**
	 * Get the list of checkpoint IDs generated
	 */
	getCheckpointIds(): string[] {
		return [...this.checkpointIds];
	}

	/**
	 * Reset transformer state
	 */
	reset(): void {
		this.transformCount = 0;
		this.checkpointIds = [];
		this.checkpointedLoopLocations.clear();
		this.checkpointedPromiseAllLocations.clear();
	}

	/**
	 * Get transformation result
	 */
	getResult(): CheckpointTransformResult {
		return {
			transformCount: this.transformCount,
			checkpointIds: [...this.checkpointIds],
		};
	}
}

/**
 * Utility: Check if a full path matches checkpointable patterns
 */
export function isCheckpointableCall(fullPath: string, patterns = CHECKPOINTABLE_PATTERNS): boolean {
	return patterns.some((p) => fullPath.startsWith(p.namespacePrefix + '.'));
}

/**
 * Utility: Get operation type for a path
 */
export function getOperationType(fullPath: string, patterns = CHECKPOINTABLE_PATTERNS): OperationType | null {
	for (const pattern of patterns) {
		if (fullPath.startsWith(pattern.namespacePrefix + '.')) {
			return pattern.operationType;
		}
	}
	return null;
}

