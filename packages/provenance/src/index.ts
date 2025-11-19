export * from './types.js';

export {
	createProvenanceProxy,
	getProvenance,
	hasProvenance,
	getAllProvenance,
	canRead,
	getProvenanceForPrimitive,
	markPrimitiveTainted,
	isPrimitiveTainted,
	setProvenanceExecutionId,
	clearProvenanceExecutionId,
	registerProvenanceMetadata,
	cleanupProvenanceForExecution,
	captureProvenanceState,
	restoreProvenanceState,
	captureProvenanceSnapshot,
	restoreProvenanceSnapshot,
	setGlobalProvenanceStore,
	hydrateProvenance,
	hydrateExecutionProvenance,
} from './registry.js';

export {
	issueProvenanceToken,
	verifyProvenanceToken,
	verifyProvenanceHints,
	computeDigest,
	stableStringify,
	getClientSecret,
	type TokenPayload,
} from './tokens.js';

export { SecurityPolicyEngine, type Logger } from './policies/engine.js';

export {
	preventDataExfiltration,
	preventDataExfiltrationWithApproval,
	requireUserOrigin,
	requireUserOriginWithApproval,
	blockLLMRecipients,
	blockLLMRecipientsWithApproval,
	auditSensitiveAccess,
	getBuiltInPolicies,
	getBuiltInPoliciesWithApproval,
	createCustomPolicy,
} from './policies/engine.js';

export {
	createDeclarativePolicy,
	loadDeclarativePolicies,
	type DeclarativePolicyConfig,
	type PolicyConfiguration,
	type PolicyRule,
	type Condition,
	type Operator,
} from './policies/declarative.js';

export {
	DeclarativePolicyConfigSchema,
	PolicyConfigurationSchema,
	PolicyRuleSchema,
	ConditionSchema,
	OperatorSchema,
	PolicyActionSchema,
} from './policies/schema.js';

export { PolicyBuilder, RuleBuilder } from './policies/builder.js';
export { DynamicPolicyRegistry } from './policies/dynamic.js';

export { instrumentCode, createTrackingRuntime } from './ast/instrumentor.js';

export { type ProvenanceStore, InMemoryProvenanceStore } from './store.js';
