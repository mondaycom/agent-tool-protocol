import type { RequestContext } from '../core/config.js';
import type { ToolRulesProvider } from '../core/config.js';
import type { ExplorerService } from '../explorer/index.js';
import type { ApiGroupRules } from '@mondaydotcomorg/atp-protocol';
import { runInRequestScope, getRequestScope } from '../core/request-scope.js';

export async function handleExplore(
	ctx: RequestContext,
	explorerService: ExplorerService,
	toolRulesProvider?: ToolRulesProvider
): Promise<unknown> {
	const body = ctx.body as { path?: string; toolRules?: ApiGroupRules };
	const path = body.path || '/';

	// Rule source precedence (highest to lowest):
	//   1. body.toolRules                          — explicit per-call override
	//   2. toolRulesProvider(ctx)                  — server-level policy (e.g. read a header)
	//   3. existing request scope                  — already wrapped by caller
	const effectiveToolRules: ApiGroupRules | undefined =
		body.toolRules ?? (toolRulesProvider ? toolRulesProvider(ctx) : undefined);

	const executeExplore = () => {
		const result = explorerService.explore(path);

		if (!result) {
			ctx.throw(404, `Path not found: ${path}`);
		}

		return result;
	};

	if (effectiveToolRules && !getRequestScope()?.toolRules) {
		return runInRequestScope({ toolRules: effectiveToolRules }, executeExplore);
	}

	return executeExplore();
}
