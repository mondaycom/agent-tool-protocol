import type { RequestContext, ResolvedServerConfig } from '../core/config.js';
import type { SearchEngine } from '../search/index.js';
import { runInRequestScope, getRequestScope } from '../core/request-scope.js';

export async function handleSearch(
	ctx: RequestContext,
	searchEngine: SearchEngine,
	config: ResolvedServerConfig
): Promise<unknown> {
	const searchOptions = ctx.body as any;
	const { toolRules, ...cleanOptions } = searchOptions;

	const executeSearch = async () => {
		const results = await searchEngine.search(
			cleanOptions,
			ctx.userId,
			ctx.auth,
			config.discovery.scopeFiltering
		);
		return { results };
	};

	if (toolRules && !getRequestScope()?.toolRules) {
		return runInRequestScope({ toolRules }, executeSearch);
	}

	return executeSearch();
}

export async function handleSearchQuery(
	ctx: RequestContext,
	searchEngine: SearchEngine,
	config: ResolvedServerConfig
): Promise<unknown> {
	const query = ctx.query.query || ctx.query.keyword || '';
	const results = await searchEngine.search(
		{ query },
		ctx.userId,
		ctx.auth,
		config.discovery.scopeFiltering
	);
	return { results };
}
