import { describe, test, expect } from '@jest/globals';
import {
	collectExploreOperations,
	collectExploreOperationsFromValue,
	filterExploreResult,
	filterExploreResultValue,
} from '../../src/explore-result-analyzer';
import type { DetectedApiCall } from '../../src/api-call-analyzer';
import type { ExploreDirectoryResult, ExploreFunctionResult } from '@mondaydotcomorg/atp-protocol';

const ALWAYS_ALLOW: DetectedApiCall[] = [
	{ apiGroup: 'captivateiq', operationId: 'listPlans' },
	{ apiGroup: 'captivateiq', operationId: 'deletePlan' },
	{ apiGroup: 'ziphq', operationId: 'getInvoice' },
	{ apiGroup: 'ziphq', operationId: 'deleteInvoice' },
];
const ALWAYS_DENY: DetectedApiCall[] = [];

describe('collectExploreOperations', () => {
	test('collects one candidate per type:function item in a directory result with a derivable apiGroup', () => {
		const listing: ExploreDirectoryResult = {
			type: 'directory',
			path: '/captivateiq',
			items: [
				{ name: 'listPlans', type: 'function', description: 'list plans' },
				{ name: 'reports', type: 'directory', description: 'nested group' },
				{ name: 'deletePlan', type: 'function', description: 'delete a plan' },
			],
		};

		const candidates = collectExploreOperations(listing);

		expect(candidates).toEqual([
			{ apiGroup: 'captivateiq', operationId: 'listPlans' },
			{ apiGroup: 'captivateiq', operationId: 'deletePlan' },
		]);
	});

	test('collects nothing for a directory result with no derivable apiGroup (root path)', () => {
		const rootListing: ExploreDirectoryResult = {
			type: 'directory',
			path: '/',
			items: [
				{ name: 'captivateiq', type: 'directory' },
				{ name: 'someLooseFunction', type: 'function' },
			],
		};

		expect(collectExploreOperations(rootListing)).toEqual([]);
	});

	test('collects nothing for a directory result at the empty-string path', () => {
		const listing: ExploreDirectoryResult = {
			type: 'directory',
			path: '',
			items: [{ name: 'loose', type: 'function' }],
		};

		expect(collectExploreOperations(listing)).toEqual([]);
	});

	test('collects exactly one candidate for a direct function result, using its own group/name', () => {
		const fn: ExploreFunctionResult = {
			type: 'function',
			path: '/captivateiq/listPlans',
			name: 'listPlans',
			description: 'list plans',
			definition: 'function listPlans(): Plan[]',
			group: 'captivateiq',
		};

		expect(collectExploreOperations(fn)).toEqual([
			{ apiGroup: 'captivateiq', operationId: 'listPlans' },
		]);
	});
});

describe('filterExploreResult — directory listings', () => {
	test('keeps an allowed function item and drops a disallowed one', () => {
		const listing: ExploreDirectoryResult = {
			type: 'directory',
			path: '/captivateiq',
			items: [
				{ name: 'listPlans', type: 'function', description: 'list plans' },
				{ name: 'deletePlan', type: 'function', description: 'delete a plan' },
			],
		};

		const filtered = filterExploreResult(listing, [
			{ apiGroup: 'captivateiq', operationId: 'listPlans' },
		]) as ExploreDirectoryResult;

		expect(filtered.items).toEqual([
			{ name: 'listPlans', type: 'function', description: 'list plans' },
		]);
	});

	test('always keeps directory entries regardless of the allow-list', () => {
		const listing: ExploreDirectoryResult = {
			type: 'directory',
			path: '/captivateiq',
			items: [{ name: 'reports', type: 'directory', description: 'nested group' }],
		};

		const filteredDenied = filterExploreResult(listing, ALWAYS_DENY) as ExploreDirectoryResult;
		const filteredAllowed = filterExploreResult(listing, ALWAYS_ALLOW) as ExploreDirectoryResult;

		expect(filteredDenied.items).toEqual(listing.items);
		expect(filteredAllowed.items).toEqual(listing.items);
	});

	test('does not mutate the input result', () => {
		const listing: ExploreDirectoryResult = {
			type: 'directory',
			path: '/captivateiq',
			items: [{ name: 'listPlans', type: 'function' }],
		};
		const original = JSON.parse(JSON.stringify(listing));

		filterExploreResult(listing, ALWAYS_DENY);

		expect(listing).toEqual(original);
	});

	test('drops a function item at the root path even when the allow-list always allows (no derivable apiGroup)', () => {
		const rootListing: ExploreDirectoryResult = {
			type: 'directory',
			path: '/',
			items: [
				{ name: 'captivateiq', type: 'directory' },
				{ name: 'someLooseFunction', type: 'function' },
			],
		};

		const filtered = filterExploreResult(rootListing, ALWAYS_ALLOW) as ExploreDirectoryResult;

		expect(filtered.items).toEqual([{ name: 'captivateiq', type: 'directory' }]);
	});

	test('drops a function item at an empty-string path the same way as root', () => {
		const listing: ExploreDirectoryResult = {
			type: 'directory',
			path: '',
			items: [{ name: 'loose', type: 'function' }],
		};

		const filtered = filterExploreResult(listing, ALWAYS_ALLOW) as ExploreDirectoryResult;

		expect(filtered.items).toEqual([]);
	});
});

describe('filterExploreResult — direct function results', () => {
	test('passes an allowed function result through unchanged', () => {
		const fn: ExploreFunctionResult = {
			type: 'function',
			path: '/captivateiq/listPlans',
			name: 'listPlans',
			description: 'list plans',
			definition: 'function listPlans(): Plan[]',
			group: 'captivateiq',
		};

		const filtered = filterExploreResult(fn, [
			{ apiGroup: 'captivateiq', operationId: 'listPlans' },
		]);

		expect(filtered).toEqual(fn);
	});

	test('returns null for a disallowed function result', () => {
		const fn: ExploreFunctionResult = {
			type: 'function',
			path: '/captivateiq/deletePlan',
			name: 'deletePlan',
			description: 'delete a plan',
			definition: 'function deletePlan(id: string): void',
			group: 'captivateiq',
		};

		const filtered = filterExploreResult(fn, ALWAYS_DENY);

		expect(filtered).toBeNull();
	});
});

describe('collectExploreOperationsFromValue / filterExploreResultValue', () => {
	test('collects candidates across an array-of-results payload', () => {
		const fn: ExploreFunctionResult = {
			type: 'function',
			path: '/captivateiq/listPlans',
			name: 'listPlans',
			description: 'list plans',
			definition: 'function listPlans(): Plan[]',
			group: 'captivateiq',
		};
		const dir: ExploreDirectoryResult = {
			type: 'directory',
			path: '/ziphq',
			items: [{ name: 'getInvoice', type: 'function' }],
		};

		expect(collectExploreOperationsFromValue([fn, dir])).toEqual([
			{ apiGroup: 'captivateiq', operationId: 'listPlans' },
			{ apiGroup: 'ziphq', operationId: 'getInvoice' },
		]);
	});

	test('maps over an array of ExploreResults with mixed allow/deny, nulling out a denied function', () => {
		const allowedFn: ExploreFunctionResult = {
			type: 'function',
			path: '/captivateiq/listPlans',
			name: 'listPlans',
			description: 'list plans',
			definition: 'function listPlans(): Plan[]',
			group: 'captivateiq',
		};
		const deniedFn: ExploreFunctionResult = {
			type: 'function',
			path: '/captivateiq/deletePlan',
			name: 'deletePlan',
			description: 'delete a plan',
			definition: 'function deletePlan(id: string): void',
			group: 'captivateiq',
		};
		const dir: ExploreDirectoryResult = {
			type: 'directory',
			path: '/ziphq',
			items: [
				{ name: 'getInvoice', type: 'function' },
				{ name: 'deleteInvoice', type: 'function' },
			],
		};
		const allowed: DetectedApiCall[] = [
			{ apiGroup: 'captivateiq', operationId: 'listPlans' },
			{ apiGroup: 'ziphq', operationId: 'getInvoice' },
		];

		const filtered = filterExploreResultValue([allowedFn, deniedFn, dir], allowed);

		expect(filtered).toEqual([
			allowedFn,
			null,
			{ type: 'directory', path: '/ziphq', items: [{ name: 'getInvoice', type: 'function' }] },
		]);
	});

	test('returns an unrecognizable value unchanged, and collects nothing from it', () => {
		const foreign = { foo: 'bar' };

		expect(collectExploreOperationsFromValue(foreign)).toEqual([]);
		expect(filterExploreResultValue(foreign, ALWAYS_DENY)).toEqual(foreign);
	});

	test('returns primitives and null unchanged', () => {
		expect(filterExploreResultValue(null, ALWAYS_DENY)).toBeNull();
		expect(filterExploreResultValue('not an explore result', ALWAYS_DENY)).toBe(
			'not an explore result'
		);
	});
});
