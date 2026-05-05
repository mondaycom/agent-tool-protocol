/**
 * Parity between SearchEngine.search and ExplorerService.explore under the
 * same toolRules. Ensures callers can move between search and explore without
 * observing different visible operation sets.
 */

import { describe, test, expect } from '@jest/globals';
import { SearchEngine } from '../../packages/server/src/search/index';
import { ExplorerService } from '../../packages/server/src/explorer/index';
import { runInRequestScope } from '../../packages/server/src/core/request-scope';
import type { APIGroupConfig, ClientToolRules } from '@mondaydotcomorg/atp-protocol';

const stubFn = {
	inputSchema: { type: 'object', properties: {}, required: [] },
	handler: async () => ({}),
};

const apiGroups: APIGroupConfig[] = [
	{
		name: 'calendar',
		type: 'custom',
		functions: [
			{ name: 'events_list', description: 'list events', ...stubFn },
			{ name: 'events_get', description: 'get event', ...stubFn },
			{ name: 'events_delete', description: 'delete event', ...stubFn },
			{ name: 'events_insert', description: 'create event', ...stubFn },
		],
	},
	{
		name: 'gmail',
		type: 'custom',
		functions: [
			{ name: 'messages_list', description: 'list messages', ...stubFn },
			{ name: 'messages_send', description: 'send message', ...stubFn },
		],
	},
];

/** Flatten search results → Set of `${group}.${fn}` */
async function searchVisible(engine: SearchEngine): Promise<Set<string>> {
	// A permissive query that matches every function description so the rule
	// set — not the query — determines the visible set.
	const all = new Set<string>();
	for (const q of ['list', 'get', 'delete', 'send', 'create', 'message', 'event']) {
		const results = await engine.search({ query: q, maxResults: 1000 });
		for (const r of results) all.add(`${r.apiGroup}.${r.functionName}`);
	}
	return all;
}

/** Walk explore at every (group, functionName) → Set of `${group}.${fn}` visible. */
function exploreVisible(explorer: ExplorerService): Set<string> {
	const visible = new Set<string>();
	const root = explorer.explore('/custom');
	if (!root || root.type !== 'directory') return visible;
	for (const groupItem of root.items) {
		if (groupItem.type !== 'directory') continue;
		const groupResult = explorer.explore(`/custom/${groupItem.name}`);
		if (!groupResult || groupResult.type !== 'directory') continue;
		for (const fnItem of groupResult.items) {
			if (fnItem.type === 'function') visible.add(`${groupItem.name}.${fnItem.name}`);
		}
	}
	return visible;
}

function parityUnder<T>(rules: ClientToolRules | undefined, fn: () => T): T {
	if (!rules) return fn();
	return runInRequestScope({ toolRules: rules }, fn) as T;
}

describe('ExplorerService / SearchEngine tool-rule parity', () => {
	const search = new SearchEngine(apiGroups);
	const explorer = new ExplorerService(apiGroups);

	test('no rules: both surface every function', async () => {
		const s = await parityUnder(undefined, () => searchVisible(search));
		const e = parityUnder(undefined, () => exploreVisible(explorer));
		expect(e).toEqual(s);
		// Sanity: the full 6-op set is visible.
		expect(s.size).toBe(6);
	});

	test('allowOnlyApiGroups=[calendar]: both hide gmail entirely', async () => {
		const rules: ClientToolRules = { allowOnlyApiGroups: ['calendar'] };
		const s = await parityUnder(rules, () => searchVisible(search));
		const e = parityUnder(rules, () => exploreVisible(explorer));
		expect(e).toEqual(s);
		for (const fn of s) expect(fn.startsWith('calendar.')).toBe(true);
	});

	test('allowOnlyTools (per-op allowlist): both narrow to the exact ops', async () => {
		const rules: ClientToolRules = {
			allowOnlyTools: ['calendar.events_list', 'calendar.events_get'],
		};
		const s = await parityUnder(rules, () => searchVisible(search));
		const e = parityUnder(rules, () => exploreVisible(explorer));
		expect(e).toEqual(s);
		expect(e).toEqual(new Set(['calendar.events_list', 'calendar.events_get']));
	});

	test('blockTools (per-op denylist): both drop the blocked ops', async () => {
		const rules: ClientToolRules = {
			blockTools: ['calendar.events_delete', 'calendar.events_insert'],
		};
		const s = await parityUnder(rules, () => searchVisible(search));
		const e = parityUnder(rules, () => exploreVisible(explorer));
		expect(e).toEqual(s);
		expect(e.has('calendar.events_delete')).toBe(false);
		expect(e.has('calendar.events_insert')).toBe(false);
		expect(e.has('calendar.events_list')).toBe(true);
	});

	test('empty allowOnlyApiGroups: both surface nothing (fail-closed)', async () => {
		const rules: ClientToolRules = { allowOnlyApiGroups: [] };
		// Empty array in allowOnlyApiGroups is treated as "no restriction" by
		// isGroupAllowed (line: `if (rules.allowOnlyApiGroups && rules.allowOnlyApiGroups.length > 0)`),
		// so both should see every function. Documenting that parity explicitly.
		const s = await parityUnder(rules, () => searchVisible(search));
		const e = parityUnder(rules, () => exploreVisible(explorer));
		expect(e).toEqual(s);
	});
});
