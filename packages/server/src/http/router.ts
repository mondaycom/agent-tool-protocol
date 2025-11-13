import type { RequestContext } from '../core/config.js';
import type { AgentToolProtocolServer } from '../create-server.js';

export async function handleRoute(
	ctx: RequestContext,
	server: AgentToolProtocolServer
): Promise<void> {
	if (ctx.path === '/api/info' && ctx.method === 'GET') {
		ctx.responseBody = server.getInfo();
	} else if (ctx.path === '/api/definitions' && ctx.method === 'GET') {
		ctx.responseBody = await server.getDefinitions(ctx);
	} else if (ctx.path === '/api/runtime' && ctx.method === 'GET') {
		ctx.responseBody = await server.getRuntimeDefinitions(ctx);
	} else if (ctx.path === '/api/init' && ctx.method === 'POST') {
		ctx.responseBody = await server.handleInit(ctx);
	} else if (ctx.path === '/api/search' && ctx.method === 'POST') {
		ctx.responseBody = await server.handleSearch(ctx);
	} else if (ctx.path.startsWith('/api/search') && ctx.method === 'GET') {
		ctx.responseBody = await server.handleSearchQuery(ctx);
	} else if (ctx.path === '/api/explore' && ctx.method === 'POST') {
		ctx.responseBody = await server.handleExplore(ctx);
	} else if (ctx.path === '/api/execute' && ctx.method === 'POST') {
		ctx.responseBody = await server.handleExecute(ctx);
	} else if (ctx.path.startsWith('/api/resume/') && ctx.method === 'POST') {
		const executionId = ctx.path.substring('/api/resume/'.length);
		ctx.responseBody = await server.handleResume(ctx, executionId);
	} else {
		ctx.status = 404;
		ctx.responseBody = { error: 'Not found' };
	}
}
