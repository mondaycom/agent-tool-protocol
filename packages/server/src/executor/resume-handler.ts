import type { Logger } from '@mondaydotcomorg/atp-runtime';
import { setReplayMode, setAPIResultCache } from '@mondaydotcomorg/atp-runtime';
import type { CallbackRecord } from '../execution-state/index.js';

export interface ResumeData {
	callbackHistory: CallbackRecord[];
	newCallbackResult: unknown;
	executionId?: string;
}

export function setupResumeExecution(
	resumeData: ResumeData,
	callbackHistory: CallbackRecord[],
	executionLogger: Logger
): void {
	executionLogger.info('Resuming execution with callback history', {
		historyLength: resumeData.callbackHistory.length,
	});

	const replayMap = new Map<number, unknown>();
	const apiCache = new Map<string, unknown>();

	for (const record of resumeData.callbackHistory) {
		if (record.result !== undefined) {
			replayMap.set(record.sequenceNumber, record.result);
			if (record.operation && record.operation.includes('.') && !record.operation.includes('call')) {
				const cacheKey = `${record.operation}:${JSON.stringify(record.payload)}`;
				apiCache.set(cacheKey, record.result);
			}
		}
	}

	const lastCallback = resumeData.callbackHistory[resumeData.callbackHistory.length - 1];
	if (lastCallback) {
		replayMap.set(lastCallback.sequenceNumber, resumeData.newCallbackResult);
	}

	setReplayMode(replayMap);

	if (apiCache.size > 0) {
		setAPIResultCache(apiCache);
	}

	callbackHistory.push(...resumeData.callbackHistory);

	executionLogger.debug('Replay map configured', {
		replayEntries: replayMap.size,
	});
}
