import type { RequestContext, ResolvedServerConfig } from '../core/config.js';
import type { SandboxExecutor } from '../executor/index.js';
import type { ExecutionStateManager } from '../execution-state/index.js';
import type { ClientSessionManager } from '../client-sessions.js';
import { log } from '@mondaydotcomorg/atp-runtime';
import { ExecutionStatus, ProvenanceMode } from '@mondaydotcomorg/atp-protocol';
import {
	restoreProvenanceSnapshot,
	captureProvenanceSnapshot,
	createProvenanceProxy,
	markPrimitiveTainted,
	ProvenanceSource,
	type ProvenanceSnapshot,
	type ProvenanceState,
	type SourceMetadata,
} from '@mondaydotcomorg/atp-provenance';
import { nanoid } from 'nanoid';

/**
 * Tag a callback result with provenance metadata
 */
function tagCallbackResult(
	callbackRecord: { type: string; operation: string; payload: any },
	result: unknown,
	provenanceMode?: string
): unknown {
	// Don't tag if provenance is disabled or not specified
	// ProvenanceMode.NONE is 'none', so just check for falsy or 'none'
	if (!provenanceMode || provenanceMode === ProvenanceMode.NONE) {
		return result;
	}

	if (result === null || result === undefined) {
		return result;
	}

	const tagValue = (value: unknown, source: SourceMetadata): unknown => {
		if (value === null || value === undefined) {
			return value;
		}

		// Primitive: taint it
		if (typeof value === 'string' || typeof value === 'number') {
			const metadata = {
				id: nanoid(),
				source,
				readers: { type: 'public' as const },
				dependencies: [],
				context: {},
			};
			markPrimitiveTainted(value, metadata);
			return value;
		}

		// Objects/arrays: create provenance proxy
		if (typeof value === 'object') {
			return createProvenanceProxy(value, source, { type: 'public' });
		}

		return value;
	};

	// Determine source based on callback type
	if (callbackRecord.type === 'llm') {
		const source: SourceMetadata = {
			type: ProvenanceSource.LLM,
			operation: (callbackRecord.operation as 'call' | 'extract' | 'classify') || 'call',
			timestamp: Date.now(),
		};
		return Array.isArray(result)
			? result.map((r) => tagValue(r, source))
			: tagValue(result, source);
	}

	if (callbackRecord.type === 'tool') {
		const source: SourceMetadata = {
			type: ProvenanceSource.TOOL,
			toolName: (callbackRecord.payload as any)?.toolName || 'clientTool',
			apiGroup: (callbackRecord.payload as any)?.namespace || 'client',
			timestamp: Date.now(),
		};
		return Array.isArray(result)
			? result.map((r) => tagValue(r, source))
			: tagValue(result, source);
	}

	// No tagging for other callback types
	return result;
}

export async function handleResume(
	ctx: RequestContext,
	executionId: string,
	executor: SandboxExecutor,
	stateManager: ExecutionStateManager,
	serverConfig: ResolvedServerConfig,
	sessionManager?: ClientSessionManager
): Promise<unknown> {
	const requestClientId = ctx.headers['x-client-id'] || ctx.clientId;
	const requestToken = ctx.headers['authorization']?.replace('Bearer ', '');

	if (!requestClientId || !requestToken) {
		log.warn('Resume attempt without authentication', { executionId });
		ctx.throw(401, 'Authentication required');
	}

	ctx.clientId = requestClientId;

	if (sessionManager) {
		const isValid = await sessionManager.verifyClient(requestClientId, requestToken);
		if (!isValid) {
			log.warn('Resume attempt with invalid token', { executionId, clientId: requestClientId });
			ctx.throw(403, 'Invalid client credentials');
		}
	}

	const pausedState = await stateManager.get(executionId);

	if (!pausedState) {
		ctx.throw(404, 'Not found');
	}

	if (pausedState.clientId !== requestClientId) {
		log.warn('Resume attempt by unauthorized client', {
			executionId,
			requestClientId,
			ownerClientId: pausedState.clientId,
		});
		ctx.throw(403, 'Unauthorized: execution belongs to different client');
	}

	log.info('Resume authorized', { executionId, clientId: requestClientId });

	if (
		pausedState.provenanceState &&
		pausedState.config.provenanceMode &&
		pausedState.config.provenanceMode !== ProvenanceMode.NONE
	) {
		// Check if it's a ProvenanceSnapshot (with primitives) or old ProvenanceState
		const state = pausedState.provenanceState;
		if ('primitives' in state) {
			// New snapshot format
			restoreProvenanceSnapshot(executionId, state as ProvenanceSnapshot);
			log.info('Provenance snapshot restored', {
				executionId,
				registryEntries: state.registry.length,
				primitiveEntries: state.primitives.length,
			});
		} else {
			// Old state format (backward compat)
			const provenanceMap = new Map<string, any>(state.registry);
			restoreProvenanceSnapshot(executionId, {
				registry: state.registry,
				primitives: [],
			});
			log.info('Provenance state restored (legacy format)', {
				executionId,
				entries: provenanceMap.size,
			});
		}
	}

	const request = ctx.body as any;

	let updatedHistory: any[];
	let callbackResult: unknown;

	const lastRecord = pausedState.callbackHistory[pausedState.currentCallbackIndex];

	if (!lastRecord) {
		log.error('No callback record found at current index', {
			executionId,
			currentIndex: pausedState.currentCallbackIndex,
		});
		ctx.throw(500, 'Invalid paused state: no callback record');
	}

	if (request.results) {
		const batchResults = request.results as Array<{ id: string; result: unknown }>;
		log.info('Processing batch callback results', {
			executionId,
			batchCount: batchResults.length,
		});

		for (const br of batchResults) {
			if (br.result && typeof br.result === 'object' && '__error' in br.result) {
				const errorObj = br.result as { __error: boolean; message: string };
				if (errorObj.message && errorObj.message.includes('service not provided')) {
					log.error('Service provider error in batch', { executionId, error: errorObj.message });
					await stateManager.delete(executionId);
					return {
						executionId,
						status: ExecutionStatus.FAILED,
						error: {
							message: errorObj.message || 'Service not available',
							code: 'SERVICE_NOT_PROVIDED',
						},
						stats: {
							duration: 0,
							memoryUsed: 0,
							llmCallsCount: 0,
							approvalCallsCount: 0,
						},
					};
				}
			}
		}

		// Tag batch results
		const taggedBatchResults = batchResults.map((br) => ({
			...br,
			result: tagCallbackResult(lastRecord, br.result, pausedState.config.provenanceMode),
		}));
		callbackResult = taggedBatchResults.map((br) => br.result);

		updatedHistory = pausedState.callbackHistory.map((record, index) => {
			if (index === pausedState.currentCallbackIndex) {
				return { ...record, result: callbackResult };
			}
			return record;
		});
	} else {
		// Tag single result
		const rawResult = request.result;

		// Check for service provider errors (not tool errors)
		if (rawResult && typeof rawResult === 'object' && '__error' in rawResult) {
			const errorObj = rawResult as { __error: boolean; message: string };
			// Only fail execution for service provider errors (service not available)
			if (errorObj.message && errorObj.message.includes('service not provided')) {
				log.error('Service provider error', { executionId, error: errorObj.message });
				await stateManager.delete(executionId);
				return {
					executionId,
					status: ExecutionStatus.FAILED,
					error: {
						message: errorObj.message || 'Service not available',
						code: 'SERVICE_NOT_PROVIDED',
					},
					stats: {
						duration: 0,
						memoryUsed: 0,
						llmCallsCount: 0,
						approvalCallsCount: 0,
					},
				};
			}
		}

		callbackResult = tagCallbackResult(lastRecord, rawResult, pausedState.config.provenanceMode);

		updatedHistory = pausedState.callbackHistory.map((record, index) => {
			if (index === pausedState.currentCallbackIndex) {
				return { ...record, result: callbackResult };
			}
			return record;
		});
	}

	const restoredConfig = {
		...pausedState.config,
		securityPolicies: serverConfig.execution.securityPolicies || [],
	};

	const result = await executor.execute(pausedState.code, restoredConfig, pausedState.clientId, {
		callbackHistory: updatedHistory,
		newCallbackResult: callbackResult,
		executionId,
	});

	if (result.status === ExecutionStatus.PAUSED && result.needsCallbacks && result.callbackHistory) {
		const provenanceState =
			pausedState.config.provenanceMode && pausedState.config.provenanceMode !== ProvenanceMode.NONE
				? captureProvenanceSnapshot(result.executionId)
				: undefined;

		const codeToSave = (result as any).transformedCode || pausedState.code;

		await stateManager.pause({
			executionId: result.executionId,
			code: codeToSave,
			config: pausedState.config,
			clientId: pausedState.clientId,
			callbackRequest: result.needsCallbacks[0]!,
			pausedAt: Date.now(),
			callbackHistory: result.callbackHistory,
			currentCallbackIndex: result.callbackHistory.length - 1,
			context: {},
			provenanceState,
		});
	} else if (
		result.status === ExecutionStatus.PAUSED &&
		result.needsCallback &&
		result.callbackHistory
	) {
		const provenanceState =
			pausedState.config.provenanceMode && pausedState.config.provenanceMode !== ProvenanceMode.NONE
				? captureProvenanceSnapshot(result.executionId)
				: undefined;

		const codeToSave = (result as any).transformedCode || pausedState.code;
		await stateManager.pause({
			executionId: result.executionId,
			code: codeToSave,
			config: pausedState.config,
			clientId: pausedState.clientId,
			callbackRequest: result.needsCallback,
			pausedAt: Date.now(),
			callbackHistory: result.callbackHistory,
			currentCallbackIndex: result.callbackHistory.length - 1,
			context: {},
			provenanceState,
		});
	} else {
		await stateManager.delete(executionId);
	}

	return result;
}
