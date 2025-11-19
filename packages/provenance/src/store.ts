import type { ProvenanceMetadata } from './types.js';

/**
 * Interface for Provenance Storage (supports distributed/async)
 */
export interface ProvenanceStore {
	/**
	 * Get metadata by ID
	 */
	get(id: string): Promise<ProvenanceMetadata | null>;

	/**
	 * Get multiple metadata items by ID
	 */
	getBatch(ids: string[]): Promise<Map<string, ProvenanceMetadata>>;

	/**
	 * Save metadata
	 */
	set(id: string, metadata: ProvenanceMetadata, executionId?: string): Promise<void>;

	/**
	 * Get primitive metadata by key
	 */
	getPrimitive(key: string): Promise<ProvenanceMetadata | null>;

	/**
	 * Save primitive metadata
	 */
	setPrimitive(key: string, metadata: ProvenanceMetadata, executionId?: string): Promise<void>;

	/**
	 * Cleanup all data associated with an execution ID
	 */
	cleanupExecution(executionId: string): Promise<void>;

	/**
	 * Get all provenance metadata associated with an execution ID
	 * Used for hydrating a new pod when resuming execution
	 */
	getExecution(executionId: string): Promise<Map<string, ProvenanceMetadata>>;
}

/**
 * In-Memory implementation of ProvenanceStore (Default)
 * Acts as a monolithic store (like the original implementation)
 */
export class InMemoryProvenanceStore implements ProvenanceStore {
	private registry = new Map<string, ProvenanceMetadata>();
	private primitives = new Map<string, ProvenanceMetadata>();
	private executionIds = new Map<string, Set<string>>();
	private executionPrimitives = new Map<string, Set<string>>();

	async get(id: string): Promise<ProvenanceMetadata | null> {
		return this.registry.get(id) || null;
	}

	async getBatch(ids: string[]): Promise<Map<string, ProvenanceMetadata>> {
		const result = new Map<string, ProvenanceMetadata>();
		for (const id of ids) {
			const meta = this.registry.get(id);
			if (meta) {
				result.set(id, meta);
			}
		}
		return result;
	}

	async set(id: string, metadata: ProvenanceMetadata, executionId?: string): Promise<void> {
		this.registry.set(id, metadata);

		if (executionId) {
			let ids = this.executionIds.get(executionId);
			if (!ids) {
				ids = new Set();
				this.executionIds.set(executionId, ids);
			}
			ids.add(id);
		}
	}

	async getPrimitive(key: string): Promise<ProvenanceMetadata | null> {
		return this.primitives.get(key) || null;
	}

	async setPrimitive(
		key: string,
		metadata: ProvenanceMetadata,
		executionId?: string
	): Promise<void> {
		this.primitives.set(key, metadata);

		if (executionId) {
			let keys = this.executionPrimitives.get(executionId);
			if (!keys) {
				keys = new Set();
				this.executionPrimitives.set(executionId, keys);
			}
			keys.add(key);
		}
	}

	async cleanupExecution(executionId: string): Promise<void> {
		const ids = this.executionIds.get(executionId);
		if (ids) {
			for (const id of ids) {
				this.registry.delete(id);
			}
			this.executionIds.delete(executionId);
		}

		const primKeys = this.executionPrimitives.get(executionId);
		if (primKeys) {
			for (const key of primKeys) {
				this.primitives.delete(key);
			}
			this.executionPrimitives.delete(executionId);
		}
	}

	async getExecution(executionId: string): Promise<Map<string, ProvenanceMetadata>> {
		const result = new Map<string, ProvenanceMetadata>();
		const ids = this.executionIds.get(executionId);
		if (ids) {
			for (const id of ids) {
				const meta = this.registry.get(id);
				if (meta) {
					result.set(id, meta);
				}
			}
		}
		return result;
	}
}
