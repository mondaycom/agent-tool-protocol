import type { SecurityPolicy, PolicyResult, ProvenanceMetadata, PolicyAction } from '../types.js';

export type Operator =
	| 'equals'
	| 'notEquals'
	| 'contains'
	| 'notContains'
	| 'startsWith'
	| 'notStartsWith'
	| 'endsWith'
	| 'notEndsWith'
	| 'matches'
	| 'in'
	| 'notIn';

export interface Condition {
	/**
	 * Field to check.
	 * - "args.paramName": Value of a tool argument
	 * - "provenance.args.paramName.source.type": Provenance metadata
	 * - "provenance.args.paramName.readers": Reader permissions
	 */
	field: string;
	operator: Operator;
	value: any;
}

export interface PolicyRule {
	id?: string;
	/** Action to take if conditions match */
	action: PolicyAction;
	/** Conditions (implicit AND) - all must match for the rule to trigger */
	conditions: Condition[];
	/** Custom reason message */
	reason?: string;
}

export interface DeclarativePolicyConfig {
	id: string;
	description?: string;
	scope: {
		/** Regex pattern or exact match for tool name */
		toolName?: string;
		/** Regex pattern or exact match for API group */
		apiGroup?: string;
	};
	/** Rules are evaluated in order. First match wins. */
	rules: PolicyRule[];
}

export interface PolicyConfiguration {
	version: string;
	policies: DeclarativePolicyConfig[];
}

/**
 * Resolve a value from a path in the arguments or provenance
 */
function resolveValue(
	path: string,
	args: Record<string, unknown>,
	getProvenance: (value: unknown) => ProvenanceMetadata | null
): any {
	const parts = path.split('.');
	const root = parts.shift();

	if (root === 'args') {
		let current: any = args;
		for (const part of parts) {
			if (current === null || current === undefined) {
				return undefined;
			}
			current = current[part];
		}
		return current;
	}

	if (root === 'provenance' && parts[0] === 'args') {
		parts.shift(); // remove 'args'
		const argName = parts.shift(); // get argument name
		if (!argName) return undefined;

		const argValue = args[argName];

		// Better approach:
		// 1. Traverse args until we find the object.
		// 2. Get provenance of that object.
		// 3. Traverse provenance metadata.

		let remainingParts = [...parts];

		// We don't know where the split is.
		// Let's try to find standard metadata keys in the path.
		const metadataKeys = ['source', 'readers', 'dependencies', 'id', 'context'];
		let splitIndex = -1;
		for (let i = 0; i < remainingParts.length; i++) {
			if (metadataKeys.includes(remainingParts[i]!)) {
				splitIndex = i;
				break;
			}
		}

		if (splitIndex === -1) {
			return undefined;
		}

		// Traverse to the value that should have provenance
		let valuePath = remainingParts.slice(0, splitIndex);
		let metaPath = remainingParts.slice(splitIndex);

		let currentVal = argValue;
		for (const part of valuePath) {
			if (currentVal === null || currentVal === undefined) return undefined;
			currentVal = (currentVal as any)[part];
		}

		const metadata = getProvenance(currentVal);
		if (!metadata) return undefined;

		// Now traverse metadata
		let currentMeta: any = metadata;
		for (const part of metaPath) {
			if (currentMeta === null || currentMeta === undefined) return undefined;
			currentMeta = currentMeta[part];
		}
		return currentMeta;
	}

	return undefined;
}

function evaluateCondition(actual: any, operator: Operator, expected: any): boolean {
	switch (operator) {
		case 'equals':
			return actual === expected;
		case 'notEquals':
			return actual !== expected;
		case 'contains':
			return Array.isArray(actual) || typeof actual === 'string'
				? actual.includes(expected)
				: false;
		case 'notContains':
			return Array.isArray(actual) || typeof actual === 'string'
				? !actual.includes(expected)
				: true;
		case 'startsWith':
			return typeof actual === 'string' ? actual.startsWith(expected) : false;
		case 'notStartsWith':
			return typeof actual === 'string' ? !actual.startsWith(expected) : true;
		case 'endsWith':
			return typeof actual === 'string' ? actual.endsWith(expected) : false;
		case 'notEndsWith':
			return typeof actual === 'string' ? !actual.endsWith(expected) : true;
		case 'matches':
			if (typeof actual === 'string') {
				return new RegExp(expected).test(actual);
			}
			if (typeof actual === 'number' && typeof expected === 'string') {
				const match = expected.match(/^([<>]=?|==|!=)(\d+(?:\.\d+)?)$/);
				if (match) {
					const [, op, value] = match;
					const numValue = parseFloat(value!);
					switch (op) {
						case '>':
							return actual > numValue;
						case '>=':
							return actual >= numValue;
						case '<':
							return actual < numValue;
						case '<=':
							return actual <= numValue;
						case '==':
							return actual === numValue;
						case '!=':
							return actual !== numValue;
					}
				}
			}
			return false;
		case 'in':
			return Array.isArray(expected) ? expected.includes(actual) : false;
		case 'notIn':
			return Array.isArray(expected) ? !expected.includes(actual) : true;
		default:
			return false;
	}
}

/**
 * Create a SecurityPolicy from a declarative configuration
 */
export function createDeclarativePolicy(config: DeclarativePolicyConfig): SecurityPolicy {
	return {
		name: config.id,
		description: config.description,
		check: async (toolName, args, getProvenance) => {
			if (config.scope.toolName) {
				const toolRegex = new RegExp(`^${config.scope.toolName}$`);
				if (!toolRegex.test(toolName)) {
					return { action: 'log' };
				}
			}

			if (config.scope.apiGroup) {
				// Note: apiGroup is matched against the toolName prefix (e.g., "payment" from "payment.transfer")
				// The SecurityPolicy interface doesn't receive apiGroup separately, but we can extract it from toolName
				const extractedGroup = toolName.split('.')[0] || '';
				const groupRegex = new RegExp(`^${config.scope.apiGroup}$`);
				if (!groupRegex.test(extractedGroup)) {
					return { action: 'log' };
				}
			}

			for (const rule of config.rules) {
				const allMatch = rule.conditions.every((condition) => {
					const actualValue = resolveValue(condition.field, args, getProvenance);
					return evaluateCondition(actualValue, condition.operator, condition.value);
				});

				if (allMatch) {
					return {
						action: rule.action,
						reason: rule.reason || `Matched rule ${rule.id || 'unknown'} in policy ${config.id}`,
						policy: config.id,
						context: { ruleId: rule.id, conditions: rule.conditions },
					};
				}
			}

			return { action: 'log' };
		},
	};
}

/**
 * Load policies from a full configuration object or array of policy configs
 */
export function loadDeclarativePolicies(
	config: PolicyConfiguration | DeclarativePolicyConfig[]
): SecurityPolicy[] {
	if (Array.isArray(config)) {
		return config.map(createDeclarativePolicy);
	}
	return config.policies.map(createDeclarativePolicy);
}
