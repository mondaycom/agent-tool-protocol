/**
 * Checkpoint Strategy Implementation
 * 
 * Decides whether to store full snapshots or references based on result size
 * and structure. References require using __restore.checkpoint() to access data.
 */

import type {
	CheckpointStrategy,
	CheckpointReference,
	OperationMetadata,
	CheckpointConfig,
	CheckpointProvenanceSnapshot,
} from './checkpoint-types.js';
import { DEFAULT_CHECKPOINT_CONFIG } from './checkpoint-types.js';
import { hasRestrictedProvenance } from '@mondaydotcomorg/atp-provenance';

/**
 * Default strategy for checkpoint storage decisions
 */
export class DefaultCheckpointStrategy implements CheckpointStrategy {
	private config: Required<Omit<CheckpointConfig, 'strategy'>>;

	constructor(config?: CheckpointConfig) {
		this.config = {
			...DEFAULT_CHECKPOINT_CONFIG,
			...config,
		};
	}

	/**
	 * Determines whether to store the result as a full snapshot or a reference.
	 * Full snapshots are used for small, serializable results (data included in error response).
	 * References are used for large results (must use __restore.checkpoint() to access).
	 */
	shouldUseFullSnapshot(result: unknown, provenance?: CheckpointProvenanceSnapshot): boolean {
		if (this.hasRestrictedProvenance(provenance)) {
			return false;
		}

		if (result === null || result === undefined) {
			return true;
		}

		if (Array.isArray(result) && result.length > this.config.maxArrayItemsFull) {
			return false;
		}

		try {
			const serialized = JSON.stringify(result);
			const sizeBytes = new Blob([serialized]).size;

			if (sizeBytes < this.config.maxFullSnapshotSize) {
				return true;
			}
		} catch {
			// If serialization fails, use reference to be safe
			return false;
		}

		// Default to reference for anything that didn't match above rules
		return false;
	}

	/**
	 * Check if provenance indicates restricted access
	 * Delegates to the provenance package's hasRestrictedProvenance utility
	 */
	hasRestrictedProvenance(provenance?: CheckpointProvenanceSnapshot): boolean {
		return hasRestrictedProvenance(provenance);
	}

	/**
	 * Creates a reference object for a checkpoint.
	 * No preview data is included - user must use __restore.checkpoint() to access the data.
	 */
	createReference(result: unknown, metadata: OperationMetadata): CheckpointReference {
		const description = this.generateDescription(result, metadata);
		const restoreCode = `await __restore.checkpoint("{{CHECKPOINT_ID}}")`;

		return {
			description,
			restoreCode,
		};
	}

	/**
	 * Generates a simple description of the result type and size.
	 */
	generateDescription(result: unknown, metadata: OperationMetadata): string {
		const operationName = this.formatOperationName(metadata);

		if (result === null || result === undefined) {
			return `${operationName} returned ${result}`;
		}

		if (Array.isArray(result)) {
			return `Array with ${result.length} items from ${operationName}`;
		}

		if (typeof result === 'object') {
			const keys = Object.keys(result as object);
			return `Object with ${keys.length} ${keys.length !== 1 ? 'properties' : 'property'} from ${operationName}`;
		}

		if (typeof result === 'string') {
			return `String (${result.length} chars) from ${operationName}`;
		}

		return `${typeof result} from ${operationName}`;
	}

	/**
	 * Formats operation metadata as a dot-notation string (e.g., "api.github.getUser").
	 */
	private formatOperationName(metadata: OperationMetadata): string {
		const parts = [metadata.namespace];
		if (metadata.group) {
			parts.push(metadata.group);
		}
		parts.push(metadata.method);
		return parts.join('.');
	}
}

