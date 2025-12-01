import { nanoid } from 'nanoid';
import { log } from '@mondaydotcomorg/atp-runtime';
import type {
	ProvenanceMetadata,
	SourceMetadata,
	ReaderPermissions,
	ProvenanceState,
} from './types.js';
import { computeDigest } from './tokens.js';
import { type ProvenanceStore, InMemoryProvenanceStore } from './store.js';

const PROVENANCE_KEY = '__provenance__';
const PROVENANCE_ID_KEY = '__prov_id__';
const provenanceStore = new WeakMap<object, ProvenanceMetadata>();

const provenanceRegistry = new Map<string, ProvenanceMetadata>();

const executionProvenanceIds = new Map<string, Set<string>>();

let currentExecutionId: string | null = null;

const primitiveProvenanceMap = new Map<string, ProvenanceMetadata>();

const executionTaintedPrimitives = new Map<string, Set<unknown>>();

let globalStore: ProvenanceStore = new InMemoryProvenanceStore();

/**
 * Set the global provenance store implementation
 */
export function setGlobalProvenanceStore(store: ProvenanceStore): void {
	globalStore = store;
}

/**
 * Mark a primitive value as tainted (derived from tool data)
 * Used by AST mode to track derived values
 */
export function markPrimitiveTainted(value: unknown, sourceMetadata: ProvenanceMetadata): void {
	if (typeof value !== 'string' && typeof value !== 'number') {
		return;
	}

	if (currentExecutionId) {
		const tainted = executionTaintedPrimitives.get(currentExecutionId);
		if (tainted) {
			tainted.add(value);
		}
	}

	const key = `tainted:${String(value)}`;
	primitiveProvenanceMap.set(key, sourceMetadata);

	globalStore.setPrimitive(key, sourceMetadata, currentExecutionId || undefined).catch((err) => {
		log.warn('Failed to save primitive taint to provenance store', { error: err });
	});
}

/**
 * Check if a primitive is tainted (derived from tool data)
 */
export function isPrimitiveTainted(value: unknown): boolean {
	if (typeof value !== 'string' && typeof value !== 'number') {
		return false;
	}

	if (currentExecutionId) {
		const tainted = executionTaintedPrimitives.get(currentExecutionId);
		if (tainted && tainted.has(value)) {
			return true;
		}
	}

	return false;
}

/**
 * Set the current execution ID for provenance tracking
 * MUST be called at start of each execution to prevent memory leaks
 */
export function setProvenanceExecutionId(executionId: string): void {
	currentExecutionId = executionId;
	if (!executionProvenanceIds.has(executionId)) {
		executionProvenanceIds.set(executionId, new Set());
	}
	if (!executionTaintedPrimitives.has(executionId)) {
		executionTaintedPrimitives.set(executionId, new Set());
	}
}

/**
 * Clear the current execution ID
 */
export function clearProvenanceExecutionId(): void {
	currentExecutionId = null;
}

/**
 * Hydrate provenance metadata for an execution (Multi-pod support)
 * Call this when resuming an execution on a new pod to warm up the local cache
 */
export async function hydrateProvenance(ids: string[]): Promise<void> {
	const batch = await globalStore.getBatch(ids);
	for (const [id, metadata] of batch.entries()) {
		provenanceRegistry.set(id, metadata);
		if (currentExecutionId) {
			let execIds = executionProvenanceIds.get(currentExecutionId);
			if (!execIds) {
				execIds = new Set();
				executionProvenanceIds.set(currentExecutionId, execIds);
			}
			execIds.add(id);
		}
	}
}

/**
 * Hydrate all provenance for a specific execution ID (if store supports tracking by execution)
 * Note: Standard InMemoryProvenanceStore tracks execution IDs, but Redis implementations might need explicit sets
 */
export async function hydrateExecutionProvenance(executionId: string): Promise<void> {
	const batch = await globalStore.getExecution(executionId);
	for (const [id, metadata] of batch.entries()) {
		provenanceRegistry.set(id, metadata);

		// Also track in current execution context (re-bind to new execution scope if needed)
		// Or just ensure it's in registry for reading.
		// Typically, we just want it available for reading.
		// If we want to ensure cleanup works for the *new* resumed execution, we might need to track it.
		// But usually resumed execution has same ID?
		// If executionId passed here IS the currentExecutionId, we track it.

		if (currentExecutionId === executionId) {
			let executionSet = executionProvenanceIds.get(executionId);
			if (!executionSet) {
				executionSet = new Set();
				executionProvenanceIds.set(executionId, executionSet);
			}
			executionSet.add(id);
		}
	}
}

/**
 * Register provenance metadata directly (for AST tracking in isolated-vm)
 */
export function registerProvenanceMetadata(
	id: string,
	metadata: ProvenanceMetadata,
	executionId?: string
): void {
	if (id.startsWith('tainted:') || id.includes(':')) {
		primitiveProvenanceMap.set(id, metadata);

		globalStore.setPrimitive(id, metadata, executionId).catch((err) => {
			log.warn('Failed to save primitive provenance to store', { error: err });
		});

		if (id.startsWith('tainted:')) {
			const value = id.slice('tainted:'.length);
			if (executionId) {
				let tainted = executionTaintedPrimitives.get(executionId);
				if (!tainted) {
					tainted = new Set();
					executionTaintedPrimitives.set(executionId, tainted);
				}
				tainted.add(value);
			}
		}
	} else {
		provenanceRegistry.set(id, metadata);
		globalStore.set(id, metadata, executionId).catch((err) => {
			log.warn('Failed to save provenance to store', { error: err });
		});
	}

	if (executionId) {
		let ids = executionProvenanceIds.get(executionId);
		if (!ids) {
			ids = new Set();
			executionProvenanceIds.set(executionId, ids);
		}
		ids.add(id);
	}
}

/**
 * Cleanup provenance for a specific execution to prevent memory leaks
 * MUST be called after execution completes or fails
 */
export function cleanupProvenanceForExecution(executionId: string): void {
	const ids = executionProvenanceIds.get(executionId);
	if (ids) {
		for (const id of ids) {
			provenanceRegistry.delete(id);
			const keysToDelete: string[] = [];
			for (const key of primitiveProvenanceMap.keys()) {
				if (key.startsWith(`${id}:`) || key.startsWith('tainted:')) {
					keysToDelete.push(key);
				}
			}
			for (const key of keysToDelete) {
				primitiveProvenanceMap.delete(key);
			}
		}
		executionProvenanceIds.delete(executionId);
	}

	executionTaintedPrimitives.delete(executionId);

	// Cleanup from persistent store
	globalStore.cleanupExecution(executionId).catch((err) => {
		log.warn('Failed to cleanup provenance store', { error: err });
	});
}

/**
 * Check if a primitive value was extracted from a provenance-tracked object
 * This catches: const ssn = user.ssn; await send({ body: ssn })
 * Also checks if value is marked as tainted (AST mode)
 */
export function getProvenanceForPrimitive(value: unknown): ProvenanceMetadata | null {
	if (typeof value !== 'string' && typeof value !== 'number') {
		return null;
	}

	const valueStr = String(value);

	if (isPrimitiveTainted(value)) {
		const taintedKey = `tainted:${valueStr}`;
		const metadata = primitiveProvenanceMap.get(taintedKey);
		if (metadata) {
			return metadata;
		}
	}

	const taintedKey = `tainted:${valueStr}`;
	const taintedMetadata = primitiveProvenanceMap.get(taintedKey);
	if (taintedMetadata) {
		return taintedMetadata;
	}

	for (const [key, metadata] of primitiveProvenanceMap.entries()) {
		const parts = key.split(':');
		if (parts.length >= 3 && !key.startsWith('tainted:')) {
			const primitiveValue = parts.slice(2).join(':');
			if (primitiveValue === valueStr) {
				return metadata;
			}
		}
	}

	const digest = computeDigest(value);
	if (digest) {
		const digestMetadata = provenanceRegistry.get(digest);
		if (digestMetadata) {
			return digestMetadata;
		}
	}

	return null;
}

/**
 * Capture provenance state for pause/resume
 */
export function captureProvenanceState(executionId: string): Map<string, ProvenanceMetadata> {
	const state = new Map<string, ProvenanceMetadata>();
	const ids = executionProvenanceIds.get(executionId);
	if (ids) {
		for (const id of ids) {
			const metadata = provenanceRegistry.get(id);
			if (metadata) {
				state.set(id, metadata);
			}
		}
	}
	return state;
}

/**
 * Capture provenance snapshot including primitive taints for multi-step token persistence
 */
export function captureProvenanceSnapshot(executionId: string): {
	registry: Array<[string, ProvenanceMetadata]>;
	primitives: Array<[string, ProvenanceMetadata]>;
} {
	const registryMap = captureProvenanceState(executionId);
	const registry = Array.from(registryMap.entries());

	const primitives: Array<[string, ProvenanceMetadata]> = [];
	const ids = executionProvenanceIds.get(executionId) || new Set<string>();

	const tainted = executionTaintedPrimitives.get(executionId);
	if (tainted) {
		for (const value of tainted) {
			const key = `tainted:${String(value)}`;
			const meta = primitiveProvenanceMap.get(key);
			if (meta) {
				primitives.push([key, meta]);
			}
		}
	}

	for (const [key, meta] of primitiveProvenanceMap.entries()) {
		if (key.startsWith('tainted:')) {
			continue;
		}
		const [first] = key.split(':');
		if (first && ids.has(first)) {
			primitives.push([key, meta]);
		}
	}

	return { registry, primitives };
}

/**
 * Restore provenance state after resume
 */
export function restoreProvenanceState(
	executionId: string,
	state: Map<string, ProvenanceMetadata>
): void {
	setProvenanceExecutionId(executionId);
	const ids = executionProvenanceIds.get(executionId)!;

	for (const [id, metadata] of state) {
		provenanceRegistry.set(id, metadata);
		ids.add(id);
		globalStore.set(id, metadata, executionId).catch((err) => {
			log.error('Failed to save provenance to store', { error: err });
		});
	}
}

/**
 * Restore provenance snapshot including primitive taints for multi-step token persistence
 */
export function restoreProvenanceSnapshot(
	executionId: string,
	snapshot: {
		registry: Array<[string, ProvenanceMetadata]>;
		primitives: Array<[string, ProvenanceMetadata]>;
	}
): void {
	const registryMap = new Map(snapshot.registry);
	restoreProvenanceState(executionId, registryMap);

	for (const [key, meta] of snapshot.primitives) {
		primitiveProvenanceMap.set(key, meta);
		globalStore.setPrimitive(key, meta, executionId).catch((err) => {
			log.error('Failed to save primitive provenance to store', { error: err });
		});

		if (key.startsWith('tainted:')) {
			const value = key.slice('tainted:'.length);
			let set = executionTaintedPrimitives.get(executionId);
			if (!set) {
				set = new Set();
				executionTaintedPrimitives.set(executionId, set);
			}
			set.add(value);
		}
	}
}

/**
 * Create a provenance-tracked value
 * SOLUTION: Store metadata in global registry, attach only ID to object
 * The ID (simple string) SURVIVES isolated-vm cloning
 *
 * For objects, also wraps in Proxy to track primitive extractions
 */
export function createProvenanceProxy<T>(
	value: T,
	source: SourceMetadata,
	readers: ReaderPermissions = { type: 'public' },
	dependencies: string[] = []
): T {
	if (value === null || value === undefined) {
		return value;
	}

	if (typeof value !== 'object' && typeof value !== 'function') {
		return value;
	}

	const id = nanoid();
	const metadata: ProvenanceMetadata = {
		id,
		source,
		readers,
		dependencies,
		context: {},
	};

	provenanceRegistry.set(id, metadata);

	if (currentExecutionId) {
		const ids = executionProvenanceIds.get(currentExecutionId);
		if (ids) {
			ids.add(id);
		}
	}

	globalStore.set(id, metadata, currentExecutionId || undefined).catch((err) => {
		log.warn('Failed to persist provenance to store', { error: err });
	});

	try {
		Object.defineProperty(value, PROVENANCE_ID_KEY, {
			value: id,
			writable: false,
			enumerable: true,
			configurable: true,
			// @ts-ignore
			__proto__: null,
		});
	} catch (e) {
		provenanceStore.set(value as object, metadata);
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			if (typeof item === 'object' && item !== null && !hasProvenance(item)) {
				createProvenanceProxy(item, source, readers, [id, ...dependencies]);
			}
		}
	} else if (typeof value === 'object') {
		for (const key in value as Record<string, unknown>) {
			if (Object.prototype.hasOwnProperty.call(value, key) && key !== PROVENANCE_ID_KEY) {
				const nestedValue = (value as Record<string, unknown>)[key];
				if (
					typeof nestedValue === 'object' &&
					nestedValue !== null &&
					!hasProvenance(nestedValue)
				) {
					createProvenanceProxy(nestedValue, source, readers, [id, ...dependencies]);
				} else if (typeof nestedValue === 'string' || typeof nestedValue === 'number') {
					const primitiveKey = `${id}:${key}:${String(nestedValue)}`;
					primitiveProvenanceMap.set(primitiveKey, metadata);
					globalStore
						.setPrimitive(primitiveKey, metadata, currentExecutionId || undefined)
						.catch((err) => {
							log.error('Failed to save primitive provenance to store', { error: err });
						});
				}
			}
		}
	}

	return value;
}

/**
 * Get provenance metadata from a value
 * Looks up by ID from global registry (survives isolated-vm cloning)
 */
export function getProvenance(value: unknown): ProvenanceMetadata | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === 'string' || typeof value === 'number') {
		const primitiveProvenance = getProvenanceForPrimitive(value);
		if (primitiveProvenance) {
			return primitiveProvenance;
		}
	}

	if (typeof value === 'object') {
		const id = (value as any)[PROVENANCE_ID_KEY];
		if (id && typeof id === 'string') {
			const metadata = provenanceRegistry.get(id);
			if (metadata) {
				return metadata;
			}
		}

		if (PROVENANCE_KEY in (value as any)) {
			return (value as any)[PROVENANCE_KEY];
		}

		const stored = provenanceStore.get(value as object);
		if (stored) {
			return stored;
		}
	}

	return null;
}

/**
 * Check if a value has provenance tracking
 */
export function hasProvenance(value: unknown): boolean {
	return getProvenance(value) !== null;
}

/**
 * Get all provenance metadata in an object recursively
 */
export function getAllProvenance(value: unknown, visited = new Set<any>()): ProvenanceMetadata[] {
	if (value === null || value === undefined || typeof value !== 'object') {
		return [];
	}

	if (visited.has(value)) {
		return [];
	}
	visited.add(value);

	const results: ProvenanceMetadata[] = [];
	const metadata = getProvenance(value);

	if (metadata) {
		results.push(metadata);
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			results.push(...getAllProvenance(item, visited));
		}
	} else if (typeof value === 'object') {
		for (const key in value) {
			if (
				key !== PROVENANCE_KEY &&
				key !== PROVENANCE_ID_KEY &&
				Object.prototype.hasOwnProperty.call(value, key)
			) {
				results.push(...getAllProvenance((value as any)[key], visited));
			}
		}
	}

	return results;
}

/**
 * Merge reader permissions (intersection for security)
 */
export function mergeReaders(
	readers1: ReaderPermissions,
	readers2: ReaderPermissions
): ReaderPermissions {
	if (readers1.type === 'public') {
		return readers2;
	}
	if (readers2.type === 'public') {
		return readers1;
	}

	const intersection = readers1.readers.filter((r: string) => readers2.readers.includes(r));
	return { type: 'restricted', readers: intersection };
}

/**
 * Check if a reader can access data with given permissions
 */
export function canRead(reader: string, permissions: ReaderPermissions): boolean {
	if (permissions.type === 'public') {
		return true;
	}
	return permissions.readers.includes(reader);
}

/**
 * Extract provenance for serialization (pause/resume)
 */
export function extractProvenanceMap(
	sandbox: Record<string, unknown>
): Map<string, ProvenanceMetadata> {
	const provenanceMap = new Map<string, ProvenanceMetadata>();
	const visited = new Set<any>();

	function traverse(value: unknown, path: string = '') {
		if (value === null || value === undefined || typeof value !== 'object') {
			return;
		}

		if (visited.has(value)) {
			return;
		}
		visited.add(value);

		const metadata = getProvenance(value);
		if (metadata) {
			provenanceMap.set(path || metadata.id, metadata);
		}

		if (Array.isArray(value)) {
			value.forEach((item, index) => {
				traverse(item, `${path}[${index}]`);
			});
		} else if (typeof value === 'object') {
			for (const key in value) {
				if (Object.prototype.hasOwnProperty.call(value, key)) {
					traverse((value as any)[key], path ? `${path}.${key}` : key);
				}
			}
		}
	}

	for (const [key, value] of Object.entries(sandbox)) {
		traverse(value, key);
	}

	return provenanceMap;
}

/**
 * Restore provenance from serialized state
 */
export function restoreProvenanceMap(
	provenanceMap: Map<string, ProvenanceMetadata>,
	sandbox: Record<string, unknown>
): void {
	for (const [path, metadata] of provenanceMap.entries()) {
		const value = resolvePath(sandbox, path);
		if (value !== undefined && typeof value === 'object') {
			provenanceStore.set(value as object, metadata);
		}
	}
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(/[\.\[]/).map((p) => p.replace(/\]$/, ''));
	let current: any = obj;

	for (const part of parts) {
		if (current === null || current === undefined) {
			return undefined;
		}
		current = current[part];
	}

	return current;
}
