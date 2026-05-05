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
});
