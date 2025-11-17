import { AsyncLocalStorage } from 'async_hooks';

/**
 * Execution-scoped state
 */
interface APICallRecord {
	type: string;
	operation: string;
	payload: unknown;
	result: unknown;
	timestamp: number;
	sequenceNumber: number;
}

interface ExecutionState {
	shouldPauseForClient: boolean;
	replayResults: Map<number, unknown> | undefined;
	callSequenceNumber: number;
	apiCallResults: APICallRecord[];
	apiResultCache: Map<string, unknown> | undefined;
	createdAt: number;
}

/**
 * Map of executionId -> ExecutionState
 * Each execution has its own isolated state
 */
const executionStates = new Map<string, ExecutionState>();

/**
 * AsyncLocalStorage for execution ID - provides proper async context isolation
 * This ensures each async execution chain has its own isolated execution ID
 */
const executionContext = new AsyncLocalStorage<string>();

/**
 * Current execution ID - set by runtime API wrappers
 * This is a thread-local variable that's set before each runtime API call
 * and cleared after, providing isolation even when AsyncLocalStorage fails
 */
let currentExecutionId: string | null = null;

/**
 * Sets the current execution ID for this call
 * Called by executor before each runtime API invocation
 */
export function setCurrentExecutionId(executionId: string): void {
	currentExecutionId = executionId;
}

/**
 * Clears the current execution ID after a call
 * Called by executor after each runtime API invocation
 */
export function clearCurrentExecutionId(): void {
	currentExecutionId = null;
}

/**
 * Gets the current execution state
 * Note: State must be initialized before calling this. Use initializeExecutionState() first.
 */
function getCurrentState(): ExecutionState {
	let executionId = currentExecutionId;

	if (!executionId) {
		executionId = executionContext.getStore() || null;
	}

	if (!executionId) {
		throw new Error(
			'No execution context set. Executor must call setCurrentExecutionId() before runtime API calls.'
		);
	}

	console.log(`[STATE] getCurrentState: executionId=${executionId}, hasState=${executionStates.has(executionId)}, totalStates=${executionStates.size}, stateKeys=${Array.from(executionStates.keys())}`);

	let state = executionStates.get(executionId);
	if (!state) {
	// State should have been initialized explicitly at execution start
	// Create it now with a safe default to prevent crashes
	console.warn('[STATE] State not initialized, creating with default. This should not happen.', { executionId });
	state = {
		shouldPauseForClient: false,
		replayResults: undefined,
		callSequenceNumber: 0,
		apiCallResults: [],
		apiResultCache: undefined,
		createdAt: Date.now(),
	};
	executionStates.set(executionId, state);
	} else {
		console.log(`[STATE] Found existing state: shouldPause=${state.shouldPauseForClient}, hasReplay=${!!state.replayResults}, seqNum=${state.callSequenceNumber}`);
	}
	return state;
}

/**
 * Initialize execution state with correct values at execution start
 * This must be called before any state access to ensure correct pause mode
 */
export function initializeExecutionState(shouldPause: boolean): void {
	const executionId = currentExecutionId || executionContext.getStore();
	if (!executionId) {
		throw new Error('No execution context set. Executor must call setCurrentExecutionId() before initializeExecutionState().');
	}

	console.log(`[INIT] initializeExecutionState called: executionId=${executionId}, shouldPause=${shouldPause}, existingState=${executionStates.has(executionId)}`);

	const existingState = executionStates.get(executionId);
	if (existingState) {
		existingState.shouldPauseForClient = shouldPause;
		if (!existingState.apiCallResults) {
			existingState.apiCallResults = [];
		}
		if (!existingState.apiResultCache) {
			existingState.apiResultCache = undefined;
		}
		console.log(`[INIT] Preserving existing state: replaySize=${existingState.replayResults?.size || 0}, counter=${existingState.callSequenceNumber}`);
		return;
	}

	const state: ExecutionState = {
		shouldPauseForClient: shouldPause,
		replayResults: undefined,
		callSequenceNumber: 0,
		apiCallResults: [],
		apiResultCache: undefined,
		createdAt: Date.now(),
	};
	console.log(`[INIT] Creating new state: shouldPause=${shouldPause}`);
	executionStates.set(executionId, state);
}

/**
 * Runs a function within an execution context
 * @param executionId - Unique ID for this execution
 * @param fn - Function to run within the context
 */
export function runInExecutionContext<T>(executionId: string, fn: () => T): T {
	return executionContext.run(executionId, fn);
}

/**
 * Configures whether to pause execution for client services
 * @param pause - If true, throws PauseExecutionError instead of calling callback
 */
export function setPauseForClient(pause: boolean): void {
	const executionId = currentExecutionId || executionContext.getStore();
	if (!executionId) {
		throw new Error('No execution context set. Executor must call setCurrentExecutionId() before setPauseForClient().');
	}

	const state = executionStates.get(executionId);
	if (!state) {
		throw new Error('Execution state not initialized. Call initializeExecutionState() first.');
	}
	state.shouldPauseForClient = pause;
}

/**
 * Checks if should pause for client
 */
export function shouldPauseForClient(): boolean {
	const state = getCurrentState();
	return state.shouldPauseForClient;
}

/**
 * Sets up replay mode for resumption
 * @param results - Map of sequence number to result for replaying callbacks
 */
export function setReplayMode(results: Map<number, unknown> | undefined): void {
	const executionId = currentExecutionId || executionContext.getStore();
	console.log(`[REPLAY] setReplayMode called: executionId=${executionId}, replaySize=${results?.size || 0}, replayKeys=${results ? Array.from(results.keys()) : []}`);
	const state = getCurrentState();

	// Store replay results
	const oldSize = state.replayResults?.size || 0;
	state.replayResults = results;

	// Always reset counter when setting replay mode
	// - When entering replay mode with cached results: start from 0 to match first call
	// - When clearing replay mode (results=undefined): reset to 0 for clean state
	const oldCounter = state.callSequenceNumber;
	state.callSequenceNumber = 0;

	if (results && results.size > 0) {
		console.log(`[REPLAY] Entering replay mode: ${oldCounter} -> 0 (have ${results.size} cached results)`);
	} else {
		console.log(`[REPLAY] Clearing replay mode: ${oldCounter} -> 0`);
	}

	console.log(`[REPLAY] setReplayMode completed: oldSize=${oldSize}, newSize=${state.replayResults?.size || 0}, callSequenceNumber=${state.callSequenceNumber}`);
}

/**
 * Gets current call sequence number
 */
export function getCallSequenceNumber(): number {
	const state = getCurrentState();
	console.log(`[GET_SEQ] getCallSequenceNumber called: returning ${state.callSequenceNumber}, hasReplay=${!!state.replayResults}, replaySize=${state.replayResults?.size || 0}`);
	return state.callSequenceNumber;
}

/**
 * Increments and returns the next sequence number
 */
export function nextSequenceNumber(): number {
	const state = getCurrentState();
	const current = state.callSequenceNumber;
	state.callSequenceNumber++;
	console.log(`[SEQUENCE] nextSequenceNumber: returning ${current}, next will be ${state.callSequenceNumber}, isReplay=${state.replayResults !== undefined}, replaySize=${state.replayResults?.size || 0}`);
	return current;
}

/**
 * Check if we have a cached result for the current sequence
 */
export function getCachedResult(sequenceNumber: number): unknown | undefined {
	const state = getCurrentState();
	console.log(`[CACHE] getCachedResult(${sequenceNumber}): hasReplayResults=${!!state.replayResults}, replayKeys=${state.replayResults ? Array.from(state.replayResults.keys()) : []}`);
	if (state.replayResults && state.replayResults.has(sequenceNumber)) {
		const result = state.replayResults.get(sequenceNumber);
		console.log(`[CACHE] Found cached result for sequence ${sequenceNumber}:`, JSON.stringify(result));
		return result;
	}
	console.log(`[CACHE] No cached result for sequence ${sequenceNumber}`);
	return undefined;
}

/**
 * Check if we're in replay mode
 */
export function isReplayMode(): boolean {
	return getCurrentState().replayResults !== undefined;
}

/**
 * Store an API call result during execution
 * This is used to track server-side API calls so they can be cached on resume
 */
export function storeAPICallResult(record: {
	type: string;
	operation: string;
	payload: unknown;
	result: unknown;
	timestamp: number;
	sequenceNumber: number;
}): void {
	const state = getCurrentState();
	state.apiCallResults.push(record);
}

/**
 * Get all API call results tracked during this execution
 * Used when building callback history on pause
 */
export function getAPICallResults(): APICallRecord[] {
	const state = getCurrentState();
	return state.apiCallResults;
}

/**
 * Clear API call results (used when execution completes or fails)
 */
export function clearAPICallResults(): void {
	const state = getCurrentState();
	state.apiCallResults = [];
}

/**
 * Set up API result cache for resume (operation-based, not sequence-based)
 * This allows API calls to find their cached results even if execution order changes
 */
export function setAPIResultCache(cache: Map<string, unknown> | undefined): void {
	const state = getCurrentState();
	state.apiResultCache = cache;
}

/**
 * Get API result from cache by operation name
 */
export function getAPIResultFromCache(operation: string): unknown | undefined {
	const state = getCurrentState();
	return state.apiResultCache?.get(operation);
}

/**
 * Store API result in cache by operation name (for initial execution)
 */
export function storeAPIResultInCache(operation: string, result: unknown): void {
	const state = getCurrentState();
	if (!state.apiResultCache) {
		state.apiResultCache = new Map();
	}
	state.apiResultCache.set(operation, result);
}

/**
 * Cleanup a specific execution's state
 * This should be called when an execution completes, fails, or is no longer needed
 */
export function cleanupExecutionState(executionId: string): void {
	executionStates.delete(executionId);
	if (currentExecutionId === executionId) {
		currentExecutionId = null;
	}
}

/**
 * Cleanup old execution states to prevent memory leaks
 * Removes states older than the specified max age (default: 1 hour)
 */
export function cleanupOldExecutionStates(maxAgeMs: number = 3600000): number {
	const now = Date.now();
	let cleaned = 0;
	
	for (const [executionId, state] of executionStates.entries()) {
		const age = now - state.createdAt;
		if (age > maxAgeMs) {
			executionStates.delete(executionId);
			cleaned++;
		}
	}
	
	return cleaned;
}

/**
 * Reset ALL execution state - for testing purposes only
 * WARNING: This will clear all execution states, breaking any in-flight executions
 */
export function resetAllExecutionState(): void {
	executionStates.clear();
	currentExecutionId = null;
}

/**
 * Get execution state statistics - for monitoring/debugging
 */
export function getExecutionStateStats(): {
	totalStates: number;
	oldestStateAge: number | null;
	newestStateAge: number | null;
	executionIds: string[];
} {
	const now = Date.now();
	const executionIds = Array.from(executionStates.keys());
	let oldestAge: number | null = null;
	let newestAge: number | null = null;
	
	for (const state of executionStates.values()) {
		const age = now - state.createdAt;
		if (oldestAge === null || age > oldestAge) {
			oldestAge = age;
		}
		if (newestAge === null || age < newestAge) {
			newestAge = age;
		}
	}
	
	return {
		totalStates: executionStates.size,
		oldestStateAge: oldestAge,
		newestStateAge: newestAge,
		executionIds,
	};
}
