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
} from './operation-checkpoint-manager.js';
import type { OperationMetadata, CheckpointConfig, CheckpointInfo } from './checkpoint-types.js';
import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';

export interface CheckpointRuntimeConfig {
	executionId: string;
	cache: CacheProvider;
	config?: CheckpointConfig;
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
		// If not a full ID format, try loading from current execution (backwards compatibility)
		const checkpoint = await manager.load(fullCheckpointId);
		if (!checkpoint) {
			throw new Error(`Checkpoint not found: ${fullCheckpointId}`);
		}
		return manager.restore(checkpoint);
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

	return {
		checkpoints,
		restoreInstructions: manager.generateRestoreInstructions(),
		stats: manager.getStats(),
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
}

