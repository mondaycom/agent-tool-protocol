/**
 * Pre-dispatch static analysis of ATP agent code.
 *
 * Extracts every `api.<group>.<op>(...)` call chain from submitted code
 * and flags patterns that defeat static analysis (dynamic dispatch,
 * aliasing, destructuring).
 *
 * Intended caller: governance layers that need to know WHICH api groups
 * and operations code will touch BEFORE dispatching it to the sandbox.
 * Paired with runtime `filterApiGroups` enforcement in atp-server for
 * defense-in-depth; the static pass catches unauthorized references
 * up-front without paying sandbox startup cost.
 *
 * @example
 *   const { apiCalls, dynamicCallsDetected } = analyzeApiCalls(code);
 *   for (const call of apiCalls) {
 *     // check (call.apiGroup, call.operationId) against a grant
 *   }
 *   if (dynamicCallsDetected) {
 *     // deny unless the grant explicitly allows dynamic dispatch
 *   }
 */

import { parse } from '@babel/parser';
// @babel/traverse exports default; interop handles the CJS/ESM quirk
// (see https://github.com/babel/babel/issues/13855).
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

const traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ??
	_traverse) as typeof _traverse;

export interface DetectedApiCall {
	apiGroup: string;
	operationId: string;
}

export interface AnalysisResult {
	/** Unique `(apiGroup, operationId)` pairs statically visible in the code. */
	apiCalls: DetectedApiCall[];
	/**
	 * True iff the code contains patterns we cannot statically resolve to a
	 * concrete `(apiGroup, operationId)` — e.g. `api[varName].fn(...)`,
	 * destructuring (`const { calendar } = api`), or aliasing
	 * (`const x = api.calendar`). Governance layers should fail-closed on
	 * this flag unless the caller's policy opts into dynamic dispatch.
	 */
	dynamicCallsDetected: boolean;
}

/**
 * Analyze agent code and return its statically-visible api.* call set plus a
 * dynamic-dispatch flag. Pure function, no I/O, fail-closed on parse errors
 * (returns `{ apiCalls: [], dynamicCallsDetected: true }`).
 */
export function analyzeApiCalls(code: string): AnalysisResult {
	const calls: DetectedApiCall[] = [];
	const seen = new Set<string>();
	let dynamicCallsDetected = false;

	let ast;
	try {
		ast = parse(code, {
			sourceType: 'module',
			allowReturnOutsideFunction: true,
			plugins: ['typescript'],
		});
	} catch {
		// Fail-closed: syntax error → treat as dynamic so governance denies.
		return { apiCalls: [], dynamicCallsDetected: true };
	}

	// Helper records a static api.<group>.<op>(...) call, or flips
	// dynamicCallsDetected when the call expression escapes static resolution.
	const tryRecordCall = (calleeNode: t.Node) => {
		let callee: t.Node = calleeNode;

		// Unwrap one `.call` / `.apply` / `.bind` redirection:
		//   api.calendar.events_list.call(null, {...})
		// has callee = MemberExpression { object: api.calendar.events_list, property: 'call' }
		if (
			(t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
			!callee.computed &&
			t.isIdentifier(callee.property) &&
			(callee.property.name === 'call' ||
				callee.property.name === 'apply' ||
				callee.property.name === 'bind')
		) {
			callee = callee.object;
		}

		if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) return;

		const groupExpr = callee.object;
		if (!t.isMemberExpression(groupExpr) && !t.isOptionalMemberExpression(groupExpr)) return;
		if (!t.isIdentifier(groupExpr.object, { name: 'api' })) return;

		// api[groupVar].op(...) or api.group[fnVar](...) → dynamic
		if (groupExpr.computed || callee.computed) {
			dynamicCallsDetected = true;
			return;
		}

		const groupNode = groupExpr.property;
		const opNode = callee.property;
		if (!t.isIdentifier(groupNode) || !t.isIdentifier(opNode)) {
			dynamicCallsDetected = true;
			return;
		}

		const key = `${groupNode.name}.${opNode.name}`;
		if (!seen.has(key)) {
			seen.add(key);
			calls.push({ apiGroup: groupNode.name, operationId: opNode.name });
		}
	};

	try {
		traverse(ast, {
			// Assignments / destructures that alias `api` or `api.<group>` — any of
			// these lets the code reach an api group via an opaque identifier later.
			VariableDeclarator(path) {
				const init = path.node.init;
				if (!init) return;

				// const { calendar } = api
				if (t.isObjectPattern(path.node.id) && t.isIdentifier(init, { name: 'api' })) {
					dynamicCallsDetected = true;
					return;
				}
				// const x = api
				if (t.isIdentifier(path.node.id) && t.isIdentifier(init, { name: 'api' })) {
					dynamicCallsDetected = true;
					return;
				}
				// const x = api.<group>   OR   const x = api['<group>']
				if (
					t.isIdentifier(path.node.id) &&
					t.isMemberExpression(init) &&
					t.isIdentifier(init.object, { name: 'api' })
				) {
					dynamicCallsDetected = true;
				}
			},

			// Any other mention of `api` that hands it off to an opaque consumer:
			//   fn(api)                      — alias escape via function argument
			//   Object.values(api) / keys(…) — enumeration
			//   { ...api } / [ ...api ]      — spread
			//   return api                   — caller gets the alias
			//   api = x (reassignment)       — later reads hit a different object
			//
			// The api.<group>.<op>(...) pattern is recognised by the CallExpression
			// visitor below; skip it here via parent-shape whitelisting.
			Identifier(path) {
				if (path.node.name !== 'api') return;

				// Skip the PROPERTY position of a member expression — e.g.
				// `this.api`, `window.api`, `someObj.api`. That's not the
				// global `api` binding we care about.
				if (
					(t.isMemberExpression(path.parent) || t.isOptionalMemberExpression(path.parent)) &&
					path.parent.property === path.node &&
					!path.parent.computed
				) {
					return;
				}
				// `api.<group>` (non-computed member) — safe, handled by CallExpression.
				if (
					(t.isMemberExpression(path.parent) || t.isOptionalMemberExpression(path.parent)) &&
					path.parent.object === path.node &&
					!path.parent.computed
				) {
					return;
				}
				// Left-hand side of `const x = api` / `const { calendar } = api`
				// — handled by VariableDeclarator above (dynamic flag set there).
				if (t.isVariableDeclarator(path.parent) && path.parent.init === path.node) {
					return;
				}
				// Skip declaration positions where `api` is a local binding name,
				// not a reference:
				//   { api: value }           — object property key
				//   function f(api) { ... }  — param name
				//   class { api() {...} }    — method name
				//   function api() {}        — function name
				//   class api {}             — class name
				if (
					(t.isObjectProperty(path.parent) || t.isObjectMethod(path.parent)) &&
					path.parent.key === path.node &&
					!path.parent.computed
				) {
					return;
				}
				if (t.isClassMethod(path.parent) && path.parent.key === path.node && !path.parent.computed) {
					return;
				}
				if (
					(t.isFunctionDeclaration(path.parent) ||
						t.isFunctionExpression(path.parent) ||
						t.isClassDeclaration(path.parent) ||
						t.isClassExpression(path.parent)) &&
					path.parent.id === path.node
				) {
					return;
				}
				if (path.parentPath?.isFunction() && path.listKey === 'params') {
					return;
				}
				if (t.isImportSpecifier(path.parent) || t.isImportDefaultSpecifier(path.parent) || t.isImportNamespaceSpecifier(path.parent)) {
					return;
				}

				// Anything else (`Object.values(api)`, `fn(api)`, `{ ...api }`,
				// `return api`, `api = ...`) escapes static resolution.
				dynamicCallsDetected = true;
			},

			CallExpression(path) {
				tryRecordCall(path.node.callee);
			},
			OptionalCallExpression(path) {
				tryRecordCall(path.node.callee);
			},
		});
	} catch {
		// Visitor error → fail-closed (should be unreachable under our plugin set).
		return { apiCalls: [], dynamicCallsDetected: true };
	}

	return { apiCalls: calls, dynamicCallsDetected };
}
