import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';

export interface DetectionResult {
	needsTransform: boolean;
	patterns: AsyncPattern[];
	batchableParallel?: boolean;
}

export type AsyncPattern =
	| 'for-of-await'
	| 'while-await'
	| 'map-async'
	| 'forEach-async'
	| 'filter-async'
	| 'reduce-async'
	| 'find-async'
	| 'some-async'
	| 'every-async'
	| 'flatMap-async'
	| 'promise-all'
	| 'promise-allSettled';

export interface TransformResult {
	code: string;
	transformed: boolean;
	patterns: AsyncPattern[];
	metadata: TransformMetadata;
}

export interface TransformMetadata {
	loopCount: number;
	arrayMethodCount: number;
	parallelCallCount: number;
	batchableCount: number;
	/** Number of operations wrapped with checkpoint logic */
	checkpointCount: number;
	/** Checkpoint IDs generated during transformation */
	checkpointIds?: string[];
}

export interface LoopCheckpoint {
	loopId: string;
	currentIndex: number;
	results?: unknown[];
	accumulator?: unknown;
	completed?: Set<number>;
	timestamp: number;
}

export type BatchServiceType = 'llm' | 'approval' | 'embedding' | 'tool';

export interface BatchCallInfo {
	type: BatchServiceType;
	operation: string;
	payload: Record<string, unknown>;
}

export interface RuntimeContext {
	executionId: string;
	cache?: CacheProvider;
	checkpointPrefix?: string;
}

export interface TransformerOptions {
	generateDebugInfo?: boolean;
	maxLoopNesting?: number;
	enableBatchParallel?: boolean;
	batchSizeThreshold?: number;
}

export interface PausableCallPattern {
	namespace: string;
	method: string;
}

export const PAUSABLE_CALL_PATTERNS: PausableCallPattern[] = [
	{ namespace: 'atp.llm', method: 'call' },
	{ namespace: 'atp.llm', method: 'extract' },
	{ namespace: 'atp.llm', method: 'classify' },
	{ namespace: 'atp.llm', method: 'stream' },
	{ namespace: 'atp.llm', method: 'generate' },
	{ namespace: 'atp.approval', method: 'request' },
	{ namespace: 'atp.approval', method: 'confirm' },
	{ namespace: 'atp.approval', method: 'verify' },
	{ namespace: 'atp.embedding', method: 'embed' },
	{ namespace: 'atp.embedding', method: 'search' },
	{ namespace: 'atp.embedding', method: 'create' },
	{ namespace: 'atp.embedding', method: 'generate' },
	{ namespace: 'atp.embedding', method: 'encode' },
	{ namespace: 'api.client', method: '*' },
];

export interface CompilerConfig {
	enableBatchParallel?: boolean;
	maxLoopNesting?: number;
	checkpointInterval?: number;
	debugMode?: boolean;
	batchSizeThreshold?: number;
	/** Enable operation-level checkpointing for recovery from failures */
	enableOperationCheckpoints?: boolean;
}

export const DEFAULT_COMPILER_CONFIG: CompilerConfig = {
	enableBatchParallel: true,
	maxLoopNesting: 10,
	checkpointInterval: 1,
	debugMode: false,
	batchSizeThreshold: 10,
	enableOperationCheckpoints: false, // Disabled by default, opt-in feature
};
