/**
 * Checkpoint Strategy Implementation
 * 
 * Decides whether to store full snapshots or references based on result size
 * and structure. Generates previews for large data to show to LLM.
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
	 * Full snapshots are used for small, serializable results.
	 * References are used for large results (preview shown to LLM, full data available via restore).
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
	 * Creates a reference object containing summary information about the result.
	 * Used when the result is too large for a full snapshot.
	 */
	createReference(result: unknown, metadata: OperationMetadata): CheckpointReference {
		const description = this.generateDescription(result, metadata);
		const preview = this.generatePreview(result);
		const count = this.getCount(result);
		const keys = this.extractKeys(result);
		const restoreCode = `await __restore.checkpoint("{{CHECKPOINT_ID}}")`;

		return {
			description,
			preview,
			count,
			keys,
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
	 * Generates a preview of the result.
	 * For arrays: shows first N items (each item also previewed if object/array)
	 * For objects: shows all keys with previewed values
	 */
	private generatePreview(result: unknown): unknown {
		if (result === null || result === undefined) {
			return result;
		}

		if (Array.isArray(result)) {
			return this.previewArray(result);
		}

		if (typeof result === 'object') {
			return this.previewObject(result as Record<string, unknown>);
		}

		if (typeof result === 'string' && result.length > 100) {
			return result.substring(0, 100) + '...';
		}

		return result;
	}

	/**
	 * Preview an array: show first N items (default 3), preview object items using previewObject
	 */
	private previewArray(arr: unknown[]): unknown {
		const previewSize = this.config.previewSize;
		const previewItems = arr.slice(0, previewSize);
		
		const preview = previewItems.map((item) => {
			if (item === null || item === undefined) {
				return item;
			}
			if (Array.isArray(item)) {
				// For nested arrays, show count
				return `[Array(${item.length})]`;
			}
			if (typeof item === 'object') {
				// For nested objects, use previewObject to show first 3 keys
				return this.previewObject(item as Record<string, unknown>);
			}
			if (typeof item === 'string' && item.length > 50) {
				return item.substring(0, 50) + '...';
			}
			return item;
		});

		// Add indicator if there are more items
		if (arr.length > previewSize) {
			return [...preview, `... and ${arr.length - previewSize} more`];
		}

		return preview;
	}

	/**
	 * Preview an object: show first 3 keys with previewed values, then list remaining keys
	 */
	private previewObject(obj: Record<string, unknown>): Record<string, unknown> {
		const keys = Object.keys(obj);
		const previewSize = this.config.previewSize;
		const previewKeys = keys.slice(0, previewSize);
		const remainingKeys = keys.slice(previewSize);

		const preview: Record<string, unknown> = {};

		// Show first N keys with previewed values
		for (const key of previewKeys) {
			preview[key] = this.previewValue(obj[key]);
		}

		// List remaining keys if any (similar to previewArray pattern)
		if (remainingKeys.length > 0) {
			const remainingKeysList = remainingKeys.slice(0, 10);
			const moreCount = remainingKeys.length > 10 ? remainingKeys.length - 10 : 0;
			if (moreCount > 0) {
				preview['...'] = `${remainingKeysList.join(', ')}, ... and ${moreCount} more keys`;
			} else {
				preview['...'] = `${remainingKeysList.join(', ')}${remainingKeys.length > 1 ? ' (and more)' : ''}`;
			}
		}

		return preview;
	}

	/**
	 * Preview a single value (handles arrays/objects/strings)
	 */
	private previewValue(value: unknown): unknown {
		if (value === null || value === undefined) {
			return value;
		}

		if (Array.isArray(value)) {
			// For arrays within objects, show first few items
			const previewSize = this.config.previewSize;
			if (value.length <= previewSize) {
				return value.map((item) => {
					if (typeof item === 'object' && item !== null) {
						return this.previewObject(item as Record<string, unknown>);
					}
					return item;
				});
			}
			// Large array - show first N items
			const preview = value.slice(0, previewSize).map((item) => {
				if (typeof item === 'object' && item !== null) {
					return this.previewObject(item as Record<string, unknown>);
				}
				return item;
			});
			return [...preview, `... and ${value.length - previewSize} more`];
		}

		if (typeof value === 'object') {
			// Nested object - use previewObject to show first 3 keys
			return this.previewObject(value as Record<string, unknown>);
		}

		if (typeof value === 'string' && value.length > 100) {
			return value.substring(0, 100) + '...';
		}

		return value;
	}

	/**
	 * Returns the count of items (for arrays) or properties (for objects).
	 */
	private getCount(result: unknown): number | undefined {
		if (Array.isArray(result)) {
			return result.length;
		}

		if (result && typeof result === 'object') {
			return Object.keys(result).length;
		}

		return undefined;
	}

	/**
	 * Extracts keys for reference metadata.
	 */
	private extractKeys(result: unknown): string[] | undefined {
		if (Array.isArray(result)) {
			return undefined; // Arrays don't have named keys
		}

		if (result && typeof result === 'object') {
			return Object.keys(result as object);
		}

		return undefined;
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

