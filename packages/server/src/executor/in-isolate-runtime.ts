/**
 * In-Isolate Runtime Functions
 *
 * These runtime functions must run entirely inside the isolated-vm sandbox because they
 * receive Promise arguments or callback functions that might contain Promises.
 * Promises and functions with closures cannot be cloned/copied across the isolated-vm boundary.
 *
 * NOTE: batchParallel is NOT included because it needs to communicate with the host
 * to execute callbacks (LLM, approval, etc.) - it receives serializable callback descriptors,
 * not Promises or functions.
 */

import {
	RuntimeFunction,
	IN_ISOLATE_RUNTIME_FUNCTIONS,
	isInIsolateRuntimeFunction,
	type RuntimeFunctionType,
} from '@mondaydotcomorg/atp-compiler';

// Re-export for convenience
export { RuntimeFunction, IN_ISOLATE_RUNTIME_FUNCTIONS, isInIsolateRuntimeFunction };
export type { RuntimeFunctionType };

/**
 * Check if a function name should run inside the isolate
 */
export function isInIsolateFunction(name: string): boolean {
	return isInIsolateRuntimeFunction(name);
}

/**
 * JavaScript implementations for in-isolate runtime functions.
 * These are stringified code that gets evaluated inside the isolated-vm.
 */
export const IN_ISOLATE_IMPLEMENTATIONS: Record<string, string> = {
	[RuntimeFunction.RESUMABLE_PROMISE_ALL]: `async (promises, parallelId) => {
		// Use native Promise.all for true parallel execution and proper error handling
		return await Promise.all(promises);
	}`,

	[RuntimeFunction.RESUMABLE_PROMISE_ALL_SETTLED]: `async (promises, parallelId) => {
		// Use native Promise.allSettled for true parallel execution
		return await Promise.allSettled(promises);
	}`,

	[RuntimeFunction.RESUMABLE_FOR_OF]: `async (iterable, callback, loopId) => {
		let index = 0;
		for (const item of iterable) {
			await callback(item, index);
			index++;
		}
	}`,

	[RuntimeFunction.RESUMABLE_FOR_LOOP]: `async (init, condition, update, body, loopId) => {
		for (init(); condition(); update()) {
			await body();
		}
	}`,

	[RuntimeFunction.RESUMABLE_WHILE]: `async (condition, body, loopId) => {
		while (await condition()) {
			await body();
		}
	}`,

	[RuntimeFunction.RESUMABLE_MAP]: `async (array, callback, loopId) => {
		const results = [];
		for (let i = 0; i < array.length; i++) {
			results[i] = await callback(array[i], i);
		}
		return results;
	}`,

	[RuntimeFunction.RESUMABLE_FOR_EACH]: `async (array, callback, loopId) => {
		for (let i = 0; i < array.length; i++) {
			await callback(array[i], i);
		}
	}`,

	[RuntimeFunction.RESUMABLE_FILTER]: `async (array, callback, loopId) => {
		const results = [];
		for (let i = 0; i < array.length; i++) {
			if (await callback(array[i], i)) {
				results.push(array[i]);
			}
		}
		return results;
	}`,

	[RuntimeFunction.RESUMABLE_REDUCE]: `async (array, callback, initialValue, loopId) => {
		let accumulator = initialValue;
		for (let i = 0; i < array.length; i++) {
			accumulator = await callback(accumulator, array[i], i);
		}
		return accumulator;
	}`,

	[RuntimeFunction.RESUMABLE_FIND]: `async (array, callback, loopId) => {
		for (let i = 0; i < array.length; i++) {
			if (await callback(array[i], i)) {
				return array[i];
			}
		}
		return undefined;
	}`,

	[RuntimeFunction.RESUMABLE_SOME]: `async (array, callback, loopId) => {
		for (let i = 0; i < array.length; i++) {
			if (await callback(array[i], i)) {
				return true;
			}
		}
		return false;
	}`,

	[RuntimeFunction.RESUMABLE_EVERY]: `async (array, callback, loopId) => {
		for (let i = 0; i < array.length; i++) {
			if (!(await callback(array[i], i))) {
				return false;
			}
		}
		return true;
	}`,

	[RuntimeFunction.RESUMABLE_FLAT_MAP]: `async (array, callback, loopId) => {
		const results = [];
		for (let i = 0; i < array.length; i++) {
			const mapped = await callback(array[i], i);
			if (Array.isArray(mapped)) {
				results.push(...mapped);
			} else {
				results.push(mapped);
			}
		}
		return results;
	}`,
};

/**
 * Get the in-isolate implementation for a function, if it exists
 */
export function getInIsolateImplementation(name: string): string | undefined {
	return IN_ISOLATE_IMPLEMENTATIONS[name];
}
