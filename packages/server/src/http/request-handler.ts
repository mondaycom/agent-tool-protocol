import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { log } from '@mondaydotcomorg/atp-runtime';
import type { CacheProvider, AuthProvider, AuditSink } from '@mondaydotcomorg/atp-protocol';
import { parseBody } from '../core/http.js';
import { handleError, createContext } from '../utils/index.js';
import type { RequestContext, Middleware, ToolRulesProvider } from '../core/config.js';
import type { ClientSessionManager } from '../client-sessions.js';
import { runInRequestScope } from '../core/request-scope.js';

export interface RequestHandlerDeps {
	cacheProvider?: CacheProvider;
	authProvider?: AuthProvider;
	auditSink?: AuditSink;
	customLogger?: any;
	middleware: Middleware[];
	routeHandler: (ctx: RequestContext) => Promise<void>;
	sessionManager?: ClientSessionManager;
	toolRulesProvider?: ToolRulesProvider;
}

export async function handleHTTPRequest(
	req: IncomingMessage,
	res: ServerResponse,
	deps: RequestHandlerDeps,
	responseHeaders: Map<IncomingMessage, Map<string, string>>
): Promise<void> {
	const ctx = createContext({
		req,
		cacheProvider: deps.cacheProvider,
		authProvider: deps.authProvider,
		auditSink: deps.auditSink,
		customLogger: deps.customLogger,
		responseHeaders,
	});
	const headers = new Map<string, string>();
	responseHeaders.set(req, headers);

	if (deps.toolRulesProvider) {
		try {
			ctx.toolRules = deps.toolRulesProvider(ctx);
		} catch (error) {
			log.warn('Tool rules provider failed', { error });
		}
	}

	await runInRequestScope({ toolRules: ctx.toolRules }, async () => {
		try {
			if (req.method === 'POST' || req.method === 'PUT') {
				const reqWithBody = req as IncomingMessage & { body?: unknown };
				if (reqWithBody.body !== undefined) {
					ctx.body = reqWithBody.body;
				} else {
					ctx.body = await parseBody(req);
				}
			}

			await runMiddleware(ctx, deps.middleware, deps.routeHandler);

			try {
				const isStringResponse = typeof ctx.responseBody === 'string';
				res.writeHead(ctx.status, {
					'Content-Type': isStringResponse ? 'text/plain; charset=utf-8' : 'application/json',
					...Object.fromEntries(headers),
				});
				res.end(isStringResponse ? ctx.responseBody : JSON.stringify(ctx.responseBody));
			} catch (writeError) {}
		} catch (error) {
			try {
				handleError(res, error as Error, randomUUID(), headers);
			} catch (handlerError) {
				try {
					if (!res.headersSent) {
						res.writeHead(500, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'Internal server error' }));
					}
				} catch {}
			}
		} finally {
			responseHeaders.delete(req);
		}
	});
}

async function runMiddleware(
	ctx: RequestContext,
	middleware: Middleware[],
	routeHandler: (ctx: RequestContext) => Promise<void>
): Promise<void> {
	let index = 0;
	const next = async (): Promise<void> => {
		const mw = middleware[index++];
		if (mw) {
			await mw(ctx, next);
		} else {
			await routeHandler(ctx);
		}
	};
	await next();
}
