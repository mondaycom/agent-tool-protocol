/**
 * Bridge between AST tracker in isolated-vm and host policy engine
 */
import * as ivm from 'isolated-vm';
import { getProvenance, getProvenanceForPrimitive } from '@mondaydotcomorg/atp-provenance';

// Store active isolate contexts for AST mode provenance checking
const activeIsolates = new Map<string, ivm.Context>();

// Cache the getProvenance function to avoid repeated requires
let cachedGetProvenance: ((value: unknown) => any) | null = null;

export function registerIsolateContext(executionId: string, context: ivm.Context): void {
	activeIsolates.set(executionId, context);
}

export function unregisterIsolateContext(executionId: string): void {
	activeIsolates.delete(executionId);
}

/**
 * Create a getProvenance function that can check AST tracker inside the isolate
 * Falls back to host-side getProvenance for hint-based tracking
 */
export function createASTProvenanceChecker(executionId: string): (value: unknown) => any {
	return (value: unknown) => {
		const context = activeIsolates.get(executionId);

		// First, try checking in the isolate's AST tracker
		if (context) {
			try {
				// Serialize the value to pass into isolate for checking
				const valueStr =
					typeof value === 'string' || typeof value === 'number'
						? JSON.stringify(String(value))
						: JSON.stringify(value);

				// Call __check_provenance inside the isolate
				const checkCode = `
					(function() {
						try {
							if (typeof globalThis.__check_provenance !== 'function') {
								return null;
							}
							const value = ${valueStr};
							const result = globalThis.__check_provenance(value);
							return result;
						} catch (e) {
							return null;
						}
					})()
				`;

				const result = context.evalSync(checkCode, { timeout: 100, copy: true });
				if (result) {
					return result;
				}
			} catch (error) {
				// Fall through to host check
			}
		}

		// Fall back to host-side provenance check (for hints and registered metadata)
		// This is critical for checking primitives that were registered via hints
		if (!cachedGetProvenance) {
			cachedGetProvenance = getProvenance;
		}
		const hostResult = cachedGetProvenance?.(value);

		// Also check getProvenanceForPrimitive for tainted primitives
		if (!hostResult && (typeof value === 'string' || typeof value === 'number')) {
			const primitiveResult = getProvenanceForPrimitive?.(value);
			if (primitiveResult) {
				return primitiveResult;
			}
		}

		return hostResult;
	};
}
