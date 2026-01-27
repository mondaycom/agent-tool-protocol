/**
 * Checkpoint Integration Module
 * 
 * Provides utilities for integrating provenance tracking with checkpoint recovery.
 * This ensures security policies are enforced even after checkpoint restoration.
 */

import type { ProvenanceMetadata } from './types.js';
import { PROVENANCE_PROPERTY_NAMES } from './registry.js';

/**
 * Provenance entry with path information for nested object tracking
 * Used to re-attach provenance to the correct nested object on restore
 */
export interface ProvenanceEntry {
	/** JSON path to the value (e.g., "", "[0]", "[1].nested.field") */
	path: string;
	/** Provenance metadata for this value */
	metadata: ProvenanceMetadata;
}

/**
 * Provenance snapshot for checkpoint storage
 * Supports both simple and complex provenance scenarios:
 * - Simple: Single-source result (metadata field for convenience)
 * - Complex: Aggregated results with multiple sources (entries array with paths)
 * 
 * Example: Promise.all([getUser('alice'), getUser('bob')]) produces:
 * - metadata: undefined (or root-level container provenance if exists)
 * - entries: [
 *     { path: "[0]", metadata: { readers: ['alice'] } },
 *     { path: "[1]", metadata: { readers: ['bob'] } }
 *   ]
 */
export interface CheckpointProvenanceSnapshot {
	/** 
	 * Root-level provenance metadata for convenient access
	 * Populated when the result itself has provenance (path="")
	 * Also present in entries[] but duplicated here for ease of use
	 */
	metadata?: ProvenanceMetadata;
	
	/**
	 * All provenance entries with explicit paths
	 * Includes root-level (path="") and all nested objects with provenance
	 * Used for path-based restoration of aggregated/nested results
	 */
	entries?: ProvenanceEntry[];
	
	/** Primitive values with their provenance (for taint tracking) */
	primitives?: Array<[string, ProvenanceMetadata]>;
	
	/**
	 * Whether this checkpoint contains any restricted data
	 * Computed from all entries - if ANY entry has restricted readers, this is true
	 */
	hasRestrictedData?: boolean;
}

/**
 * Result of recursive provenance extraction
 */
interface RecursiveProvenanceResult {
	entries: ProvenanceEntry[];
	primitives: Array<[string, ProvenanceMetadata]>;
	hasRestrictedData: boolean;
}

/**
 * Function type for extracting provenance from a value
 */
export type ProvenanceExtractor = (value: unknown) => ProvenanceMetadata | null;

/**
 * Function type for re-attaching provenance to a restored value
 */
export type ProvenanceAttacher = (
	value: unknown,
	metadata: ProvenanceMetadata,
	primitives?: Array<[string, ProvenanceMetadata]>
) => unknown;

/**
 * Recursively extract provenance from nested objects/arrays
 * Handles: Promise.all results, loop aggregations, nested objects
 * 
 * Example paths:
 * - "" (root)
 * - "[0]", "[1]" (array elements)
 * - ".user", ".data.items[0]" (object properties)
 */
export function extractProvenanceRecursive(
	value: unknown,
	extractor: ProvenanceExtractor,
	path: string = '',
	visited: WeakSet<object> = new WeakSet()
): RecursiveProvenanceResult {
	const entries: ProvenanceEntry[] = [];
	const primitives: Array<[string, ProvenanceMetadata]> = [];
	let hasRestrictedData = false;

	if (value === null || value === undefined) {
		return { entries, primitives, hasRestrictedData };
	}

	// Handle primitives
	if (typeof value !== 'object') {
		// Check if primitive has taint
		const primMeta = extractor(value);
		if (primMeta) {
			primitives.push([`${path}:${String(value)}`, primMeta]);
			if (primMeta.readers?.type === 'restricted') {
				hasRestrictedData = true;
			}
		}
		return { entries, primitives, hasRestrictedData };
	}

	// Prevent circular references
	if (visited.has(value as object)) {
		return { entries, primitives, hasRestrictedData };
	}
	visited.add(value as object);

	// Check if this value has provenance
	const metadata = extractor(value);
	if (metadata) {
		entries.push({ path, metadata });
		if (metadata.readers?.type === 'restricted') {
			hasRestrictedData = true;
		}
	}

	// Recursively process arrays
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const itemPath = `${path}[${i}]`;
			const itemResult = extractProvenanceRecursive(value[i], extractor, itemPath, visited);
			entries.push(...itemResult.entries);
			primitives.push(...itemResult.primitives);
			if (itemResult.hasRestrictedData) {
				hasRestrictedData = true;
			}
		}
	} else {
		// Recursively process object properties
		for (const key of Object.keys(value)) {
			// Skip provenance metadata properties
			if (
				key === PROVENANCE_PROPERTY_NAMES.PROVENANCE_ID ||
				key === PROVENANCE_PROPERTY_NAMES.PROVENANCE ||
				key === PROVENANCE_PROPERTY_NAMES.PROVENANCE_META
			) {
				continue;
			}
			const propPath = path ? `${path}.${key}` : `.${key}`;
			const propResult = extractProvenanceRecursive(
				(value as Record<string, unknown>)[key],
				extractor,
				propPath,
				visited
			);
			entries.push(...propResult.entries);
			primitives.push(...propResult.primitives);
			if (propResult.hasRestrictedData) {
				hasRestrictedData = true;
			}
		}
	}

	return { entries, primitives, hasRestrictedData };
}

/**
 * Restore provenance to values using snapshot
 * Handles both simple and complex restoration scenarios
 */
export function restoreProvenanceFromSnapshot(
	value: unknown,
	snapshot: CheckpointProvenanceSnapshot,
	attacher: ProvenanceAttacher
): unknown {
	if (!attacher) {
		return value;
	}

	// Re-register primitive taints
	if (snapshot.primitives) {
		for (const [key, primMeta] of snapshot.primitives) {
			// The attacher should handle primitive registration
			attacher(null, primMeta, [[key, primMeta]]);
		}
	}

	// Prefer entries if available (handles nested/aggregated provenance)
	if (snapshot.entries && snapshot.entries.length > 0) {
		return restoreProvenanceByPath(value, snapshot.entries, attacher);
	}

	// Fallback to metadata for simple cases (single root-level provenance)
	if (snapshot.metadata) {
		return attacher(value, snapshot.metadata, snapshot.primitives);
	}

	return value;
}

/**
 * Restore provenance to values at specific paths
 * 
 * Path examples:
 * - "" → root value
 * - "[0]" → array[0]
 * - "[1].data" → array[1].data
 * - ".user.name" → obj.user.name
 */
function restoreProvenanceByPath(
	value: unknown,
	entries: ProvenanceEntry[],
	attacher: ProvenanceAttacher
): unknown {
	if (!entries || entries.length === 0) {
		return value;
	}

	// Sort entries by path length (deepest first) to handle nested objects correctly
	const sortedEntries = [...entries].sort((a, b) => b.path.length - a.path.length);

	// Clone the value to avoid mutating the original
	let result = deepClone(value);

	// Apply provenance to each path
	for (const entry of sortedEntries) {
		if (entry.path === '') {
			// Root level
			result = attacher(result, entry.metadata, undefined);
		} else {
			// Navigate to the nested value and attach provenance
			result = attachProvenanceAtPath(result, entry.path, entry.metadata, attacher);
		}
	}

	return result;
}

/**
 * Navigate to a path and attach provenance to the value there
 */
function attachProvenanceAtPath(
	root: unknown,
	path: string,
	metadata: ProvenanceMetadata,
	attacher: ProvenanceAttacher
): unknown {
	// Parse path into segments
	const segments = parsePath(path);
	if (segments.length === 0) {
		return attacher(root, metadata, undefined);
	}

	// Navigate to parent and get the target value
	let current: any = root;
	const parentSegments = segments.slice(0, -1);
	const lastSegment = segments[segments.length - 1];

	for (const segment of parentSegments) {
		if (current === null || current === undefined) {
			return root; // Path doesn't exist
		}
		current = current[segment];
	}

	if (current === null || current === undefined || lastSegment === undefined) {
		return root; // Path doesn't exist
	}

	// Attach provenance to the value at this path
	const targetValue = current[lastSegment];
	const wrappedValue = attacher(targetValue, metadata, undefined);
	current[lastSegment] = wrappedValue;

	return root;
}

/**
 * Parse a path string into segments
 * "[0].user.name" → ["0", "user", "name"]
 */
export function parsePath(path: string): string[] {
	const segments: string[] = [];
	let current = '';
	let inBracket = false;

	for (const char of path) {
		if (char === '[') {
			if (current) {
				segments.push(current);
				current = '';
			}
			inBracket = true;
		} else if (char === ']') {
			if (current) {
				segments.push(current);
				current = '';
			}
			inBracket = false;
		} else if (char === '.' && !inBracket) {
			if (current) {
				segments.push(current);
				current = '';
			}
		} else {
			current += char;
		}
	}

	if (current) {
		segments.push(current);
	}

	return segments;
}

/**
 * Deep clone a value (simple JSON-based clone)
 */
export function deepClone<T>(value: T): T {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value !== 'object') {
		return value;
	}
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		// Fallback for non-serializable values
		return value;
	}
}

/**
 * Check if a provenance snapshot has restricted data
 */
export function hasRestrictedProvenance(snapshot?: CheckpointProvenanceSnapshot): boolean {
	if (!snapshot) {
		return false;
	}

	// Fast path: check pre-computed flag
	if (snapshot.hasRestrictedData) {
		return true;
	}

	// Check top-level metadata (backwards compatibility)
	if (snapshot.metadata?.readers?.type === 'restricted') {
		return true;
	}

	// Check all entries for nested restricted data
	if (snapshot.entries) {
		for (const entry of snapshot.entries) {
			if (entry.metadata?.readers?.type === 'restricted') {
				return true;
			}
		}
	}

	// Check primitive provenance
	if (snapshot.primitives) {
		for (const [, primMeta] of snapshot.primitives) {
			if (primMeta.readers?.type === 'restricted') {
				return true;
			}
		}
	}

	return false;
}
