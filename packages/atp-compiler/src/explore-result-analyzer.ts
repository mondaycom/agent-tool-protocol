/**
 * Post-fetch static analysis of an already-parsed `explore_api` result.
 *
 * Extracts every `{apiGroup, operationId}` leaf reachable in a directory
 * listing or a direct function result, and narrows such a result down to
 * only the operations a caller-supplied allow-list grants.
 *
 * Intended caller: a client or gateway that receives `explore_api`'s
 * response over the wire (e.g. proxying a remote ATP server it does not
 * itself run) and needs to re-check the result against its own grant model
 * before handing it to an agent — the discovery-side counterpart to
 * `analyzeApiCalls`, which does the same job for `execute_code`'s request
 * payload instead of `explore_api`'s response payload. Paired with runtime
 * `filterApiGroups` enforcement in atp-server for defense-in-depth, exactly
 * like `analyzeApiCalls` is.
 *
 * @example
 *   const candidates = collectExploreOperations(exploreResult);
 *   const allowed = candidates.filter((op) => isGranted(op.apiGroup, op.operationId));
 *   const narrowed = filterExploreResult(exploreResult, allowed);
 */

import type {
	ExploreResult,
	ExploreDirectoryResult,
	ExploreFunctionResult,
} from '@mondaydotcomorg/atp-protocol';
import type { DetectedApiCall } from './api-call-analyzer.js';

function operationKey(op: DetectedApiCall): string {
	return `${op.apiGroup} ${op.operationId}`;
}

function toAllowedSet(allowedOperations: readonly DetectedApiCall[]): ReadonlySet<string> {
	return new Set(allowedOperations.map(operationKey));
}

/**
 * First non-empty `/`-separated segment of an ATP explore path, or `undefined`
 * if there isn't one (root path `/` or `''`). This is the apiGroup for any
 * directory listing at that path, per ATP's hierarchical `/apiGroup/...`
 * convention.
 */
function firstPathSegment(path: string): string | undefined {
	return path.split('/').find((part) => part.length > 0);
}

/**
 * Every leaf `{apiGroup, operationId}` operation reachable in an
 * already-parsed `explore_api` result — the finite candidate set a caller
 * needs a real grant decision for, as opposed to the unbounded "every
 * operation that could ever exist" question an app-wide query would face.
 * Directories contribute nothing on their own — only their `type:'function'`
 * items, and a direct function result, are leaves. A leaf with no derivable
 * apiGroup (see `firstPathSegment`) is skipped rather than guessed at.
 */
export function collectExploreOperations(result: ExploreResult): DetectedApiCall[] {
	if (result.type === 'directory') {
		const apiGroup = firstPathSegment(result.path);
		if (apiGroup === undefined) {
			return [];
		}
		return result.items
			.filter((item) => item.type === 'function')
			.map((item) => ({ apiGroup, operationId: item.name }));
	}
	return [{ apiGroup: result.group, operationId: result.name }];
}

/**
 * Narrows an already-parsed `explore_api` result to only the operations
 * present in `allowedOperations`. The call to `explore_api` itself is never
 * denied by this function — only what it reveals is. A directory listing is
 * always returned (possibly with fewer `items`); a direct function result
 * that isn't granted comes back as `null` rather than a synthesized stand-in
 * — mirroring `ExplorerService.explore()`'s own convention in atp-server —
 * so callers decide for themselves how "not visible" should look on the wire.
 */
export function filterExploreResult(
	result: ExploreResult,
	allowedOperations: readonly DetectedApiCall[]
): ExploreResult | null {
	const allowedOps = toAllowedSet(allowedOperations);
	if (result.type === 'directory') {
		return filterDirectoryResult(result, allowedOps);
	}
	return filterFunctionResult(result, allowedOps);
}

/**
 * Directory entries of `type:'directory'` are always kept, never filtered
 * here: a subdirectory's own contents are only resolved lazily when the
 * caller descends into it with a follow-up `explore_api` call on that path,
 * at which point *that* call's result goes through this same filter.
 *
 * `type:'function'` items are leaves, checkable right now. Their apiGroup
 * isn't carried on the item itself — it's derived from the listing's own
 * `path`. A listing at the root (`/` or `''`) has no apiGroup segment at
 * all, so any function item found directly there is dropped unconditionally
 * (it was never a candidate in `collectExploreOperations` either).
 */
function filterDirectoryResult(
	result: ExploreDirectoryResult,
	allowedOps: ReadonlySet<string>
): ExploreDirectoryResult {
	const apiGroup = firstPathSegment(result.path);
	const items = result.items.filter((item) => {
		if (item.type === 'directory') {
			return true;
		}
		return (
			apiGroup !== undefined && allowedOps.has(operationKey({ apiGroup, operationId: item.name }))
		);
	});
	return { ...result, items };
}

/**
 * A direct hit on a function's own path carries its apiGroup explicitly
 * (`group`), so no path-derivation guesswork is needed here.
 */
function filterFunctionResult(
	result: ExploreFunctionResult,
	allowedOps: ReadonlySet<string>
): ExploreResult | null {
	if (!allowedOps.has(operationKey({ apiGroup: result.group, operationId: result.name }))) {
		return null;
	}
	return { ...result };
}

function isExploreDirectoryResult(value: unknown): value is ExploreDirectoryResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { type?: unknown }).type === 'directory' &&
		Array.isArray((value as { items?: unknown }).items)
	);
}

function isExploreFunctionResult(value: unknown): value is ExploreFunctionResult {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as { type?: unknown; group?: unknown; name?: unknown };
	return (
		candidate.type === 'function' &&
		typeof candidate.group === 'string' &&
		typeof candidate.name === 'string'
	);
}

/**
 * Collects candidates across an already-JSON-parsed `explore_api` payload,
 * which may be a single result or an array of them (the tool's `paths`
 * input accepts a string or an array of strings, so its response shape
 * mirrors that 1:1). Anything that isn't recognizable as an `ExploreResult`
 * contributes nothing.
 */
export function collectExploreOperationsFromValue(value: unknown): DetectedApiCall[] {
	if (Array.isArray(value)) {
		return value.flatMap(collectExploreOperationsFromValue);
	}
	if (isExploreDirectoryResult(value) || isExploreFunctionResult(value)) {
		return collectExploreOperations(value);
	}
	return [];
}

/**
 * Applies `filterExploreResult` to an already-JSON-parsed `explore_api`
 * payload, which may be a single result or an array of them. Anything that
 * isn't recognizable as an `ExploreResult` (wrong shape, foreign JSON, etc.)
 * is returned unchanged — this function only knows how to filter what it can
 * positively identify.
 */
export function filterExploreResultValue(
	value: unknown,
	allowedOperations: readonly DetectedApiCall[]
): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => filterExploreResultValue(entry, allowedOperations));
	}
	if (isExploreDirectoryResult(value) || isExploreFunctionResult(value)) {
		return filterExploreResult(value, allowedOperations);
	}
	return value;
}
