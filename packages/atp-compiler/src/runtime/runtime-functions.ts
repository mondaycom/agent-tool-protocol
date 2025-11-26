/**
 * Runtime Function Names
 *
 * These constants define the names of runtime functions used by the ATP compiler
 * when transforming code. They must match the implementations provided by the server.
 */

/**
 * Promise-related runtime functions
 */
export const RuntimeFunction = {
	// Promise operations
	RESUMABLE_PROMISE_ALL: 'resumablePromiseAll',
	RESUMABLE_PROMISE_ALL_SETTLED: 'resumablePromiseAllSettled',
	BATCH_PARALLEL: 'batchParallel',

	// Loop operations
	RESUMABLE_FOR_OF: 'resumableForOf',
	RESUMABLE_FOR_LOOP: 'resumableForLoop',
	RESUMABLE_WHILE: 'resumableWhile',

	// Array method operations
	RESUMABLE_MAP: 'resumableMap',
	RESUMABLE_FOR_EACH: 'resumableForEach',
	RESUMABLE_FILTER: 'resumableFilter',
	RESUMABLE_REDUCE: 'resumableReduce',
	RESUMABLE_FIND: 'resumableFind',
	RESUMABLE_SOME: 'resumableSome',
	RESUMABLE_EVERY: 'resumableEvery',
	RESUMABLE_FLAT_MAP: 'resumableFlatMap',
} as const;

export type RuntimeFunctionType = (typeof RuntimeFunction)[keyof typeof RuntimeFunction];

/**
 * Runtime functions that must execute inside the isolate (cannot cross boundary).
 * These receive Promise arguments or callback functions that can't be cloned.
 *
 * NOTE: BATCH_PARALLEL is NOT included because it receives serializable callback
 * descriptors and needs to communicate with the host for callback execution.
 */
export const IN_ISOLATE_RUNTIME_FUNCTIONS: readonly RuntimeFunctionType[] = [
	RuntimeFunction.RESUMABLE_PROMISE_ALL,
	RuntimeFunction.RESUMABLE_PROMISE_ALL_SETTLED,
	RuntimeFunction.RESUMABLE_FOR_OF,
	RuntimeFunction.RESUMABLE_FOR_LOOP,
	RuntimeFunction.RESUMABLE_WHILE,
	RuntimeFunction.RESUMABLE_MAP,
	RuntimeFunction.RESUMABLE_FOR_EACH,
	RuntimeFunction.RESUMABLE_FILTER,
	RuntimeFunction.RESUMABLE_REDUCE,
	RuntimeFunction.RESUMABLE_FIND,
	RuntimeFunction.RESUMABLE_SOME,
	RuntimeFunction.RESUMABLE_EVERY,
	RuntimeFunction.RESUMABLE_FLAT_MAP,
];

/**
 * Check if a runtime function must execute inside the isolate
 */
export function isInIsolateRuntimeFunction(name: string): boolean {
	return IN_ISOLATE_RUNTIME_FUNCTIONS.includes(name as RuntimeFunctionType);
}

