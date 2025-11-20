import type { IncomingMessage, ServerResponse } from 'node:http';
import type { log } from '@mondaydotcomorg/atp-runtime';
import { handleInfo } from '../controllers/info.controller.js';
import { handleDefinitions } from '../controllers/definitions.controller.js';
import { handleSearch } from '../controllers/search.controller.js';
import { handleExecute } from '../controllers/execute.controller.js';
import { handleExecuteStream } from '../controllers/stream.controller.js';
import { handleResume } from '../controllers/resume.controller.js';
import type { APIAggregator } from '@mondaydotcomorg/atp-engine';
import type { SearchEngine } from '../search/index.js';
import type { CodeValidator } from '../validator/index.js';
import type { SandboxExecutor } from '@mondaydotcomorg/atp-engine';
import type { ExecutionStateManager } from '../execution-state/index.js';
import type { AuditConfig } from '../middleware/audit.js';
import { readBody } from '../utils/index.js';

export interface RouteContext {
	aggregator: APIAggregator;
	searchEngine: SearchEngine;
	validator: CodeValidator;
	executor: SandboxExecutor;
	stateManager: ExecutionStateManager;
	auditConfig?: AuditConfig;
	defaultTimeout: number;
	defaultMemoryLimit: number;
	defaultLLMCallLimit: number;
}

export async function handleRoute(
	req: IncomingMessage,
	res: ServerResponse,
	context: RouteContext,
	logger: ReturnType<typeof log.child>
): Promise<boolean> {
	const clientId = req.headers['x-client-id'] as string | undefined;
	const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

	if (url.pathname === '/api/info' && req.method === 'GET') {
		logger.debug('Serving API info');
		await handleInfo(req, res);
		return true;
	}

	if (url.pathname === '/api/definitions' && req.method === 'GET') {
		logger.debug('Serving API definitions');
		await handleDefinitions(req, res, context.aggregator, url);
		return true;
	}

	if (url.pathname === '/api/search' && req.method === 'POST') {
		logger.debug('Searching API functions');
		const body = await readBody(req);
		await handleSearch(req, res, context.searchEngine, body);
		return true;
	}

	if (url.pathname.match(/^\/api\/resume\/[^/]+$/) && req.method === 'POST') {
		const executionId = url.pathname.split('/').pop()!;
		const body = await readBody(req);
		await handleResume(
			req,
			res,
			{ executor: context.executor, stateManager: context.stateManager },
			executionId,
			body,
			logger
		);
		return true;
	}

	if (url.pathname === '/api/execute' && req.method === 'POST') {
		const body = await readBody(req);
		await handleExecuteStream(
			req,
			res,
			{
				validator: context.validator,
				executor: context.executor,
				stateManager: context.stateManager,
				auditConfig: context.auditConfig,
				defaultTimeout: context.defaultTimeout,
				defaultMemoryLimit: context.defaultMemoryLimit,
				defaultLLMCallLimit: context.defaultLLMCallLimit,
			},
			body,
			clientId,
			logger
		);
		return true;
	}

	return false;
}
