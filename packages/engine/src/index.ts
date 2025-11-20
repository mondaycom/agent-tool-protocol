/**
 * @mondaydotcomorg/atp-engine
 * 
 * Embedded execution engine for Agent Tool Protocol
 * Execute code in a secure sandbox without HTTP server overhead
 */

export { ATPEngine } from './engine.js';
export { APIRegistry } from './api-registry.js';

// Executor and aggregator (for advanced use cases)
export { SandboxExecutor } from './executor/index.js';
export { APIAggregator } from './aggregator/index.js';

// Re-export types
export type { ATPEngineConfig, APISpec } from './engine.js';

// Re-export commonly needed protocol types
export type {
	ExecutionConfig,
	ExecutionResult,
	ExecutionStatus,
	APIGroupConfig,
	CustomFunctionDef,
	CacheProvider,
	AuditSink,
} from '@mondaydotcomorg/atp-protocol';

// Re-export provenance types
export type { 
	SecurityPolicy, 
	ProvenanceMode 
} from '@mondaydotcomorg/atp-provenance';

export {
	preventDataExfiltration,
	preventDataExfiltrationWithApproval,
	requireUserOrigin,
	requireUserOriginWithApproval,
	blockLLMRecipients,
	blockLLMRecipientsWithApproval,
	auditSensitiveAccess,
} from '@mondaydotcomorg/atp-provenance';

// Re-export compiler types (not implementations to avoid build issues)
export type { ICompiler } from '@mondaydotcomorg/atp-compiler';

