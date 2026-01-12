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
	CheckpointConfig,
	CheckpointProvenanceSnapshot,
	CheckpointProvenanceEntry,
} from './checkpoint-types.js';
import { CheckpointType, OperationCheckpointError } from './checkpoint-types.js';
import { DEFAULT_CHECKPOINT_CONFIG } from './checkpoint-types.js';
import { DefaultCheckpointStrategy } from './checkpoint-strategy.js';
import {
	extractProvenanceRecursive,
	restoreProvenanceFromSnapshot,
	hasRestrictedProvenance,
	PROVENANCE_PROPERTY_NAMES,
	type ProvenanceExtractor,
	type ProvenanceAttacher,
} from '@mondaydotcomorg/atp-provenance';

/**
 * Sanitize data by removing internal provenance metadata properties
 * Recursively processes objects and arrays to remove __provenance__, __prov_id__, __prov_meta__
 */
function sanitizeProvenanceMetadata(value: unknown): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	// Handle arrays
	if (Array.isArray(value)) {
		return value.map(item => sanitizeProvenanceMetadata(item));
	}

	// Handle objects
	if (typeof value === 'object') {
		const sanitized: Record<string, unknown> = {};
		
		for (const [key, val] of Object.entries(value)) {
			// Skip all provenance metadata properties
			if (
				key === PROVENANCE_PROPERTY_NAMES.PROVENANCE ||
				key === PROVENANCE_PROPERTY_NAMES.PROVENANCE_ID ||
				key === PROVENANCE_PROPERTY_NAMES.PROVENANCE_META
			) {
				continue;
			}
			
			// Recursively sanitize nested values
			sanitized[key] = sanitizeProvenanceMetadata(val);
		}
		
		return sanitized;
	}

	// Primitives pass through unchanged
	return value;
}

/**
 * Function type for extracting provenance from a value
 * This is injected at runtime to decouple from @mondaydotcomorg/atp-provenance
 * Re-exported from provenance package for convenience
 */
export type { ProvenanceExtractor };

/**
 * Function type for re-attaching provenance to a restored value
 * This is injected at runtime to decouple from @mondaydotcomorg/atp-provenance
 * Re-exported from provenance package for convenience
 */
export type { ProvenanceAttacher };

/**
 * Function type for attaching __prov_meta__ to objects before checkpoint buffering
 * This ensures provenance survives isolated-vm boundary crossing during restoration
 */
export type ProvenanceMetaAttacher = (value: unknown) => void;

/**
 * Manages operation-level checkpoints for an execution
 */
export class OperationCheckpointManager {
	private cache: CacheProvider;
	readonly executionId: string;
	private strategy: DefaultCheckpointStrategy;
	private config: Required<Omit<CheckpointConfig, 'strategy'>>;
	private checkpoints: Map<string, Checkpoint> = new Map();
	private prefix: string;
	
	/**
	 * Optional provenance extractor - injected at runtime
	 * If not set, checkpoints will not capture provenance
	 */
	private provenanceExtractor?: ProvenanceExtractor;
	
	/**
	 * Optional provenance attacher - injected at runtime
	 * If not set, restored values will not have provenance re-attached
	 */
	private provenanceAttacher?: ProvenanceAttacher;

	/**
	 * Optional function to attach __prov_meta__ before buffering
	 * This ensures provenance survives isolated-vm boundary crossing
	 */
	private provenanceMetaAttacher?: ProvenanceMetaAttacher;

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
		this.strategy = (config?.strategy as DefaultCheckpointStrategy) || new DefaultCheckpointStrategy(config);
		this.prefix = 'op_checkpoint';
	}

	/**
	 * Set the provenance extractor function
	 * Should be called during initialization if provenance tracking is enabled
	 */
	setProvenanceExtractor(extractor: ProvenanceExtractor): void {
		this.provenanceExtractor = extractor;
	}

	/**
	 * Set the provenance attacher function
	 * Should be called during initialization if provenance tracking is enabled
	 */
	setProvenanceAttacher(attacher: ProvenanceAttacher): void {
		this.provenanceAttacher = attacher;
	}

	/**
	 * Set the provenance meta attacher function
	 */
	setProvenanceMetaAttacher(attacher: ProvenanceMetaAttacher): void {
		this.provenanceMetaAttacher = attacher;
	}

	/**
	 * Extract provenance from a result value
	 * Recursively extracts provenance from nested objects/arrays (for Promise.all, loops, etc.)
	 * Returns undefined if no provenance extractor is configured
	 * Delegates to provenance package's extractProvenanceRecursive
	 */
	private extractProvenance(result: unknown): CheckpointProvenanceSnapshot | undefined {
		if (!this.provenanceExtractor) {
			return undefined;
		}

		// Use the provenance package's extraction function
		const recursive = extractProvenanceRecursive(result, this.provenanceExtractor);
		
		if (recursive.entries.length === 0 && recursive.primitives.length === 0) {
			return undefined;
		}

		// Extract root-level metadata for convenient access
		const topLevel = recursive.entries.find(e => e.path === '');
		
		return {
			metadata: topLevel?.metadata,  // Convenience: direct access to root-level provenance
			entries: recursive.entries.length > 0 ? recursive.entries : undefined,
			primitives: recursive.primitives.length > 0 ? recursive.primitives : undefined,
			hasRestrictedData: recursive.hasRestrictedData,
		};
	}

	/**
	 * Create a checkpoint for an operation result (synchronous)
	 * Note: For reference checkpoints, the full result is stored in _pendingResult
	 * and persisted later via persistAll()
	 * 
	 * SECURITY: Captures provenance and forces reference checkpoint for restricted data
	 */
	private createCheckpoint(
		id: string,
		result: unknown,
		metadata: OperationMetadata
	): Checkpoint {
		// Extract provenance from the result (if provenance tracking is enabled)
		const provenance = this.extractProvenance(result);

		const useFullSnapshot = this.strategy.shouldUseFullSnapshot(result, provenance);

		if (useFullSnapshot) {
			return this.createFullSnapshot(id, result, metadata, provenance);
		} else {
			return this.createReference(id, result, metadata, provenance);
		}
	}

	/**
	 * Create a full snapshot checkpoint
	 * Note: This is only called for public data (restricted data uses reference)
	 */
	private createFullSnapshot(
		id: string,
		result: unknown,
		metadata: OperationMetadata,
		provenance?: CheckpointProvenanceSnapshot
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
			provenance, // Store provenance for re-attachment on restore
		};
	}

	/**
	 * Create a reference checkpoint
	 * Stores full result in checkpoint, but only shows preview to LLM in error responses
	 */
	private createReference(
		id: string,
		result: unknown,
		metadata: OperationMetadata,
		provenance?: CheckpointProvenanceSnapshot
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
			provenance, // Store provenance for re-attachment on restore
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
			if (this.provenanceMetaAttacher) {
				this.provenanceMetaAttacher(result);
			}
			
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
	 * Both full snapshot and reference checkpoints store the result directly\
	 * Provenance is re-attached if available
	 */
	restore(checkpoint: Checkpoint): unknown {
		let result: unknown;
		
		if (checkpoint.type === CheckpointType.FULL_SNAPSHOT) {
			result = (checkpoint as FullSnapshotCheckpoint).result;
		} else {
			result = (checkpoint as ReferenceCheckpoint).result;
		}

		// Use the provenance package's restoration function
		if (checkpoint.provenance && this.provenanceAttacher) {
			return restoreProvenanceFromSnapshot(result, checkpoint.provenance, this.provenanceAttacher);
		}

		return result;
	}

	/**
	 * Check if a checkpoint has restricted provenance
	 * Delegates to the provenance package's hasRestrictedProvenance utility
	 */
	hasRestrictedProvenance(checkpoint: Checkpoint): boolean {
		return hasRestrictedProvenance(checkpoint.provenance);
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
	 * 
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

		// Check if this checkpoint has any restricted provenance (including nested)
		const hasRestricted = this.hasRestrictedProvenance(checkpoint);

		const info: CheckpointInfo = {
			id: fullId,
			type: checkpoint.type,
			operation,
			description,
			timestamp: checkpoint.timestamp,
			hasRestrictedProvenance: hasRestricted || undefined,
			usedVariables: checkpoint.operation.usedVariables,
		};

		if (checkpoint.type === CheckpointType.FULL_SNAPSHOT) {
			// (This shouldn't happen as restricted data forces reference, but defense in depth)
			if (!hasRestricted) {
				// Sanitize provenance metadata before exposing to LLM
				info.result = sanitizeProvenanceMetadata((checkpoint as FullSnapshotCheckpoint).result);
			}
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
	 * For aggregate operations (loops, Promise.all), shows the underlying APIs used
	 */
	private formatOperation(metadata: OperationMetadata): string {
		// For aggregate operations (loop, parallel/Promise.all), extract underlying APIs
		// Check: type='loop' OR namespace='loop' OR namespace='Promise'
		const isAggregate = 
			(metadata.type as string) === 'loop' || 
			(metadata.type as string) === 'parallel' || 
			metadata.namespace === 'loop' || 
			metadata.namespace === 'Promise';
			
		if (isAggregate && metadata.params?.apis) {
			const apis = metadata.params.apis as string[];
			if (Array.isArray(apis) && apis.length > 0) {
				// Get unique APIs and join with " + "
				const uniqueApis = Array.from(new Set(apis));
				return uniqueApis.join(' + ');
			}
		}

		// Default formatting for single operations
		const parts = [metadata.namespace];
		if (metadata.group) {
			parts.push(metadata.group);
		}
		parts.push(metadata.method);
		return parts.join('.');
	}

	/**
	 * Generate restore instructions for LLM
	 * Provides a clean summary of available checkpoints with code snippets showing how to restore them
	 * Clarifies when to use full snapshot data inline vs when to use __restore.checkpoint()
	 */
	generateRestoreInstructions(): string {
		const checkpoints = this.getAllCheckpoints();

		if (checkpoints.length === 0) {
			return 'No checkpoints available.';
		}

		// Separate full snapshots from references
		const fullSnapshots = checkpoints.filter(cp => cp.type === CheckpointType.FULL_SNAPSHOT && cp.result !== undefined);
		const references = checkpoints.filter(cp => cp.type === CheckpointType.REFERENCE || cp.result === undefined);

		const lines: string[] = [
			`${checkpoints.length} checkpoint${checkpoints.length > 1 ? 's' : ''} available from the failed execution:`,
			'',
		];

		// Full snapshots - can use data directly
		if (fullSnapshots.length > 0) {
			lines.push('**Full Snapshot Checkpoints** (data available inline):');
			lines.push('');
			for (const cp of fullSnapshots) {
				const varNames = cp.usedVariables && cp.usedVariables.length > 0
					? cp.usedVariables
					: ['result'];

				// Sanitize result to remove provenance metadata before stringifying
				const sanitizedResult = sanitizeProvenanceMetadata(cp.result);

				lines.push(`Checkpoint: ${cp.operation}`);
				if (varNames.length === 1) {
					lines.push(`  const ${varNames[0]} = ${JSON.stringify(sanitizedResult)};`);
				} else {
					lines.push(`  const [${varNames.join(', ')}] = ${JSON.stringify(sanitizedResult)};`);
				}
				lines.push('');
			}
		}

		// References - must use restore
		if (references.length > 0) {
			lines.push('**Reference Checkpoints** (must use __restore.checkpoint):');
			lines.push('');
			for (const cp of references) {
				const varNames = cp.usedVariables && cp.usedVariables.length > 0
					? cp.usedVariables
					: ['result'];

				let restoreSnippet: string;
				if (varNames.length === 1) {
					restoreSnippet = `const ${varNames[0]} = await __restore.checkpoint("${cp.id}");`;
				} else {
					restoreSnippet = `const [${varNames.join(', ')}] = await __restore.checkpoint("${cp.id}");`;
				}

				lines.push(`Checkpoint: ${cp.operation}`);
				lines.push(`  ${restoreSnippet}`);
				lines.push('');
			}
		}

		lines.push('**Usage Guidelines:**');
		lines.push('• Full snapshot checkpoints: Copy the inline data directly into your code');
		lines.push('• Reference checkpoints: Use __restore.checkpoint() to access the data');

		return lines.join('\n');
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
}

/**
 * Map of executionId -> OperationCheckpointManager
 * Allows multiple concurrent executions to have isolated checkpoint managers
 */
const checkpointManagers = new Map<string, OperationCheckpointManager>();

/**
 * Current execution ID for checkpoint operations
 * Set by the executor at execution start
 */
let currentCheckpointExecutionId: string | null = null;

/**
 * Set the current execution ID for checkpoint operations
 */
export function setCheckpointExecutionId(executionId: string): void {
	currentCheckpointExecutionId = executionId;
}

/**
 * Clear the current execution ID
 */
export function clearCheckpointExecutionId(): void {
	currentCheckpointExecutionId = null;
}

/**
 * Set the checkpoint manager for a specific execution
 */
export function setOperationCheckpointManager(manager: OperationCheckpointManager): void {
	checkpointManagers.set(manager.executionId, manager);
}

/**
 * Get the checkpoint manager for the current or specified execution
 */
export function getOperationCheckpointManager(executionId?: string): OperationCheckpointManager {
	const id = executionId || currentCheckpointExecutionId;
	if (!id) {
		throw new Error('No execution ID set for checkpoint manager');
	}
	
	const manager = checkpointManagers.get(id);
	if (!manager) {
		throw new Error(`OperationCheckpointManager not initialized for execution: ${id}`);
	}
	return manager;
}

/**
 * Clear the checkpoint manager after execution completes
 */
export function clearOperationCheckpointManager(executionId?: string): void {
	const id = executionId || currentCheckpointExecutionId;
	if (!id) return;
	
	const manager = checkpointManagers.get(id);
	if (manager) {
		checkpointManagers.delete(id);
	}
}

/**
 * Check if checkpoint manager is initialized for current or specified execution
 */
export function hasOperationCheckpointManager(executionId?: string): boolean {
	const id = executionId || currentCheckpointExecutionId;
	if (!id) return false;
	return checkpointManagers.has(id);
}

