import type { RequestContext, ResolvedServerConfig } from '../core/config.js';
import type { SandboxExecutor } from '../executor/index.js';
import type { ExecutionStateManager } from '../execution-state/index.js';
import type { ClientSessionManager } from '../client-sessions.js';
import type { AuditSink, AuditEvent } from '@mondaydotcomorg/atp-protocol';
import { ExecutionStatus, ProvenanceMode } from '@mondaydotcomorg/atp-protocol';
import { nanoid } from 'nanoid';
import {
	captureProvenanceSnapshot,
	verifyProvenanceHints,
	type ProvenanceMetadata,
} from '@mondaydotcomorg/atp-provenance';
import { emitProvenanceTokens } from '../utils/token-emitter.js';
import { storeHintMap, clearHintMap } from '../utils/provenance-reattachment.js';
import { log } from '@mondaydotcomorg/atp-runtime';

/**
 * Recursively remove __prov_id__ properties from result
 * Handles both enumerable and non-enumerable properties
 */
function cleanProvenanceIds(value: unknown): unknown {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => cleanProvenanceIds(item));
	}
	const cleaned: Record<string, unknown> = {};
	// Use Object.getOwnPropertyNames to get ALL properties (including non-enumerable)
	const allKeys = Object.getOwnPropertyNames(value);
	for (const key of allKeys) {
		if (key !== '__prov_id__') {
			cleaned[key] = cleanProvenanceIds((value as Record<string, unknown>)[key]);
		}
	}
	return cleaned;
}

export async function handleExecute(
	ctx: RequestContext,
	executor: SandboxExecutor,
	stateManager: ExecutionStateManager,
	config: ResolvedServerConfig,
	auditSink?: AuditSink,
	sessionManager?: ClientSessionManager
): Promise<unknown> {
	const request = ctx.body as any;
	const code = request.code || '';
	const requestConfig = request.config || request.options || {};

	if (sessionManager && ctx.clientId && ctx.clientId !== 'anonymous') {
		const requestToken = ctx.headers['authorization']?.replace('Bearer ', '');

		if (!requestToken) {
			log.warn('Execute attempt without token', { clientId: ctx.clientId });
			ctx.throw(401, 'Authentication error: Invalid token or client ID mismatch');
		}

		const isValid = await sessionManager.verifyClient(ctx.clientId, requestToken);
		if (!isValid) {
			log.warn('Execute attempt with invalid token', { clientId: ctx.clientId });
			ctx.throw(403, 'Authentication error: Invalid token or client ID mismatch');
		}
	}

	const memoryInBytes =
		requestConfig.memoryLimit || requestConfig.memory || config.execution.memory;

	let clientServices = requestConfig.clientServices;
	if (sessionManager && ctx.clientId && ctx.clientId !== 'anonymous') {
		try {
			const session = await sessionManager.getSession(ctx.clientId);
			const hasTools = session?.tools && session.tools.length > 0;

			clientServices = {
				...clientServices,
				hasTools: hasTools || false,
			};
		} catch (error) {}
	}

	const executionConfig = {
		timeout: requestConfig.timeout || config.execution.timeout,
		maxMemory: memoryInBytes,
		maxLLMCalls: requestConfig.llmCalls || config.execution.llmCalls,
		allowedAPIs: [],
		allowLLMCalls: true,
		clientServices,
		provenanceMode:
			requestConfig.provenanceMode || config.execution.provenanceMode || ProvenanceMode.NONE,
		securityPolicies: config.execution.securityPolicies || [],
		provenanceHints: requestConfig.provenanceHints,
	};

	// Verify provenance hints if provided
	let hintMap: Map<string, ProvenanceMetadata> | undefined;
	const prelimExecutionId = nanoid();
	if (
		executionConfig.provenanceHints &&
		executionConfig.provenanceHints.length > 0 &&
		executionConfig.provenanceMode !== ProvenanceMode.NONE &&
		ctx.cache
	) {
		try {
			// Cap hints at 1000
			if (executionConfig.provenanceHints.length > 1000) {
				log.warn('Provenance hints capped', {
					provided: executionConfig.provenanceHints.length,
					capped: 1000,
				});
				ctx.throw(400, 'Too many provenance hints (max 1000)');
			}

			hintMap = await verifyProvenanceHints(
				executionConfig.provenanceHints,
				ctx.clientId || 'anonymous',
				prelimExecutionId,
				ctx.cache,
				1000 // maxHints
			);

			// Store hint map for this execution
			if (hintMap && hintMap.size > 0) {
				storeHintMap(prelimExecutionId, hintMap);
			}

			log.info('Provenance hints verified', {
				hintsProvided: executionConfig.provenanceHints.length,
				hintsValid: hintMap.size,
				executionId: prelimExecutionId,
			});
		} catch (error) {
			log.error('Failed to verify provenance hints', { error });
		}
	}

	const startTime = Date.now();

	if (auditSink) {
		const startEvent: AuditEvent = {
			eventId: nanoid(),
			timestamp: startTime,
			clientId: ctx.clientId || 'anonymous',
			eventType: 'execution',
			action: 'start',
			code,
			status: 'success',
		};
		await auditSink.write(startEvent).catch(() => {});
	}

	// Pass the prelimExecutionId so executor can access hints
	const result = await executor.execute(code, executionConfig, ctx.clientId, {
		callbackHistory: [],
		newCallbackResult: undefined,
		executionId: prelimExecutionId,
	});

	// Emit provenance tokens for completed executions
	if (
		result.status === ExecutionStatus.COMPLETED &&
		executionConfig.provenanceMode &&
		executionConfig.provenanceMode !== ProvenanceMode.NONE &&
		ctx.cache &&
		(result as any).provenanceSnapshot
	) {
		try {
			log.info('Attempting to emit provenance tokens from snapshot', {
				executionId: result.executionId,
				provenanceMode: executionConfig.provenanceMode,
				hasCache: !!ctx.cache,
				hasSnapshot: !!(result as any).provenanceSnapshot,
				resultType: typeof result.result,
			});
			const tokens = await emitProvenanceTokens(
				result.result,
				ctx.clientId || 'anonymous',
				result.executionId,
				executionConfig.provenanceMode,
				ctx.cache,
				log.child({ executionId: result.executionId }),
				5000, // maxTokens
				3600, // tokenTTL (1hr)
				(result as any).provenanceSnapshot // Pass snapshot
			);
			log.info('Provenance tokens emitted', {
				executionId: result.executionId,
				tokenCount: tokens.length,
			});
			if (tokens.length > 0) {
				(result as any).provenanceTokens = tokens;
			}
		} catch (error) {
			log.error('Failed to emit provenance tokens', { error, executionId: result.executionId });
		}
	}

	// Always clean snapshot and provenance IDs before returning
	delete (result as any).provenanceSnapshot;
	if (result.result && typeof result.result === 'object') {
		const hasProv = '__prov_id__' in result.result;
		(result as any).result = cleanProvenanceIds(result.result);
		const stillHasProv =
			result.result && typeof result.result === 'object' && '__prov_id__' in result.result;
		if (hasProv && !stillHasProv) {
			log.debug('Successfully cleaned __prov_id__ from result');
		} else if (hasProv && stillHasProv) {
			log.warn('Failed to clean __prov_id__ from result!');
		}
	}

	if (auditSink) {
		const endEvent: AuditEvent = {
			eventId: nanoid(),
			timestamp: Date.now(),
			clientId: ctx.clientId || 'anonymous',
			eventType: 'execution',
			action: result.status === ExecutionStatus.PAUSED ? 'pause' : 'complete',
			resourceId: result.executionId,
			status:
				result.status === ExecutionStatus.COMPLETED
					? 'success'
					: result.status === ExecutionStatus.FAILED
						? 'failed'
						: 'paused',
			duration: Date.now() - startTime,
			memoryUsed: result.stats?.memoryUsed,
			llmCallsCount: result.stats?.llmCallsCount,
			error: result.error
				? {
						message: result.error.message,
						code: result.error.code,
						stack: result.error.stack,
					}
				: undefined,
		};
		await auditSink.write(endEvent).catch(() => {});
	}

	if (
		result.status === 'paused' &&
		(result.needsCallback || result.needsCallbacks) &&
		result.callbackHistory
	) {
		if (!ctx.clientId) {
			ctx.throw(400, 'Client ID required for paused executions');
		}

		const provenanceSnap =
			executionConfig.provenanceMode && executionConfig.provenanceMode !== ProvenanceMode.NONE
				? captureProvenanceSnapshot(result.executionId)
				: undefined;

		const callbackRequest =
			result.needsCallback || (result.needsCallbacks && result.needsCallbacks[0]);

		if (!callbackRequest) {
			ctx.throw(500, 'Invalid paused state: no callback request');
		}

		const transformedCodeToSave = (result as any).transformedCode || code;
		await stateManager.pause({
			executionId: result.executionId,
			code: transformedCodeToSave,
			config: executionConfig,
			clientId: ctx.clientId,
			callbackRequest,
			pausedAt: Date.now(),
			callbackHistory: result.callbackHistory,
			currentCallbackIndex: result.callbackHistory.length - 1,
			context: {
				codeTransformed: !!(result as any).transformedCode,
			},
			provenanceState: provenanceSnap,
		});
	}

	// Cleanup hint map
	if (hintMap && hintMap.size > 0) {
		clearHintMap(prelimExecutionId);
	}

	return result;
}
