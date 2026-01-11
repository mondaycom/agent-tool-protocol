/**
 * Checkpoint Types for Operation-Level Checkpointing
 * 
 * This module defines the types for checkpointing expensive operations
 * (API calls, LLM calls, etc.) to enable recovery from failures without
 * re-executing already completed operations.
 */

import type {
	CheckpointProvenanceSnapshot,
	ProvenanceEntry,
	ProvenanceExtractor,
	ProvenanceAttacher,
} from '@mondaydotcomorg/atp-provenance';

// Re-export provenance types for convenience
export type {
	CheckpointProvenanceSnapshot,
	ProvenanceEntry as CheckpointProvenanceEntry,
	ProvenanceExtractor,
	ProvenanceAttacher,
};

// Re-export from provenance package for backwards compatibility
export type { ProvenanceMetadata as CheckpointProvenanceMetadata } from '@mondaydotcomorg/atp-provenance';
export { ProvenanceSource as CheckpointProvenanceSource } from '@mondaydotcomorg/atp-provenance';
export type { ReaderPermissions as CheckpointReaderPermissions } from '@mondaydotcomorg/atp-provenance';

/**
 * Type of checkpoint storage strategy
 */
export enum CheckpointType {
	/** Store the complete result value */
	FULL_SNAPSHOT = 'full_snapshot',
	/** Store a reference/summary with full value in cache */
	REFERENCE = 'reference',
}

/**
 * Type of operation being checkpointed
 */
export enum OperationType {
	API = 'api',
	LLM = 'llm',
	EMBEDDING = 'embedding',
	CLIENT_TOOL = 'client_tool',
	APPROVAL = 'approval',
}

/**
 * Metadata about the operation being checkpointed
 */
export interface OperationMetadata {
	/** Type of operation */
	type: OperationType;
	/** Top-level namespace (e.g., 'atp') */
	namespace: string;
	/** API group (e.g., 'github', 'database') */
	group?: string;
	/** Method/function name (e.g., 'getUser', 'call') */
	method: string;
	/** Parameters passed to the operation */
	params: Record<string, unknown>;
	/** Original code expression that triggered this checkpoint */
	sourceExpression?: string;
}

/**
 * Base checkpoint interface
 */
export interface BaseCheckpoint {
	/** Unique checkpoint identifier within execution */
	id: string;
	/** Execution ID this checkpoint belongs to */
	executionId: string;
	/** Type of checkpoint storage */
	type: CheckpointType;
	/** Metadata about the operation */
	operation: OperationMetadata;
	/** When checkpoint was created */
	timestamp: number;
	/** Time-to-live in seconds (optional) */
	ttl?: number;
	/**
	 * Provenance snapshot for security policy enforcement
	 * If present, provenance will be re-attached on restore
	 */
	provenance?: CheckpointProvenanceSnapshot;
}

/**
 * Full snapshot checkpoint - stores complete result
 * Use for: small results, single entities, focused data
 */
export interface FullSnapshotCheckpoint extends BaseCheckpoint {
	type: CheckpointType.FULL_SNAPSHOT;
	/** Complete serialized result */
	result: unknown;
	/** Size in bytes (for monitoring) */
	sizeBytes?: number;
}

/**
 * Reference to a checkpoint result stored elsewhere
 */
export interface CheckpointReference {
	/** Human-readable description of what's stored */
	description: string;
	/** Preview of the data (first few items/fields) */
	preview?: unknown;
	/** Count of items (for arrays) or keys (for objects) */
	count?: number;
	/** Sample of keys/indices */
	keys?: string[];
	/** Code snippet to restore this checkpoint */
	restoreCode: string;
}

/**
 * Reference checkpoint - stores full result but shows preview to LLM
 * Use for: large results, arrays, search results, bulk data
 * 
 * Note: The full result is stored in the checkpoint, but when shown to LLM
 * in error responses, only the preview/summary is included (not the full data).
 * The LLM can restore the full data using __restore.checkpoint(id).
 */
export interface ReferenceCheckpoint extends BaseCheckpoint {
	type: CheckpointType.REFERENCE;
	/** Summary/reference information (shown to LLM) */
	reference: CheckpointReference;
	/** Complete result (stored but not shown to LLM in error response) */
	result: unknown;
	/** Size in bytes of full result (for monitoring) */
	sizeBytes?: number;
}

/**
 * Union type for all checkpoints
 */
export type Checkpoint = FullSnapshotCheckpoint | ReferenceCheckpoint;

/**
 * Information about a checkpoint for error responses
 */
export interface CheckpointInfo {
	/** Checkpoint identifier */
	id: string;
	/** Storage type */
	type: CheckpointType;
	/** Formatted operation name (e.g., "atp.api.github.getUser") */
	operation: string;
	/** Description of the checkpointed data */
	description: string;
	/** Reference information (only for reference checkpoints) */
	reference?: CheckpointReference;
	/** Full result (only for full snapshot checkpoints WITHOUT restricted access) */
	result?: unknown;
	/** When checkpoint was created */
	timestamp: number;
	/**
	 * Whether this checkpoint has restricted provenance
	 * If true, LLM MUST use __restore.checkpoint() to access data
	 * Full data will NOT be included in error response
	 */
	hasRestrictedProvenance?: boolean;
	/**
	 * Security notice shown to LLM when data has restricted provenance
	 */
	securityNotice?: string;
}

/**
 * Checkpoint data attached to execution results
 */
export interface CheckpointData {
	/** Available checkpoints from the execution */
	available: CheckpointInfo[];
	/** Human-readable instructions for using checkpoints */
	restoreInstructions: string;
}

/**
 * Strategy for deciding checkpoint type and creating references
 */
export interface CheckpointStrategy {
	/**
	 * Decide whether to use full snapshot or reference based on result size/structure
	 * @param result The operation result
	 * @param provenance Optional provenance metadata for security decisions
	 * @returns true for full snapshot, false for reference
	 */
	shouldUseFullSnapshot(result: unknown, provenance?: CheckpointProvenanceSnapshot): boolean;

	/**
	 * Create a reference for a large result
	 * @param result The operation result
	 * @param metadata Operation metadata (used for description generation)
	 * @returns Reference information
	 */
	createReference(result: unknown, metadata: OperationMetadata): CheckpointReference;

	/**
	 * Generate a description for a checkpoint
	 * @param result The operation result
	 * @param metadata Operation metadata
	 * @returns Human-readable description
	 */
	generateDescription(result: unknown, metadata: OperationMetadata): string;
}

/**
 * Configuration for checkpoint behavior
 */
export interface CheckpointConfig {
	/** Maximum size for full snapshots (bytes) */
	maxFullSnapshotSize?: number;
	/** Maximum array length for full snapshots */
	maxArrayItemsFull?: number;
	/** TTL for checkpoints in cache (seconds) */
	defaultTTL?: number;
	/** Custom strategy implementation */
	strategy?: CheckpointStrategy;
	/** Enable/disable checkpointing */
	enabled?: boolean;
	/** Preview size for references (items to show) */
	previewSize?: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CHECKPOINT_CONFIG: Required<Omit<CheckpointConfig, 'strategy'>> = {
	maxFullSnapshotSize: 10_000, // 10KB
	maxArrayItemsFull: 100,
	defaultTTL: 3600, // 1 hour
	enabled: true,
	previewSize: 3,
};

/**
 * Error thrown when operation checkpoint operations fail
 */
export class OperationCheckpointError extends Error {
	constructor(
		message: string,
		public readonly checkpointId: string,
		public readonly operation: 'save' | 'load' | 'restore' | 'create'
	) {
		super(message);
		this.name = 'OperationCheckpointError';
	}
}

