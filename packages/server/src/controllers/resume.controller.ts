import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SandboxExecutor } from '@mondaydotcomorg/atp-engine';
import type { ExecutionStateManager } from '../execution-state/index.js';
import type { log } from '@mondaydotcomorg/atp-runtime';

interface ResumeContext {
	executor: SandboxExecutor;
	stateManager: ExecutionStateManager;
}

export async function handleResume(
	req: IncomingMessage,
	res: ServerResponse,
	context: ResumeContext,
	executionId: string,
	body: string,
	logger: ReturnType<typeof log.child>
): Promise<void> {
	logger.info('Resuming paused execution', { executionId });

	const pausedState = await context.stateManager.get(executionId);

	if (!pausedState) {
		logger.warn('Execution not found or expired', { executionId });
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Execution not found or expired' }));
		return;
	}

	const { result: callbackResult } = JSON.parse(body) as { result: unknown };

	logger.info('Client callback result received', {
		executionId,
		callbackType: pausedState.callbackRequest.type,
		operation: pausedState.callbackRequest.operation,
	});

	const updatedHistory = pausedState.callbackHistory.map((record, index) => {
		if (index === pausedState.currentCallbackIndex) {
			return { ...record, result: callbackResult };
		}
		return record;
	});

	logger.info('Re-executing with replay', {
		executionId,
		historyLength: updatedHistory.length,
	});

	const result = await context.executor.execute(
		pausedState.code,
		pausedState.config,
		pausedState.clientId,
		{
			callbackHistory: updatedHistory,
			newCallbackResult: callbackResult,
			executionId,
		}
	);

	logger.info('Resumed execution completed', {
		executionId: result.executionId,
		status: result.status,
		duration: result.stats.duration,
	});

	if (result.status === 'paused' && result.needsCallback && result.callbackHistory) {
		await context.stateManager.pause({
			executionId: result.executionId,
			code: pausedState.code,
			config: pausedState.config,
			clientId: pausedState.clientId,
			callbackRequest: result.needsCallback,
			pausedAt: Date.now(),
			callbackHistory: result.callbackHistory,
			currentCallbackIndex: result.callbackHistory.length - 1,
			context: {},
		});

		logger.info('Execution paused again (multi-callback)', {
			executionId: result.executionId,
			callbackType: result.needsCallback.type,
			totalCallbacks: result.callbackHistory.length,
		});
	} else {
		await context.stateManager.delete(executionId);
		logger.debug('Execution state cleaned up', { executionId });
	}

	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(result));
}
