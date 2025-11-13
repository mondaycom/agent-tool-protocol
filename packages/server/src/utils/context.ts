import { IncomingMessage } from 'node:http';
import type { CacheProvider, AuthProvider, AuditSink } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';
import type { RequestContext } from '../core/config.js';
import { parseQuery } from '../core/http.js';

export interface CreateContextOptions {
	req: IncomingMessage;
	cacheProvider?: CacheProvider;
	authProvider?: AuthProvider;
	auditSink?: AuditSink;
	customLogger?: any;
	responseHeaders: Map<IncomingMessage, Map<string, string>>;
}

/**
 * Creates a request context object with all necessary helpers and providers
 */
export function createContext(options: CreateContextOptions): RequestContext {
	const { req, cacheProvider, authProvider, auditSink, customLogger, responseHeaders } = options;

	const clientId = (req.headers['x-client-id'] as string) || undefined;
	const userId = (req.headers['x-user-id'] as string) || undefined;

	const url = req.url || '/';
	const queryIndex = url.indexOf('?');
	const path = queryIndex === -1 ? url : url.substring(0, queryIndex);

	return {
		method: req.method || 'GET',
		path,
		query: parseQuery(url),
		headers: req.headers as Record<string, string>,
		body: null,
		status: 200,
		responseBody: null,
		clientId,
		userId,
		cache: cacheProvider,
		auth: authProvider,
		audit: auditSink,
		logger: customLogger || log,
		throw: (status, message) => {
			const error = new Error(message) as any;
			error.status = status;
			throw error;
		},
		assert: (condition, message) => {
			if (!condition) {
				const error = new Error(message) as any;
				error.status = 400;
				throw error;
			}
		},
		set: (header, value) => {
			if (!responseHeaders.has(req)) {
				responseHeaders.set(req, new Map());
			}
			responseHeaders.get(req)!.set(header, value);
		},
	};
}
