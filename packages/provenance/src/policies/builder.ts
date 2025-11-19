import type { DeclarativePolicyConfig, PolicyRule, Operator } from './declarative.js';
import type { PolicyAction } from '../types.js';

/**
 * Helper class to build policy rules fluently
 */
export class RuleBuilder {
	private rule: PolicyRule = {
		action: 'log',
		conditions: [],
	};

	constructor(action: PolicyAction = 'log') {
		this.rule.action = action;
	}

	action(action: PolicyAction): this {
		this.rule.action = action;
		return this;
	}

	id(id: string): this {
		this.rule.id = id;
		return this;
	}

	reason(reason: string): this {
		this.rule.reason = reason;
		return this;
	}

	condition(field: string, operator: Operator, value: any): this {
		this.rule.conditions.push({ field, operator, value });
		return this;
	}

	build(): PolicyRule {
		return this.rule;
	}
}

/**
 * Helper class to build declarative policies fluently
 */
export class PolicyBuilder {
	private config: DeclarativePolicyConfig;

	constructor(id: string) {
		this.config = {
			id,
			scope: {},
			rules: [],
		};
	}

	description(desc: string): this {
		this.config.description = desc;
		return this;
	}

	scopeTool(toolNamePattern: string): this {
		this.config.scope.toolName = toolNamePattern;
		return this;
	}

	scopeApiGroup(apiGroupPattern: string): this {
		this.config.scope.apiGroup = apiGroupPattern;
		return this;
	}

	/**
	 * Add a rule using a builder callback
	 * @example
	 * .addRule(r => r.action('block').condition('args.amount', 'matches', '>1000'))
	 */
	addRule(buildFn: (builder: RuleBuilder) => RuleBuilder): this {
		const builder = new RuleBuilder();
		this.config.rules.push(buildFn(builder).build());
		return this;
	}

	/**
	 * Add a fully formed rule object
	 */
	addRuleObject(rule: PolicyRule): this {
		this.config.rules.push(rule);
		return this;
	}

	build(): DeclarativePolicyConfig {
		return this.config;
	}
}
