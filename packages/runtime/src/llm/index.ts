/**
 * LLM API - Clean refactored version with decorators and extracted modules
 *
 * Benefits:
 * - No duplication between implementation and metadata
 * - Types auto-detected from TypeScript signatures
 * - Clean separation of concerns (replay, callback, API)
 */
import { pauseForCallback, CallbackType, LLMOperation } from '../pause/index.js';
import { RuntimeAPI, RuntimeMethod } from '../metadata/decorators.js';
import { nextSequenceNumber, getCachedResult, isReplayMode } from './replay.js';
import type { LLMCallOptions, LLMExtractOptions, LLMClassifyOptions } from './types';

export type {
	LLMCallOptions,
	LLMExtractOptions,
	LLMClassifyOptions,
	ClientLLMCallback,
} from './types';
export { setClientLLMCallback, getClientLLMCallback } from './callback.js';
export {
	initializeExecutionState,
	setPauseForClient,
	shouldPauseForClient,
	setReplayMode,
	getCallSequenceNumber,
	nextSequenceNumber,
	getCachedResult,
	isReplayMode,
	runInExecutionContext,
	setCurrentExecutionId,
	clearCurrentExecutionId,
	storeAPICallResult,
	getAPICallResults,
	clearAPICallResults,
	setAPIResultCache,
	getAPIResultFromCache,
	storeAPIResultInCache,
	cleanupExecutionState,
	cleanupOldExecutionStates,
	resetAllExecutionState,
	getExecutionStateStats,
} from './replay.js';

/**
 * LLM Runtime API
 *
 * Provides client-side LLM operations with pause/resume support.
 * All calls pause execution and route to client-provided LLM.
 */
@RuntimeAPI(
	'llm',
	'LLM API - Large Language Model calls using client-provided LLM (requires client.provideLLM())'
)
class LLMAPI {
	/**
	 * Makes a standard LLM call
	 * Always pauses execution and routes to client-provided LLM
	 */
	@RuntimeMethod('Make an LLM call with a prompt', {
		options: {
			description: 'LLM call options including prompt',
			type: 'LLMCallOptions',
		},
	})
	async call(options: LLMCallOptions): Promise<string> {
		const currentSequence = nextSequenceNumber();

		const cachedResult = getCachedResult(currentSequence);
		if (cachedResult !== undefined) {
			return cachedResult as string;
		}

		pauseForCallback(CallbackType.LLM, LLMOperation.CALL, {
			prompt: options.prompt,
			options,
			sequenceNumber: currentSequence,
		});
	}

	/**
	 * Extracts structured data using LLM
	 * Always pauses execution and routes to client-provided LLM
	 */
	@RuntimeMethod('Extract structured data from text using an LLM', {
		options: {
			description: 'Extraction options with JSON schema',
			type: 'LLMExtractOptions',
		},
	})
	async extract<T>(options: LLMExtractOptions): Promise<T> {
		const currentSequence = nextSequenceNumber();

		const cachedResult = getCachedResult(currentSequence);
		if (cachedResult !== undefined) {
			return cachedResult as T;
		}

		pauseForCallback(CallbackType.LLM, LLMOperation.EXTRACT, {
			prompt: options.prompt,
			schema: options.schema,
			options,
			sequenceNumber: currentSequence,
		});
	}

	/**
	 * Classifies text into one of the provided categories
	 * Always pauses execution and routes to client-provided LLM
	 */
	@RuntimeMethod('Classify text into one of the provided categories', {
		options: {
			description: 'Classification options with categories',
			type: 'LLMClassifyOptions',
		},
	})
	async classify(options: LLMClassifyOptions): Promise<string> {
		const currentSequence = nextSequenceNumber();

		const cachedResult = getCachedResult(currentSequence);
		if (cachedResult !== undefined) {
			return cachedResult as string;
		}

		pauseForCallback(CallbackType.LLM, LLMOperation.CLASSIFY, {
			text: options.text,
			categories: options.categories,
			options,
			sequenceNumber: currentSequence,
		});
	}
}

export const llm = new LLMAPI();
