import ivm from 'isolated-vm';
import { ExecutionStatus } from '@mondaydotcomorg/atp-protocol';
import type { ExecutionResult } from '@mondaydotcomorg/atp-protocol';
import type { Logger } from '@mondaydotcomorg/atp-runtime';
import {
	isPauseError,
	getCallSequenceNumber,
	setPauseForClient,
	setReplayMode,
	getAPICallResults,
	clearAPICallResults,
	setCurrentExecutionId,
	clearCurrentExecutionId,
	type PauseExecutionError,
} from '@mondaydotcomorg/atp-runtime';
import { isBatchPauseError, type BatchPauseExecutionError } from '@mondaydotcomorg/atp-compiler';
import { nanoid } from 'nanoid';
import type { CallbackRecord } from '../execution-state/index.js';
import type { RuntimeContext } from './types.js';
import { categorizeError } from './error-handler.js';
import { PAUSE_EXECUTION_MARKER } from './constants.js';

export function handleExecutionError(
	error: unknown,
	pauseError: unknown,
	context: RuntimeContext,
	executionId: string,
	callbackHistory: CallbackRecord[],
	memoryBefore: number,
	executionLogger: Logger,
	isolate: ivm.Isolate,
	transformedCode?: string
): ExecutionResult {
	const errMsg = error instanceof Error ? error.message : String(error);

	if (errMsg.includes(PAUSE_EXECUTION_MARKER) && pauseError) {
		error = pauseError;
	}

	setCurrentExecutionId(executionId);
	
	const apiResults = getAPICallResults();

	if (isBatchPauseError(error)) {
		const batchErr = error as BatchPauseExecutionError;

		executionLogger.info('Execution paused for batch callbacks', {
			batchId: batchErr.batchId,
			callCount: batchErr.calls.length,
			sequenceNumber: batchErr.sequenceNumber,
		});

		// Add any API call results to callback history FIRST (already retrieved above)
		for (const apiRecord of apiResults) {
			callbackHistory.push(apiRecord as CallbackRecord);
		}
		if (apiResults.length > 0) {
			executionLogger.debug('Added API results to callback history', {
				apiCallCount: apiResults.length,
			});
		}
		try {
			clearAPICallResults();
		} catch (e) {
			// Context might not be set
		}

		const batchCallbackRecord: CallbackRecord = {
			type: (batchErr.calls[0]?.type as any) || 'llm',
			operation: 'batch_parallel',
			payload: {
				batchId: batchErr.batchId,
				calls: batchErr.calls,
			},
			sequenceNumber: batchErr.sequenceNumber,
			result: undefined,
			timestamp: Date.now(),
		};
		callbackHistory.push(batchCallbackRecord);

		const memoryAfter = process.memoryUsage().heapUsed;
		const memoryUsed = Math.max(0, memoryAfter - memoryBefore);

		try {
			isolate.dispose();
		} catch (e) {}

		setPauseForClient(false);
		setReplayMode(undefined);

		return {
			executionId,
			status: ExecutionStatus.PAUSED,
			needsCallbacks: batchErr.calls.map((call: any) => ({
				id: nanoid(),
				type: call.type as any,
				operation: call.operation,
				payload: call.payload,
			})),
			callbackHistory,
			stats: {
				duration: Date.now() - context.startTime,
				memoryUsed,
				llmCallsCount: context.llmCallCount,
				approvalCallsCount: context.approvalCallCount,
			},
			transformedCode,
		};
	}

	if (isPauseError(error)) {
		const pauseErr = error as PauseExecutionError;

		for (const apiRecord of apiResults) {
			callbackHistory.push(apiRecord as CallbackRecord);
		}
		if (apiResults.length > 0) {
			executionLogger.debug('Added API results to callback history', {
				apiCallCount: apiResults.length,
			});
		}
		clearAPICallResults();

		let currentSequence: number;
		const payloadSequence =
			typeof pauseErr.payload?.sequenceNumber === 'number'
				? (pauseErr.payload.sequenceNumber as number)
				: undefined;

		if (payloadSequence !== undefined) {
			currentSequence = payloadSequence;
		} else {
			currentSequence = getCallSequenceNumber() - 1;
		}

		const callbackRecord: CallbackRecord = {
			type: pauseErr.type,
			operation: pauseErr.operation,
			payload: pauseErr.payload,
			result: undefined,
			timestamp: Date.now(),
			sequenceNumber: currentSequence,
		};
		callbackHistory.push(callbackRecord);

		executionLogger.info('Execution paused for client callback', {
			type: pauseErr.type,
			operation: pauseErr.operation,
			sequenceNumber: currentSequence,
			historyLength: callbackHistory.length,
		});

		const memoryAfter = process.memoryUsage().heapUsed;
		const memoryUsed = Math.max(0, memoryAfter - memoryBefore);

		try {
			isolate.dispose();
		} catch (e) {}

		setPauseForClient(false);
		setReplayMode(undefined);

		return {
			executionId,
			status: ExecutionStatus.PAUSED,
			needsCallback: {
				type: pauseErr.type,
				operation: pauseErr.operation,
				payload: pauseErr.payload,
			},
			callbackHistory,
			stats: {
				duration: Date.now() - context.startTime,
				memoryUsed,
				llmCallsCount: context.llmCallCount,
				approvalCallsCount: context.approvalCallCount,
			},
			transformedCode,
		};
	}

	const err = error as Error;
	const errorInfo = categorizeError(err);

	executionLogger.error('Code execution failed', {
		error: err.message,
		status: errorInfo.status,
		code: errorInfo.code,
		retryable: errorInfo.retryable,
	});

	const memoryAfter = process.memoryUsage().heapUsed;
	const memoryUsed = Math.max(0, memoryAfter - memoryBefore);

	try {
		isolate.dispose();
	} catch (e) {}

	setPauseForClient(false);
	setReplayMode(undefined);

	return {
		executionId,
		status: errorInfo.status,
		error: {
			message: err.message,
			code: errorInfo.code,
			stack: err.stack,
			retryable: errorInfo.retryable,
			suggestion: errorInfo.suggestion,
		},
		stats: {
			duration: Date.now() - context.startTime,
			memoryUsed,
			llmCallsCount: context.llmCallCount,
			approvalCallsCount: context.approvalCallCount,
		},
	};
}
