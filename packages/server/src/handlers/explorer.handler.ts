import type { RequestContext } from '../core/config.js';
import type { ExplorerService } from '../explorer/index.js';
import { runInRequestScope, getRequestScope } from '../core/request-scope.js';

export async function handleExplore(
	ctx: RequestContext,
	explorerService: ExplorerService
): Promise<unknown> {
	const body = ctx.body as { path?: string; toolRules?: unknown };
	const path = body.path || '/';
	const { toolRules } = body;

	const executeExplore = () => {
		const result = explorerService.explore(path);

		if (!result) {
			ctx.throw(404, `Path not found: ${path}`);
		}

		return result;
	};

	if (toolRules && !getRequestScope()?.toolRules) {
		return runInRequestScope({ toolRules: toolRules as any }, executeExplore);
	}

	return executeExplore();
}
