import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as escodegen from 'escodegen';
import crypto from 'crypto';
import type { ProvenanceMetadata, SourceMetadata } from '../types.js';
import { ProvenanceSource } from '../types.js';
import {
	createProvenanceProxy,
	getProvenance,
	getProvenanceForPrimitive,
	markPrimitiveTainted,
} from '../registry.js';

export { getProvenance, getProvenanceForPrimitive };

interface InstrumentationContext {
	nextId: number;
	trackingCalls: number;
}

/**
 * Instrument code to track provenance at AST level
 */
export function instrumentCode(code: string): {
	code: string;
	metadata: { trackingCalls: number };
} {
	// Wrap code in async function for parsing (to allow await and return)
	const wrappedCode = `(async function() {\n${code}\n})`;

	const ast = acorn.parse(wrappedCode, {
		ecmaVersion: 2022,
		sourceType: 'script',
	}) as any;

	const context: InstrumentationContext = {
		nextId: 0,
		trackingCalls: 0,
	};

	walk.simple(ast, {
		BinaryExpression(node: any) {
			wrapBinaryExpression(node, context);
		},
		AssignmentExpression(node: any) {
			wrapAssignment(node, context);
		},
		CallExpression(node: any) {
			if (node.callee.type === 'MemberExpression') {
				wrapMethodCall(node, context);
			}
		},
		TemplateLiteral(node: any) {
			wrapTemplateLiteral(node, context);
		},
	});

	let instrumentedCode = escodegen.generate(ast);

	// escodegen adds a trailing semicolon to expression statements
	// Remove it so the result is a pure function expression that executor can call with ()
	if (instrumentedCode.endsWith(');')) {
		instrumentedCode = instrumentedCode.slice(0, -1); // Remove trailing semicolon
	}

	return {
		code: instrumentedCode,
		metadata: {
			trackingCalls: context.trackingCalls,
		},
	};
}

function wrapBinaryExpression(node: any, context: InstrumentationContext) {
	context.trackingCalls++;

	const originalNode = { ...node };

	node.type = 'CallExpression';
	node.callee = {
		type: 'Identifier',
		name: '__track_binary',
	};
	node.arguments = [
		originalNode.left,
		originalNode.right,
		{
			type: 'Literal',
			value: originalNode.operator,
		},
	];
}

function wrapAssignment(node: any, context: InstrumentationContext) {
	context.trackingCalls++;

	const originalRight = node.right;
	node.right = {
		type: 'CallExpression',
		callee: {
			type: 'Identifier',
			name: '__track_assign',
		},
		arguments: [
			{
				type: 'Literal',
				value: node.left.type === 'Identifier' ? node.left.name : 'unknown',
			},
			originalRight,
		],
	};
}

function wrapMethodCall(node: any, context: InstrumentationContext) {
	const obj = node.callee.object;

	const isAPICall =
		(obj.type === 'Identifier' && (obj.name === 'api' || obj.name === 'atp')) ||
		(obj.type === 'MemberExpression' && isAPIObject(obj));

	if (!isAPICall) {
		return;
	}

	context.trackingCalls++;

	const originalNode = { ...node };

	node.type = 'CallExpression';
	node.callee = {
		type: 'Identifier',
		name: '__track_method',
	};
	node.arguments = [
		originalNode.callee.object,
		{
			type: 'Literal',
			value: originalNode.callee.property.name || originalNode.callee.property.value,
		},
		{
			type: 'ArrayExpression',
			elements: originalNode.arguments,
		},
	];
}

function isAPIObject(node: any): boolean {
	if (node.type === 'Identifier') {
		return node.name === 'api' || node.name === 'atp';
	}
	if (node.type === 'MemberExpression') {
		return isAPIObject(node.object);
	}
	return false;
}

function wrapTemplateLiteral(node: any, context: InstrumentationContext) {
	context.trackingCalls++;

	const originalNode = { ...node };

	node.type = 'CallExpression';
	node.callee = {
		type: 'Identifier',
		name: '__track_template',
	};
	node.arguments = [
		{
			type: 'ArrayExpression',
			elements: originalNode.expressions || [],
		},
		{
			type: 'ArrayExpression',
			elements: (originalNode.quasis || []).map((quasi: any) => ({
				type: 'Literal',
				value: quasi.value.cooked || quasi.value.raw,
			})),
		},
	];
}

/**
 * Runtime tracking functions injected into sandbox
 */
export class ASTProvenanceTracker {
	private metadata: Map<string, ProvenanceMetadata> = new Map();
	private valueToId: WeakMap<object, string> = new WeakMap();
	private nextId = 0;

	private getId(value: unknown): string {
		if (typeof value === 'object' && value !== null) {
			const existing = this.valueToId.get(value as object);
			if (existing) return existing;

			const id = `tracked_${this.nextId++}`;
			this.valueToId.set(value as object, id);
			return id;
		}
		return `primitive_${crypto.randomUUID()}`;
	}

	track(value: unknown, source: SourceMetadata, dependencies: string[] = []): unknown {
		if (value === null || value === undefined) {
			return value;
		}

		const id = this.getId(value);

		if (!this.metadata.has(id)) {
			this.metadata.set(id, {
				id,
				source,
				readers: { type: 'public' },
				dependencies,
			});
		}

		return value;
	}

	trackBinary(left: unknown, right: unknown, operator: string): unknown {
		const leftId = this.getId(left);
		const rightId = this.getId(right);

		const leftProv = getProvenance(left) || getProvenanceForPrimitive(left);
		const rightProv = getProvenance(right) || getProvenanceForPrimitive(right);
		const toolMetadata =
			leftProv?.source.type === ProvenanceSource.TOOL
				? leftProv
				: rightProv?.source.type === ProvenanceSource.TOOL
					? rightProv
					: null;

		let result: unknown;
		switch (operator) {
			case '+':
				result = (left as any) + (right as any);
				if (typeof result === 'string' && toolMetadata) {
					markPrimitiveTainted(result, toolMetadata);
				}
				break;
			case '-':
				result = (left as any) - (right as any);
				break;
			case '*':
				result = (left as any) * (right as any);
				break;
			case '/':
				result = (left as any) / (right as any);
				break;
			case '%':
				result = (left as any) % (right as any);
				break;
			case '===':
			case '==':
				result = left === right;
				break;
			case '!==':
			case '!=':
				result = left !== right;
				break;
			case '<':
				result = (left as any) < (right as any);
				break;
			case '>':
				result = (left as any) > (right as any);
				break;
			case '<=':
				result = (left as any) <= (right as any);
				break;
			case '>=':
				result = (left as any) >= (right as any);
				break;
			case '&&':
				result = left && right;
				break;
			case '||':
				result = left || right;
				break;
			default:
				result = undefined;
		}

		return this.track(
			result,
			{ type: 'system' as any, operation: `binary_${operator}`, timestamp: Date.now() },
			[leftId, rightId]
		);
	}

	trackAssign(name: string, value: unknown): unknown {
		return this.track(
			value,
			{ type: 'system' as any, operation: 'assignment', timestamp: Date.now() },
			[this.getId(value)]
		);
	}

	trackMethod(object: unknown, method: string, args: unknown[]): unknown {
		if (typeof object === 'object' && object !== null && method in (object as any)) {
			const result = (object as any)[method](...args);

			return this.track(
				result,
				{ type: 'system' as any, operation: `method_${method}`, timestamp: Date.now() },
				[this.getId(object), ...args.map((a) => this.getId(a))]
			);
		}

		return undefined;
	}

	trackTemplate(expressions: unknown[], quasis: string[]): string {
		let result = '';
		let toolMetadata: ProvenanceMetadata | null = null;

		for (let i = 0; i < quasis.length; i++) {
			result += quasis[i] || '';
			if (i < expressions.length) {
				const expr = expressions[i];
				result += String(expr);

				const prov = getProvenance(expr) || getProvenanceForPrimitive(expr);
				if (prov && prov.source.type === ProvenanceSource.TOOL && !toolMetadata) {
					toolMetadata = prov;
				}
			}
		}

		if (toolMetadata) {
			markPrimitiveTainted(result, toolMetadata);
		}

		return result;
	}

	getMetadata(value: unknown): ProvenanceMetadata | null {
		if (typeof value === 'object' && value !== null) {
			const id = this.valueToId.get(value as object);
			if (id) {
				return this.metadata.get(id) || null;
			}
		}
		return null;
	}

	getAllMetadata(): Map<string, ProvenanceMetadata> {
		return new Map(this.metadata);
	}

	restoreMetadata(metadata: Map<string, ProvenanceMetadata>): void {
		this.metadata = new Map(metadata);
	}
}

/**
 * Create tracking runtime for sandbox injection
 */
export function createTrackingRuntime(): {
	tracker: ASTProvenanceTracker;
	runtime: Record<string, Function>;
} {
	const tracker = new ASTProvenanceTracker();

	return {
		tracker,
		runtime: {
			__track: (value: unknown, source: SourceMetadata, deps?: string[]) =>
				tracker.track(value, source, deps),
			__track_binary: (left: unknown, right: unknown, operator: string) =>
				tracker.trackBinary(left, right, operator),
			__track_assign: (name: string, value: unknown) => tracker.trackAssign(name, value),
			__track_method: (object: unknown, method: string, args: unknown[]) =>
				tracker.trackMethod(object, method, args),
			__track_template: (expressions: unknown[], quasis: string[]) =>
				tracker.trackTemplate(expressions, quasis),
			__get_provenance: (value: unknown) => tracker.getMetadata(value),
		},
	};
}
