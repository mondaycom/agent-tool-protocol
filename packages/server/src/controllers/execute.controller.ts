import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExecutionConfig } from '@mondaydotcomorg/atp-protocol';
import { ExecutionErrorCode, sanitizeInput, MAX_CODE_SIZE } from '@mondaydotcomorg/atp-protocol';
import type { CodeValidator } from '../validator/index.js';
import type { SandboxExecutor } from '@mondaydotcomorg/atp-engine';
import type { ExecutionStateManager } from '../execution-state/index.js';
import type { AuditConfig } from '../middleware/audit.js';
import { auditExecution } from '../middleware/audit.js';
import { clientCallbackManager } from '../callback/index.js';
import { nanoid } from 'nanoid';
import type { log } from '@mondaydotcomorg/atp-runtime';

interface ExecuteContext {
	validator: CodeValidator;
	executor: SandboxExecutor;
	stateManager: ExecutionStateManager;
	auditConfig?: AuditConfig;
	defaultTimeout: number;
	defaultMemoryLimit: number;
	defaultLLMCallLimit: number;
}

export async function handleExecute(
	req: IncomingMessage,
	res: ServerResponse,
	context: ExecuteContext,
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

	if (clientId && request.config?.clientServices) {
		clientCallbackManager.registerClient(clientId, request.config.clientServices);
		logger.info('Client services registered', {
			clientId,
			services: request.config.clientServices,
		});
	}

	if (clientId) {
		clientCallbackManager.updateClientActivity(clientId);
	}

	const executionConfig: ExecutionConfig = {
		timeout: request.config?.timeout ?? context.defaultTimeout,
		maxMemory: request.config?.maxMemory ?? context.defaultMemoryLimit,
		maxLLMCalls: request.config?.maxLLMCalls ?? context.defaultLLMCallLimit,
		allowedAPIs: request.config?.allowedAPIs ?? [],
		allowLLMCalls: request.config?.allowLLMCalls ?? true,
		clientServices: request.config?.clientServices,
		provenanceMode: request.config?.provenanceMode,
		securityPolicies: request.config?.securityPolicies,
		provenanceHints: request.config?.provenanceHints,
	};

	logger.info('Validating code for execution', {
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

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				executionId: nanoid(),
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
					httpCallsCount: 0,
				},
			})
		);
		return;
	}

	logger.info('Executing code in sandbox');
	const result = await context.executor.execute(request.code, executionConfig, clientId);

	logger.info('Code execution completed', {
		executionId: result.executionId,
		status: result.status,
		duration: result.stats.duration,
		memoryUsed: result.stats.memoryUsed,
		llmCalls: result.stats.llmCallsCount,
		approvalCalls: result.stats.approvalCallsCount,
	});

	if (result.status === 'paused' && result.needsCallback && clientId && result.callbackHistory) {
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

		logger.info('Execution state saved', {
			executionId: result.executionId,
			callbackType: result.needsCallback.type,
			storage: context.stateManager.getStorageType(),
			historyLength: result.callbackHistory.length,
		});
	}

	if (context.auditConfig?.enabled) {
		await auditExecution({
			executionId: result.executionId,
			apiKey: (req as any).apiKey,
			ip: req.socket.remoteAddress,
			code: request.code,
			result,
		});
	}

	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(result));
}
