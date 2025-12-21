import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExecutionConfig, ATPEvent } from '@mondaydotcomorg/atp-protocol';
import {
	ExecutionErrorCode,
	validateExecutionConfig,
	sanitizeInput,
	MAX_CODE_SIZE,
} from '@mondaydotcomorg/atp-protocol';
import type { CodeValidator } from '../validator/index.js';
import type { SandboxExecutor } from '../executor/index.js';
import type { ExecutionStateManager } from '../execution-state/index.js';
import { randomUUID } from 'node:crypto';
import type { log } from '@mondaydotcomorg/atp-runtime';

interface StreamContext {
	validator: CodeValidator;
	executor: SandboxExecutor;
	stateManager?: ExecutionStateManager;
	auditConfig?: { enabled: boolean };
	defaultTimeout: number;
	defaultMemoryLimit: number;
	defaultLLMCallLimit: number;
}

export async function handleExecuteStream(
	req: IncomingMessage,
	res: ServerResponse,
	context: StreamContext,
	body: string,
	clientId: string | undefined,
	logger: ReturnType<typeof log.child>
): Promise<void> {
	let request: { code: string; config?: Partial<ExecutionConfig> };

	try {
		request = JSON.parse(body);
	} catch (error) {
		logger.warn('Invalid request body', { error });
		res.writeHead(400, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				error: 'Invalid request body',
				message: error instanceof Error ? error.message : 'Failed to parse request',
			})
		);
		return;
	}

	request.code = sanitizeInput(request.code, MAX_CODE_SIZE);

	logger.info('Streaming code execution request', {
		codeLength: request.code.length,
	});

	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
	});

	const sendEvent = (event: string, data: unknown) => {
		res.write(`event: ${event}\n`);
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	try {
		if (request.config) {
			try {
				validateExecutionConfig(request.config);
			} catch (error) {
				logger.warn('Invalid execution config', { error });
				sendEvent('error', {
					message: error instanceof Error ? error.message : 'Invalid configuration',
				});
				res.end();
				return;
			}
		}

		const executionConfig: ExecutionConfig = {
			timeout: request.config?.timeout ?? context.defaultTimeout,
			maxMemory: request.config?.maxMemory ?? context.defaultMemoryLimit,
			maxLLMCalls: request.config?.maxLLMCalls ?? context.defaultLLMCallLimit,
			allowedAPIs: request.config?.allowedAPIs ?? [],
			allowLLMCalls: request.config?.allowLLMCalls ?? true,
			progressCallback: (message: string, fraction: number) => {
				sendEvent('progress', { message, fraction });
			},
			eventCallback: (event: ATPEvent) => {
				sendEvent(event.type, event.data);
			},
			clientServices: request.config?.clientServices,
			provenanceMode: request.config?.provenanceMode,
			securityPolicies: request.config?.securityPolicies,
			provenanceHints: request.config?.provenanceHints,
			toolRules: request.config?.toolRules,
		};

		logger.info('Validating code for streaming execution', {
			codeLength: request.code.length,
			timeout: executionConfig.timeout,
			clientServices: executionConfig.clientServices,
		});

		const validationResult = await context.validator.validate(request.code, executionConfig);

		if (!validationResult.valid) {
			logger.warn('Code validation failed', {
				errors: validationResult.errors?.length,
				securityIssues: validationResult.securityIssues?.length,
			});

			const hasSecurityIssues =
				validationResult.securityIssues && validationResult.securityIssues.length > 0;

			sendEvent('result', {
				executionId: randomUUID(),
				status: hasSecurityIssues ? 'security_violation' : 'validation_failed',
				error: {
					message: 'Code validation failed',
					code: hasSecurityIssues
						? ExecutionErrorCode.SECURITY_VIOLATION
						: ExecutionErrorCode.VALIDATION_FAILED,
					context: {
						errors: validationResult.errors,
						securityIssues: validationResult.securityIssues,
					},
					retryable: false,
					suggestion: hasSecurityIssues
						? 'Remove forbidden operations and use only allowed APIs'
						: 'Fix syntax errors and validation issues in your code',
				},
				stats: {
					duration: 0,
					memoryUsed: 0,
					llmCallsCount: 0,
					approvalCallsCount: 0,
				},
			});
			res.end();
			return;
		}

		sendEvent('start', { message: 'Execution started' });

		logger.info('Executing code in sandbox (streaming)');
		const result = await context.executor.execute(request.code, executionConfig, clientId);

		logger.info('Code execution completed (streaming)', {
			executionId: result.executionId,
			status: result.status,
			duration: result.stats.duration,
		});

		if (
			result.status === 'paused' &&
			result.needsCallback &&
			result.callbackHistory &&
			context.stateManager
		) {
			if (!clientId) {
				sendEvent('error', { message: 'Client ID required for paused executions' });
				res.end();
				return;
			}

			await context.stateManager.pause({
				executionId: result.executionId,
				code: request.code,
				config: executionConfig,
				clientId,
				callbackRequest: result.needsCallback,
				pausedAt: Date.now(),
				callbackHistory: result.callbackHistory,
				currentCallbackIndex: result.callbackHistory.length - 1,
				context: {},
			});

			logger.info('Execution state saved (streaming)', {
				executionId: result.executionId,
				callbackType: result.needsCallback.type,
				historyLength: result.callbackHistory.length,
			});
		}

		sendEvent('result', result);
		res.end();
	} catch (error) {
		const err = error as Error;
		logger.error('Streaming execution error', { error: err.message });
		sendEvent('error', { message: err.message, stack: err.stack });
		res.end();
	}
}
