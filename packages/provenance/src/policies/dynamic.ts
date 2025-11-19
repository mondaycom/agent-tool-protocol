import type { SecurityPolicy, PolicyResult, ProvenanceMetadata } from '../types.js';
import { createDeclarativePolicy, type DeclarativePolicyConfig } from './declarative.js';

/**
 * A dynamic registry that manages multiple policies and acts as a single SecurityPolicy.
 * This allows policies to be updated at runtime (e.g. from a UI or database) without restarting the server.
 */
export class DynamicPolicyRegistry implements SecurityPolicy {
	name = 'dynamic-policy-registry';
	description = 'Container for dynamically managed security policies';

	private policies: Map<string, SecurityPolicy> = new Map();

	constructor(initialPolicies: SecurityPolicy[] = []) {
		for (const policy of initialPolicies) {
			this.policies.set(policy.name, policy);
		}
	}

	/**
	 * Add or update a policy
	 */
	addPolicy(policy: SecurityPolicy): void {
		this.policies.set(policy.name, policy);
	}

	/**
	 * Remove a policy by name
	 */
	removePolicy(name: string): void {
		this.policies.delete(name);
	}

	/**
	 * clear all policies
	 */
	clear(): void {
		this.policies.clear();
	}

	/**
	 * Load policies from declarative configurations (JSON)
	 * This is useful for loading policies saved from a UI
	 */
	loadFromConfigs(configs: DeclarativePolicyConfig[], replace = false): void {
		if (replace) {
			this.policies.clear();
		}
		for (const config of configs) {
			const policy = createDeclarativePolicy(config);
			this.policies.set(policy.name, policy);
		}
	}

	/**
	 * Get all registered policies
	 */
	getPolicies(): SecurityPolicy[] {
		return Array.from(this.policies.values());
	}

	/**
	 * Implementation of the SecurityPolicy check interface.
	 * Delegates to all registered policies.
	 */
	async check(
		toolName: string,
		args: Record<string, unknown>,
		getProvenance: (value: unknown) => ProvenanceMetadata | null
	): Promise<PolicyResult> {
		let requiresApproval: PolicyResult | null = null;

		for (const policy of this.policies.values()) {
			const result = await policy.check(toolName, args, getProvenance);

			if (result.action === 'block') {
				return result;
			}

			if (result.action === 'approve') {
				if (!requiresApproval) {
					requiresApproval = result;
				}
			}
		}

		if (requiresApproval) {
			return requiresApproval;
		}

		return { action: 'log' };
	}
}
