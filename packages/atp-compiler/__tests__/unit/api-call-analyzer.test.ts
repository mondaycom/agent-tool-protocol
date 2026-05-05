import { describe, test, expect } from '@jest/globals';
import { analyzeApiCalls } from '../../src/api-call-analyzer';

describe('analyzeApiCalls', () => {
	test('extracts a single api.<group>.<op>(...) call', () => {
		const r = analyzeApiCalls(`return api.calendar.events_list({ calendarId: 'primary' });`);
		expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
		expect(r.dynamicCallsDetected).toBe(false);
	});

	test('extracts nested await + multiple calls in the same group', () => {
		const code = `
      const c = await api.calendar.calendars_get({ calendarId: 'primary' });
      return await api.calendar.events_list({ calendarId: c.id, maxResults: 10 });
    `;
		const r = analyzeApiCalls(code);
		const sorted = r.apiCalls.slice().sort((a, b) => a.operationId.localeCompare(b.operationId));
		expect(sorted).toEqual([
			{ apiGroup: 'calendar', operationId: 'calendars_get' },
			{ apiGroup: 'calendar', operationId: 'events_list' },
		]);
		expect(r.dynamicCallsDetected).toBe(false);
	});

	test('extracts cross-group calls', () => {
		const r = analyzeApiCalls(`
      await api.calendar.events_list({});
      await api.gmail.messages_list({});
    `);
		expect(r.apiCalls).toEqual(
			expect.arrayContaining([
				{ apiGroup: 'calendar', operationId: 'events_list' },
				{ apiGroup: 'gmail', operationId: 'messages_list' },
			])
		);
	});

	test('deduplicates repeated calls to the same api.<group>.<op>', () => {
		const r = analyzeApiCalls(`
      await api.calendar.events_list({ maxResults: 1 });
      await api.calendar.events_list({ maxResults: 2 });
    `);
		expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
	});

	test('flags dynamic dispatch via computed operation member', () => {
		const r = analyzeApiCalls(`return api.calendar[fn]({});`);
		expect(r.dynamicCallsDetected).toBe(true);
	});

	test('flags dynamic dispatch via computed group member', () => {
		const r = analyzeApiCalls(`return api[g].events_list({});`);
		expect(r.dynamicCallsDetected).toBe(true);
	});

	test('flags destructured api: const { calendar } = api', () => {
		const r = analyzeApiCalls(`
      const { calendar } = api;
      return calendar.events_list({});
    `);
		expect(r.dynamicCallsDetected).toBe(true);
	});

	test('flags destructure-with-rename: const { calendar: c } = api', () => {
		const r = analyzeApiCalls(`
      const { calendar: c } = api;
      return c.events_list({});
    `);
		expect(r.dynamicCallsDetected).toBe(true);
	});

	test('flags aliasing: const x = api.calendar', () => {
		const r = analyzeApiCalls(`
      const x = api.calendar;
      return x.events_list({});
    `);
		expect(r.dynamicCallsDetected).toBe(true);
	});

	test('flags aliasing: const x = api', () => {
		const r = analyzeApiCalls(`
      const x = api;
      return x.calendar.events_list({});
    `);
		expect(r.dynamicCallsDetected).toBe(true);
	});

	test('returns empty calls + no dynamic flag for trivial code', () => {
		const r = analyzeApiCalls(`return 42;`);
		expect(r.apiCalls).toEqual([]);
		expect(r.dynamicCallsDetected).toBe(false);
	});

	test('fails closed with dynamicCallsDetected=true on syntax error', () => {
		const r = analyzeApiCalls(`return api.calendar.events_list(`);
		expect(r.dynamicCallsDetected).toBe(true);
		expect(r.apiCalls).toEqual([]);
	});

	test('handles empty string input', () => {
		const r = analyzeApiCalls('');
		expect(r.apiCalls).toEqual([]);
		expect(r.dynamicCallsDetected).toBe(false);
	});

	// ────────────────────────────────────────────────────────────────────────
	// Dedup — same (group, op) through different syntactic paths
	// ────────────────────────────────────────────────────────────────────────

	describe('dedup', () => {
		test('same op called in both branches of a ternary', () => {
			const r = analyzeApiCalls(`
        return flag
          ? api.calendar.events_list({ a: 1 })
          : api.calendar.events_list({ a: 2 });
      `);
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
			expect(r.dynamicCallsDetected).toBe(false);
		});

		test('same op called inside a loop is reported once', () => {
			const r = analyzeApiCalls(`
        for (const id of ids) {
          await api.calendar.events_list({ calendarId: id });
        }
      `);
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
		});

		test('same op across try/catch/finally reports once', () => {
			const r = analyzeApiCalls(`
        try {
          await api.calendar.events_list({});
        } catch (e) {
          await api.calendar.events_list({ retry: true });
        } finally {
          api.calendar.events_list({ cleanup: true });
        }
      `);
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
		});

		test('same op across multiple statements is reported once', () => {
			const r = analyzeApiCalls(`
        const a = await api.calendar.events_list({ maxResults: 1 });
        const b = await api.calendar.events_list({ maxResults: 2 });
        const c = await api.calendar.events_list({ maxResults: 3 });
      `);
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Complex control-flow / realistic code shapes
	// ────────────────────────────────────────────────────────────────────────

	describe('complex control flow', () => {
		test('IIFE (immediately-invoked async function)', () => {
			const r = analyzeApiCalls(`
        return (async () => await api.calendar.events_list({}))();
      `);
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
			expect(r.dynamicCallsDetected).toBe(false);
		});

		test('Promise.all with multiple awaits', () => {
			const r = analyzeApiCalls(`
        return await Promise.all([
          api.calendar.events_list({}),
          api.gmail.messages_list({}),
          api.drive.files_list({}),
        ]);
      `);
			const sorted = r.apiCalls
				.slice()
				.sort((a, b) => (a.apiGroup + '.' + a.operationId).localeCompare(b.apiGroup + '.' + b.operationId));
			expect(sorted).toEqual([
				{ apiGroup: 'calendar', operationId: 'events_list' },
				{ apiGroup: 'drive', operationId: 'files_list' },
				{ apiGroup: 'gmail', operationId: 'messages_list' },
			]);
		});

		test('arrow inside .then() chain', () => {
			const r = analyzeApiCalls(`
        return api.calendar.events_list({})
          .then((list) => api.calendar.events_get({ eventId: list.items[0].id }))
          .then((ev) => api.calendar.calendars_get({ calendarId: ev.calendarId }));
      `);
			expect(r.apiCalls.sort((a, b) => a.operationId.localeCompare(b.operationId))).toEqual([
				{ apiGroup: 'calendar', operationId: 'calendars_get' },
				{ apiGroup: 'calendar', operationId: 'events_get' },
				{ apiGroup: 'calendar', operationId: 'events_list' },
			]);
		});

		test('class method body', () => {
			const r = analyzeApiCalls(`
        class Scheduler {
          async listEvents() {
            return await api.calendar.events_list({ calendarId: 'primary' });
          }
        }
        return new Scheduler().listEvents();
      `);
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
		});

		test('nested try/catch/finally across multiple groups', () => {
			const r = analyzeApiCalls(`
        try {
          await api.calendar.events_list({});
        } catch (e) {
          await api.gmail.messages_list({ label: 'errors' });
        } finally {
          api.drive.files_list({});
        }
      `);
			expect(r.apiCalls.length).toBe(3);
		});

		test('switch statement with api calls per case', () => {
			const r = analyzeApiCalls(`
        switch (kind) {
          case 'a': return api.calendar.events_list({});
          case 'b': return api.calendar.events_get({ eventId: x });
          default: return api.calendar.calendars_get({ calendarId: 'primary' });
        }
      `);
			expect(r.apiCalls.length).toBe(3);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Multi-group realism — many sources + many ops
	// ────────────────────────────────────────────────────────────────────────

	describe('multi-group', () => {
		test('realistic Google Suite workload (6 groups, 11 ops)', () => {
			const r = analyzeApiCalls(`
        const events = await api.calendar.events_list({ calendarId: 'primary' });
        const cal = await api.calendar.calendars_get({ calendarId: 'primary' });
        const messages = await api.gmail.messages_list({});
        const thread = await api.gmail.threads_get({ id: '1' });
        const sheet = await api.sheets.spreadsheets_get({ spreadsheetId: 'x' });
        const values = await api.sheets.spreadsheets_values_get({ spreadsheetId: 'x', range: 'A1' });
        const drive = await api.drive.files_list({});
        const file = await api.drive.files_get({ fileId: 'x' });
        const deck = await api.slides.presentations_get({ presentationId: 'x' });
        const doc = await api.docs.documents_get({ documentId: 'x' });
        const batch = await api.sheets.spreadsheets_batchUpdate({ spreadsheetId: 'x' });
        return { events, cal, messages, thread, sheet, values, drive, file, deck, doc, batch };
      `);

			const groupsTouched = new Set(r.apiCalls.map((c) => c.apiGroup));
			expect(groupsTouched).toEqual(new Set(['calendar', 'gmail', 'sheets', 'drive', 'slides', 'docs']));
			expect(r.apiCalls).toHaveLength(11);
			expect(r.dynamicCallsDetected).toBe(false);
		});

		test('mixed groups with some dedup', () => {
			const r = analyzeApiCalls(`
        await api.calendar.events_list({});
        await api.gmail.messages_list({});
        await api.calendar.events_list({});   // dup
        await api.gmail.messages_list({});    // dup
        await api.calendar.events_get({ eventId: 'x' });
      `);
			expect(r.apiCalls).toHaveLength(3);
			expect(r.apiCalls.map((c) => c.apiGroup + '.' + c.operationId).sort()).toEqual([
				'calendar.events_get',
				'calendar.events_list',
				'gmail.messages_list',
			]);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Additional dynamic-dispatch escape patterns
	// ────────────────────────────────────────────────────────────────────────

	describe('dynamic dispatch — additional escapes', () => {
		test('flags optional-chained operation member', () => {
			const r = analyzeApiCalls(`return api.calendar?.events_list?.({});`);
			// Detected statically OR dynamic — either outcome denies a grant
			// that doesn't cover the target. This implementation DETECTS
			// because the static path is resolvable; no dynamic flag needed.
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
		});

		test('flags .call() redirection as a regular static call', () => {
			const r = analyzeApiCalls(`api.calendar.events_list.call(null, {});`);
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
		});

		test('flags .apply() redirection', () => {
			const r = analyzeApiCalls(`api.calendar.events_list.apply(null, [{}]);`);
			expect(r.apiCalls).toEqual([{ apiGroup: 'calendar', operationId: 'events_list' }]);
		});

		test('flags .bind() + later call', () => {
			const r = analyzeApiCalls(`
        const boundList = api.calendar.events_list.bind(null);
        return boundList({});
      `);
			// .bind still surfaces the underlying call target.
			expect(r.apiCalls).toContainEqual({ apiGroup: 'calendar', operationId: 'events_list' });
		});

		test('flags Object.values(api) as dynamic', () => {
			const r = analyzeApiCalls(`
        const groups = Object.values(api);
        return groups.map((g) => Object.keys(g));
      `);
			expect(r.dynamicCallsDetected).toBe(true);
		});

		test('flags Object.keys(api) as dynamic', () => {
			const r = analyzeApiCalls(`return Object.keys(api);`);
			expect(r.dynamicCallsDetected).toBe(true);
		});

		test('flags spread {...api} as dynamic', () => {
			const r = analyzeApiCalls(`const x = { ...api }; return x;`);
			expect(r.dynamicCallsDetected).toBe(true);
		});

		test('flags passing api as function argument', () => {
			const r = analyzeApiCalls(`
        const use = (a) => a.calendar.events_list({});
        return use(api);
      `);
			expect(r.dynamicCallsDetected).toBe(true);
		});

		test('flags returning bare api', () => {
			const r = analyzeApiCalls(`return api;`);
			expect(r.dynamicCallsDetected).toBe(true);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Not-false-positive — identifiers named "api" that aren't the global
	// ────────────────────────────────────────────────────────────────────────

	describe('does not false-positive on unrelated "api" identifiers', () => {
		test('this.api.foo.bar(...) is ignored (not the global api)', () => {
			const r = analyzeApiCalls(`return this.api.foo.bar({});`);
			expect(r.apiCalls).toEqual([]);
			expect(r.dynamicCallsDetected).toBe(false);
		});

		test('someObj.api.foo.bar(...) is ignored', () => {
			const r = analyzeApiCalls(`
        const wrapper = { api: null };
        return wrapper.api?.foo?.bar?.({});
      `);
			expect(r.apiCalls).toEqual([]);
			expect(r.dynamicCallsDetected).toBe(false);
		});

		test('deep api.x.y.z(...) — not valid ATP syntax — silently ignored', () => {
			// Sandbox's runtime namespace would throw on this; static analyzer
			// ignores it so we don't over-flag invalid code as dynamic.
			const r = analyzeApiCalls(`return api.x.y.z({});`);
			expect(r.apiCalls).toEqual([]);
			expect(r.dynamicCallsDetected).toBe(false);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Idempotency — deterministic output across calls
	// ────────────────────────────────────────────────────────────────────────

	describe('idempotency', () => {
		test('calling analyzeApiCalls twice on same code yields identical output', () => {
			const code = `
        await api.calendar.events_list({});
        await api.gmail.messages_list({});
        const { calendar } = api;
      `;
			const a = analyzeApiCalls(code);
			const b = analyzeApiCalls(code);
			expect(a).toEqual(b);
		});
	});
});
