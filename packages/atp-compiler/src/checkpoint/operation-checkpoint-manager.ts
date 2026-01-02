/**
 * Operation Checkpoint Manager
 * 
 * Manages checkpointing of expensive operations (API calls, LLM calls, etc.)
 * to enable recovery from failures without re-executing completed operations.
 */

import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';
import type {
	Checkpoint,
	FullSnapshotCheckpoint,
	ReferenceCheckpoint,
	OperationMetadata,
	CheckpointInfo,
	CheckpointStrategy,
	CheckpointConfig,
} from './checkpoint-types.js';
import { CheckpointType, OperationCheckpointError } from './checkpoint-types.js';
import { DEFAULT_CHECKPOINT_CONFIG } from './checkpoint-types.js';
import { DefaultCheckpointStrategy } from './checkpoint-strategy.js';

/**
 * Manages operation-level checkpoints for an execution
 */
export class OperationCheckpointManager {
	private cache: CacheProvider;
	private executionId: string;
	private strategy: CheckpointStrategy;
	private config: Required<Omit<CheckpointConfig, 'strategy'>>;
	private checkpoints: Map<string, Checkpoint> = new Map();
	private prefix: string;

	constructor(
		executionId: string,
		cache: CacheProvider,
		config?: CheckpointConfig
	) {
		this.executionId = executionId;
		this.cache = cache;
		this.config = {
			...DEFAULT_CHECKPOINT_CONFIG,
			...config,
		};
		this.strategy = config?.strategy || new DefaultCheckpointStrategy(config);
		this.prefix = 'op_checkpoint';
	}

	/**
	 * Create a checkpoint for an operation result (synchronous)
	 * Note: For reference checkpoints, the full result is stored in _pendingResult
	 * and persisted later via persistAll()
	 */
	private createCheckpoint(
		id: string,
		result: unknown,
		metadata: OperationMetadata
	): Checkpoint {
		const useFullSnapshot = this.strategy.shouldUseFullSnapshot(result);

		if (useFullSnapshot) {
			return this.createFullSnapshot(id, result, metadata);
		} else {
			return this.createReference(id, result, metadata);
		}
	}

	/**
	 * Create a full snapshot checkpoint
	 */
	private createFullSnapshot(
		id: string,
		result: unknown,
		metadata: OperationMetadata
	): FullSnapshotCheckpoint {
		const serialized = JSON.stringify(result);
		const sizeBytes = new Blob([serialized]).size;

		return {
			id,
			executionId: this.executionId,
			type: CheckpointType.FULL_SNAPSHOT,
			operation: metadata,
			result,
			timestamp: Date.now(),
			ttl: this.config.defaultTTL,
			sizeBytes,
		};
	}

	/**
	 * Create a reference checkpoint
	 * Stores full result in checkpoint, but only shows preview to LLM in error responses
	 */
	private createReference(
		id: string,
		result: unknown,
		metadata: OperationMetadata
	): ReferenceCheckpoint {
		// Generate reference information (preview/summary for LLM)
		let reference = this.strategy.createReference(result, metadata);

		// Replace placeholder with actual checkpoint ID
		reference = {
			...reference,
			restoreCode: reference.restoreCode.replace('{{CHECKPOINT_ID}}', id),
		};

		const serialized = JSON.stringify(result);
		const sizeBytes = new Blob([serialized]).size;

		return {
			id,
			executionId: this.executionId,
			type: CheckpointType.REFERENCE,
			operation: metadata,
			reference,
			result, // Full result stored directly in checkpoint
			timestamp: Date.now(),
			ttl: this.config.defaultTTL,
			sizeBytes,
		};
	}

	/**
	 * Save a checkpoint to cache (immediate persist)
	 * Note: For normal operation, use bufferResult() + persistAll() pattern instead
	 */
	async save(checkpoint: Checkpoint): Promise<void> {
		const key = this.getCheckpointKey(checkpoint.id);

		try {
			await this.cache.set(key, checkpoint, checkpoint.ttl || this.config.defaultTTL);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new OperationCheckpointError(
				`Failed to save checkpoint: ${message}`,
				checkpoint.id,
				'save'
			);
		}
	}

	/**
	 * Buffer a result in memory (does NOT persist to cache)
	 * Use persistAll() to flush buffered checkpoints on error
	 * This is the preferred method for transformed code
	 * Note: This is synchronous - no await needed in generated code
	 */
	bufferResult(
		checkpointId: string,
		result: unknown,
		metadata: OperationMetadata
	): void {
		if (!this.config.enabled) {
			return;
		}

		try {
			const checkpoint = this.createCheckpoint(checkpointId, result, metadata);
			// Only store in memory, don't persist to cache yet
			this.checkpoints.set(checkpointId, checkpoint);
		} catch (error) {
			// Checkpoint buffer failures shouldn't break execution
			console.warn(`Failed to buffer checkpoint ${checkpointId}:`, error);
		}
	}

	/**
	 * Persist all buffered checkpoints to cache
	 * Called when an error occurs to save checkpoints for recovery
	 */
	async persistAll(): Promise<void> {
		const checkpointsToPersist = Array.from(this.checkpoints.values());
		
		if (checkpointsToPersist.length === 0) {
			return;
		}

		const results = await Promise.allSettled(
			checkpointsToPersist.map((checkpoint) => this.save(checkpoint))
		);

		// Log any failures but don't throw
		const failures = results.filter((r) => r.status === 'rejected');
		if (failures.length > 0) {
			console.warn(`Failed to persist ${failures.length} checkpoints`);
		}
	}

	/**
	 * Load a checkpoint from cache
	 */
	async load(checkpointId: string): Promise<Checkpoint | null> {
		const key = this.getCheckpointKey(checkpointId);

		try {
			const checkpoint = await this.cache.get<Checkpoint>(key);
			return checkpoint || null;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new OperationCheckpointError(
				`Failed to load checkpoint: ${message}`,
				checkpointId,
				'load'
			);
		}
	}

	/**
	 * Load a checkpoint from a different execution (for cross-execution recovery)
	 */
	async loadFromExecution(checkpointId: string, executionId: string): Promise<Checkpoint | null> {
		const key = `${this.prefix}:${executionId}:${checkpointId}`;

		try {
			const checkpoint = await this.cache.get<Checkpoint>(key);
			return checkpoint || null;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new OperationCheckpointError(
				`Failed to load checkpoint from execution ${executionId}: ${message}`,
				checkpointId,
				'load'
			);
		}
	}

	/**
	 * Restore the result from a checkpoint
	 * Both full snapshot and reference checkpoints store the result directly
	 */
	restore(checkpoint: Checkpoint): unknown {
		if (checkpoint.type === CheckpointType.FULL_SNAPSHOT) {
			return (checkpoint as FullSnapshotCheckpoint).result;
		} else {
			return (checkpoint as ReferenceCheckpoint).result;
		}
	}

	/**
	 * Get all checkpoints created during this execution
	 */
	getAllCheckpoints(): CheckpointInfo[] {
		return Array.from(this.checkpoints.values()).map((cp) =>
			this.checkpointToInfo(cp)
		);
	}

	/**
	 * Convert checkpoint to info format for error responses
	 * Returns full checkpoint ID that includes execution ID for easy restore
	 */
	private checkpointToInfo(checkpoint: Checkpoint): CheckpointInfo {
		const operation = this.formatOperation(checkpoint.operation);
		const description = this.strategy.generateDescription(
			checkpoint.type === CheckpointType.FULL_SNAPSHOT
				? (checkpoint as FullSnapshotCheckpoint).result
				: (checkpoint as ReferenceCheckpoint).reference,
			checkpoint.operation
		);

		// Use full ID format: {executionId}:{shortId} for easy cross-execution restore
		const fullId = this.getFullCheckpointId(checkpoint.id);

		const info: CheckpointInfo = {
			id: fullId,
			type: checkpoint.type,
			operation,
			description,
			timestamp: checkpoint.timestamp,
		};

		if (checkpoint.type === CheckpointType.FULL_SNAPSHOT) {
			info.result = (checkpoint as FullSnapshotCheckpoint).result;
		} else {
			// Update restoreCode to use the full ID
			const reference = (checkpoint as ReferenceCheckpoint).reference;
			info.reference = {
				...reference,
				restoreCode: reference.restoreCode.replace(checkpoint.id, fullId),
			};
		}

		return info;
	}

	/**
	 * Get the full checkpoint ID including execution ID
	 * Format: {executionId}:{shortId}
	 */
	getFullCheckpointId(shortId: string): string {
		return `${this.executionId}:${shortId}`;
	}

	/**
	 * Parse a full checkpoint ID to extract execution ID and short ID
	 * Returns null if the ID doesn't contain an execution ID
	 */
	static parseCheckpointId(fullId: string): { executionId: string; shortId: string } | null {
		// Format: {executionId}:{shortId}
		// executionId is typically a UUID (contains hyphens)
		// shortId is typically op_L{line}_C{col}
		const match = fullId.match(/^([^:]+):(.+)$/);
		if (!match || !match?.[1] || !match?.[2]) {
			return null;
		}
		return { executionId: match[1], shortId: match[2] };
	}

	/**
	 * Format operation metadata as a dot-notation string
	 */
	private formatOperation(metadata: OperationMetadata): string {
		const parts = [metadata.namespace];
		if (metadata.group) {
			parts.push(metadata.group);
		}
		parts.push(metadata.method);
		return parts.join('.');
	}

	/**
	 * Generate restore instructions for LLM
	 * Provides a clean summary of available checkpoints and how to use them
	 */
	generateRestoreInstructions(): string {
		const checkpoints = this.getAllCheckpoints();

		if (checkpoints.length === 0) {
			return 'No checkpoints available.';
		}

		const lines: string[] = [
			`${checkpoints.length} checkpoint${checkpoints.length > 1 ? 's' : ''} available from the failed execution:`,
			'',
		];

		for (const cp of checkpoints) {
			lines.push(`• ${cp.operation} → checkpoint id: "${cp.id}"`);
		}

		lines.push('');
		lines.push('In your next code iteration, you can:');
		lines.push('1. Directly use data returned from saved checkpoints (full_snapshot)');
		lines.push('2. Restore a checkpoint value programmatically using:');
		lines.push('  const value = await __restore.checkpoint("<checkpoint_id>");');
		lines.push('');

		return lines.join('\n');
	}

	/**
	 * Clear a specific checkpoint
	 */
	async clear(checkpointId: string): Promise<void> {
		const key = this.getCheckpointKey(checkpointId);

		try {
			await this.cache.delete(key);
			this.checkpoints.delete(checkpointId);
		} catch (error) {
			// Ignore errors during cleanup
		}
	}

	/**
	 * Clear all checkpoints for this execution
	 */
	async clearAll(): Promise<void> {
		const checkpointIds = Array.from(this.checkpoints.keys());
		await Promise.all(checkpointIds.map((id) => this.clear(id)));
	}

	/**
	 * Get statistics about checkpoints
	 */
	getStats() {
		const checkpoints = Array.from(this.checkpoints.values());
		const fullSnapshots = checkpoints.filter((cp) => cp.type === CheckpointType.FULL_SNAPSHOT);
		const references = checkpoints.filter((cp) => cp.type === CheckpointType.REFERENCE);

		const totalSize = checkpoints.reduce((sum, cp) => sum + (cp.sizeBytes || 0), 0);

		return {
			total: checkpoints.length,
			fullSnapshots: fullSnapshots.length,
			references: references.length,
			totalSizeBytes: totalSize,
		};
	}

	/**
	 * Generate cache key for a checkpoint
	 */
	private getCheckpointKey(checkpointId: string): string {
		return `${this.prefix}:${this.executionId}:${checkpointId}`;
	}

	/**
	 * Get execution ID
	 */
	getExecutionId(): string {
		return this.executionId;
	}
}

// Global instance management (similar to existing checkpoint-manager.ts)
let globalOperationCheckpointManager: OperationCheckpointManager | null = null;

/**
 * Set the global checkpoint manager for the current execution context
 */
export function setOperationCheckpointManager(manager: OperationCheckpointManager): void {
	globalOperationCheckpointManager = manager;
}

/**
 * Get the global checkpoint manager
 */
export function getOperationCheckpointManager(): OperationCheckpointManager {
	if (!globalOperationCheckpointManager) {
		throw new Error('OperationCheckpointManager not initialized');
	}
	return globalOperationCheckpointManager;
}

/**
 * Clear the global checkpoint manager
 */
export function clearOperationCheckpointManager(): void {
	globalOperationCheckpointManager = null;
}

/**
 * Check if checkpoint manager is initialized
 */
export function hasOperationCheckpointManager(): boolean {
	return globalOperationCheckpointManager !== null;
}

