/**
 * Checkpoint Runtime
 *
 * Provides the runtime functions that are injected into the sandbox
 * as `__checkpoint` namespace. These are called by the transformed code.
 */

import {
	OperationCheckpointManager,
	getOperationCheckpointManager,
	hasOperationCheckpointManager,
	setOperationCheckpointManager,
	clearOperationCheckpointManager,
	setCheckpointExecutionId,
	clearCheckpointExecutionId,
	type ProvenanceExtractor,
	type ProvenanceAttacher,
	type ProvenanceMetaAttacher,
} from './operation-checkpoint-manager.js';
import type { OperationMetadata, CheckpointConfig, CheckpointInfo, CheckpointProvenanceMetadata } from './checkpoint-types.js';
import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';

export interface CheckpointRuntimeConfig {
	executionId: string;
	cache: CacheProvider;
	config?: CheckpointConfig;
}

/**
 * Extended config with provenance integration
 */
export interface CheckpointRuntimeConfigWithProvenance extends CheckpointRuntimeConfig {
	/**
	 * Function to extract provenance metadata from a value
	 * Typically: (value) => getProvenance(value)
	 */
	provenanceExtractor?: ProvenanceExtractor;
	
	/**
	 * Function to re-attach provenance to a restored value
	 * Typically: (value, metadata) => createProvenanceProxy(value, metadata.source, metadata.readers)
	 */
	provenanceAttacher?: ProvenanceAttacher;
	
	/**
	 * Function to attach __prov_meta__ to objects before buffering
	 * This ensures provenance survives isolated-vm boundary crossing
	 */
	provenanceMetaAttacher?: ProvenanceMetaAttacher;
}

/**
 * Initialize the checkpoint runtime for an execution context
 */
export function initializeCheckpointRuntime(config: CheckpointRuntimeConfig): void {
	// Set the current execution ID first
	setCheckpointExecutionId(config.executionId);
	
	// Create and register the manager
	const manager = new OperationCheckpointManager(
		config.executionId,
		config.cache,
		config.config
	);
	setOperationCheckpointManager(manager);
}

/**
 * Initialize the checkpoint runtime with provenance integration
 * 
 * When provenance is enabled:
 * - Restricted data is automatically forced to use reference checkpoints
 * - Provenance is re-attached when restoring checkpoints
 * - Security policies continue to work after checkpoint restoration
 */
export function initializeCheckpointRuntimeWithProvenance(
	config: CheckpointRuntimeConfigWithProvenance
): void {
	// Set the current execution ID first
	setCheckpointExecutionId(config.executionId);
	
	// Create and register the manager
	const manager = new OperationCheckpointManager(
		config.executionId,
		config.cache,
		config.config
	);

	// Configure provenance integration
	if (config.provenanceExtractor) {
		manager.setProvenanceExtractor(config.provenanceExtractor);
	}
	if (config.provenanceAttacher) {
		manager.setProvenanceAttacher(config.provenanceAttacher);
	}
	if (config.provenanceMetaAttacher) {
		manager.setProvenanceMetaAttacher(config.provenanceMetaAttacher);
	}

	setOperationCheckpointManager(manager);
}

/**
 * Configure provenance functions on an existing checkpoint manager
 * Call this if the manager was already initialized without provenance
 */
export function configureCheckpointProvenance(
	provenanceExtractor: ProvenanceExtractor,
	provenanceAttacher: ProvenanceAttacher
): void {
	if (!hasOperationCheckpointManager()) {
		return;
	}

	const manager = getOperationCheckpointManager();
	manager.setProvenanceExtractor(provenanceExtractor);
	manager.setProvenanceAttacher(provenanceAttacher);
}

/**
 * Cleanup the checkpoint runtime for an execution
 * @param executionId - Optional execution ID to clean up (uses current if not provided)
 */
export function cleanupCheckpointRuntime(executionId?: string): void {
	clearOperationCheckpointManager(executionId);
	clearCheckpointExecutionId();
}

/**
 * Get the checkpoint runtime functions to inject into sandbox
 * These are the functions available as `__checkpoint` in transformed code
 */
export function getCheckpointRuntime(): CheckpointSandboxRuntime {
	return {
		buffer: checkpointBuffer,
		restore: checkpointRestore,
		getAll: getCheckpointInfos,
		getInstructions: getRestoreInstructions,
	};
}

/**
 * The runtime interface exposed in the sandbox
 */
export interface CheckpointSandboxRuntime {

	/**
	 * Buffer a result in memory (does NOT persist until flush)
	 * Called by transformed code: `__checkpoint.buffer(id, result, metadata)`
	 * Note: This is synchronous - no await needed
	 */
	buffer: (checkpointId: string, result: unknown, metadata: OperationMetadata) => void;

	/**
	 * Restore a value from a checkpoint
	 * Called by user code: `__restore.checkpoint(fullId)`
	 * @param fullCheckpointId - The full checkpoint ID (format: {executionId}:{shortId})
	 *                           The execution ID is parsed from the ID automatically
	 */
	restore: (fullCheckpointId: string) => Promise<unknown>;

	/**
	 * Get all checkpoint infos for the current execution
	 */
	getAll: () => CheckpointInfo[];

	/**
	 * Get restore instructions for the LLM
	 */
	getInstructions: () => string;
}

/**
 * Buffer a result in memory (does NOT persist to cache)
 * Use checkpointFlush() to persist on error
 * Note: This is synchronous - no await needed
 */
function checkpointBuffer(
	checkpointId: string,
	result: unknown,
	metadata: OperationMetadata
): void {
	if (!hasOperationCheckpointManager()) {
		return;
	}

	const manager = getOperationCheckpointManager();
	manager.bufferResult(checkpointId, result, metadata);
}

/**
 * Restore a value from a checkpoint
 * @param fullCheckpointId - The full checkpoint ID (format: {executionId}:{shortId})
 *                           The execution ID is parsed from the ID itself, no need to pass separately
 */
async function checkpointRestore(fullCheckpointId: string): Promise<unknown> {
	if (!hasOperationCheckpointManager()) {
		throw new Error('Checkpoint system not initialized');
	}

	const manager = getOperationCheckpointManager();

	// Parse the full checkpoint ID to extract execution ID and short ID
	const parsed = OperationCheckpointManager.parseCheckpointId(fullCheckpointId);
	
	if (!parsed) {
		throw new Error(`Checkpoint not found: ${fullCheckpointId}`);
	}

	// Load from the parsed execution ID
	const checkpoint = await manager.loadFromExecution(parsed.shortId, parsed.executionId);

	if (!checkpoint) {
		throw new Error(`Checkpoint not found: ${fullCheckpointId} (execution: ${parsed.executionId})`);
	}

	return manager.restore(checkpoint);
}

/**
 * Get all checkpoint infos for error reporting
 */
function getCheckpointInfos(): CheckpointInfo[] {
	if (!hasOperationCheckpointManager()) {
		return [];
	}

	const manager = getOperationCheckpointManager();
	return manager.getAllCheckpoints();
}

/**
 * Get restore instructions for the LLM
 */
function getRestoreInstructions(): string {
	if (!hasOperationCheckpointManager()) {
		return 'No checkpoints available.';
	}

	const manager = getOperationCheckpointManager();
	return manager.generateRestoreInstructions();
}

/**
 * Get the current execution's checkpoint manager
 */
export function getCurrentCheckpointManager(): OperationCheckpointManager | null {
	if (!hasOperationCheckpointManager()) {
		return null;
	}
	return getOperationCheckpointManager();
}

/**
 * Get checkpoint data for error responses
 * NOTE: This also flushes buffered checkpoints to cache before returning data
 */
export async function getCheckpointDataForError(): Promise<CheckpointErrorData | null> {
	if (!hasOperationCheckpointManager()) {
		return null;
	}

	const manager = getOperationCheckpointManager();
	
	// First, persist all buffered checkpoints so they're available for recovery
	await manager.persistAll();
	
	const checkpoints = manager.getAllCheckpoints();

	if (checkpoints.length === 0) {
		return null;
	}

	// Count restricted checkpoints
	const restrictedCount = checkpoints.filter(cp => cp.hasRestrictedProvenance).length;

	return {
		checkpoints,
		restoreInstructions: manager.generateRestoreInstructions(),
		stats: manager.getStats(),
		restrictedCount: restrictedCount > 0 ? restrictedCount : undefined,
	};
}

/**
 * Checkpoint data included in error responses
 */
export interface CheckpointErrorData {
	checkpoints: CheckpointInfo[];
	restoreInstructions: string;
	stats: {
		total: number;
		fullSnapshots: number;
		references: number;
		totalSizeBytes: number;
	};
	/**
	 * Number of checkpoints with restricted provenance
	 * These MUST be restored via __restore.checkpoint()
	 */
	restrictedCount?: number;
}

// Re-export types for convenience
export type { ProvenanceExtractor, ProvenanceAttacher } from './operation-checkpoint-manager.js';
export type { CheckpointProvenanceMetadata, CheckpointProvenanceSnapshot, CheckpointReaderPermissions, CheckpointProvenanceSource } from './checkpoint-types.js';
