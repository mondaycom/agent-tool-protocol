import { z } from 'zod';

export const OperatorSchema = z.enum([
	'equals',
	'notEquals',
	'contains',
	'notContains',
	'startsWith',
	'notStartsWith',
	'endsWith',
	'notEndsWith',
	'matches',
	'in',
	'notIn',
]);

export type Operator = z.infer<typeof OperatorSchema>;

export const ConditionSchema = z.object({
	field: z
		.string()
		.describe('Field to check (e.g. args.paramName, provenance.args.param.source.type)'),
	operator: OperatorSchema,
	value: z.any().describe('Value to compare against'),
});

export type Condition = z.infer<typeof ConditionSchema>;

export const PolicyActionSchema = z.enum(['log', 'approve', 'block']);

export type PolicyAction = z.infer<typeof PolicyActionSchema>;

export const PolicyRuleSchema = z.object({
	id: z.string().optional(),
	action: PolicyActionSchema,
	conditions: z.array(ConditionSchema).describe('All conditions must match (implicit AND)'),
	reason: z.string().optional(),
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const DeclarativePolicyConfigSchema = z.object({
	id: z.string(),
	description: z.string().optional(),
	scope: z.object({
		toolName: z.string().optional().describe('Regex pattern or exact match for tool name'),
		apiGroup: z.string().optional().describe('Regex pattern or exact match for API group'),
	}),
	rules: z.array(PolicyRuleSchema).describe('Rules are evaluated in order. First match wins.'),
});

export type DeclarativePolicyConfig = z.infer<typeof DeclarativePolicyConfigSchema>;

export const PolicyConfigurationSchema = z.object({
	version: z.string(),
	policies: z.array(DeclarativePolicyConfigSchema),
});

export type PolicyConfiguration = z.infer<typeof PolicyConfigurationSchema>;
