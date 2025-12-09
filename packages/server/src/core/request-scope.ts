import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientToolRules, APIGroupConfig, ToolMetadata } from '@mondaydotcomorg/atp-protocol';

/**
 * Request-scoped context accessible from anywhere in the call stack.
 * This allows services to automatically access request-level configuration
 * without explicit parameter passing.
 */
export interface RequestScopedContext {
	toolRules?: ClientToolRules;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestScopedContext>();

/**
 * Run a function within a request scope.
 * All code executed within the callback can access the scoped context.
 */
export function runInRequestScope<T>(context: RequestScopedContext, fn: () => T): T {
	return asyncLocalStorage.run(context, fn);
}

/**
 * Get the current request-scoped tool rules.
 * Returns undefined if not in a request scope or no rules are set.
 */
export function getRequestToolRules(): ClientToolRules | undefined {
	return asyncLocalStorage.getStore()?.toolRules;
}

/**
 * Get the full request-scoped context.
 */
export function getRequestScope(): RequestScopedContext | undefined {
	return asyncLocalStorage.getStore();
}

/**
 * Check if an API group is allowed based on tool rules.
 */
function isGroupAllowed(groupName: string, rules?: ClientToolRules): boolean {
	if (!rules) return true;

	if (rules.allowOnlyApiGroups && rules.allowOnlyApiGroups.length > 0) {
		return rules.allowOnlyApiGroups.includes(groupName);
	}

	if (rules.blockApiGroups && rules.blockApiGroups.length > 0) {
		return !rules.blockApiGroups.includes(groupName);
	}

	return true;
}

/**
 * Check if a specific tool is allowed based on tool rules.
 */
function isToolAllowed(
	toolName: string,
	groupName: string,
	metadata?: ToolMetadata,
	rules?: ClientToolRules
): boolean {
	if (!rules) return true;

	const fullName = `${groupName}.${toolName}`;

	if (rules.allowOnlyTools && rules.allowOnlyTools.length > 0) {
		return rules.allowOnlyTools.some((t) => t === toolName || t === fullName);
	}

	if (rules.blockTools && rules.blockTools.length > 0) {
		if (rules.blockTools.some((t) => t === toolName || t === fullName)) {
			return false;
		}
	}

	if (metadata) {
		if (
			rules.blockOperationTypes &&
			metadata.operationType &&
			rules.blockOperationTypes.includes(metadata.operationType)
		) {
			return false;
		}
		if (
			rules.blockSensitivityLevels &&
			metadata.sensitivityLevel &&
			rules.blockSensitivityLevels.includes(metadata.sensitivityLevel)
		) {
			return false;
		}
	}

	return true;
}

/**
 * Filter API groups based on tool rules.
 * Returns a new array with only allowed groups and functions.
 * Blocked tools simply don't exist in the result.
 *
 * @param apiGroups - All API groups to filter
 * @param rules - Tool rules to apply (defaults to current request's rules)
 */
export function filterApiGroups(
	apiGroups: APIGroupConfig[],
	rules?: ClientToolRules
): APIGroupConfig[] {
	const effectiveRules = rules ?? getRequestToolRules();
	if (!effectiveRules) return apiGroups;

	return apiGroups
		.filter((group) => isGroupAllowed(group.name, effectiveRules))
		.map((group) => {
			if (!group.functions) return group;

			const filteredFunctions = group.functions.filter((func) =>
				isToolAllowed(func.name, group.name, func.metadata, effectiveRules)
			);

			if (filteredFunctions.length === 0) return null;

			return {
				...group,
				functions: filteredFunctions,
			};
		})
		.filter((group): group is APIGroupConfig => group !== null);
}


