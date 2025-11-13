import { IncomingMessage, ServerResponse } from 'node:http';
import { nanoid } from 'nanoid';
import { log } from '@mondaydotcomorg/atp-runtime';
import type { CacheProvider, AuthProvider, AuditSink } from '@mondaydotcomorg/atp-protocol';
import { parseBody } from '../core/http.js';
import { handleError, createContext } from '../utils/index.js';
import type { RequestContext, Middleware } from '../core/config.js';
import type { ClientSessionManager } from '../client-sessions.js';

export interface RequestHandlerDeps {
	cacheProvider?: CacheProvider;
	authProvider?: AuthProvider;
	auditSink?: AuditSink;
	customLogger?: any;
	middleware: Middleware[];
	routeHandler: (ctx: RequestContext) => Promise<void>;
	sessionManager?: ClientSessionManager;
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

	try {
		if (req.method === 'POST' || req.method === 'PUT') {
			ctx.body = await parseBody(req);
		}

		await runMiddleware(ctx, deps.middleware, deps.routeHandler);

		try {
			if (ctx.clientId && deps.sessionManager && ctx.path !== '/api/init') {
				try {
					const newToken = deps.sessionManager.generateToken(ctx.clientId);
					const expiresAt = Date.now() + 60 * 60 * 1000;

					headers.set('X-ATP-Token', newToken);
					headers.set('X-ATP-Token-Expires', expiresAt.toString());
				} catch (error) {}
			}

			const isStringResponse = typeof ctx.responseBody === 'string';
			res.writeHead(ctx.status, {
				'Content-Type': isStringResponse ? 'text/plain; charset=utf-8' : 'application/json',
				...Object.fromEntries(headers),
			});
			res.end(isStringResponse ? ctx.responseBody : JSON.stringify(ctx.responseBody));
		} catch (writeError) {}
	} catch (error) {
		try {
			if (ctx.clientId && deps.sessionManager && ctx.path !== '/api/init') {
				try {
					const newToken = deps.sessionManager.generateToken(ctx.clientId);
					const expiresAt = Date.now() + 60 * 60 * 1000;

					headers.set('X-ATP-Token', newToken);
					headers.set('X-ATP-Token-Expires', expiresAt.toString());

					log.debug('Token refresh headers set on error', {
						clientId: ctx.clientId,
						path: ctx.path,
						hasSessionManager: !!deps.sessionManager,
						headerCount: headers.size,
					});
				} catch (tokenError) {
					log.warn('Token refresh failed on error', { error: tokenError });
				}
			} else {
				log.debug('Token refresh skipped on error', {
					hasClientId: !!ctx.clientId,
					hasSessionManager: !!deps.sessionManager,
					path: ctx.path,
				});
			}

			handleError(res, error as Error, nanoid(), headers);
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
