/**
 * Tests for resumableForLoop in-isolate implementation
 * 
 * Reproduces the "init is not a function" bug where the in-isolate runtime
 * expected `init` to be a function (calling `init()`) but the loop-transformer
 * was passing a number (initValue) as the first argument.
 * 
 * Bug: The in-isolate runtime had:
 *   async (init, condition, update, body, loopId) => {
 *       for (init(); condition(); update()) { await body(); }
 *   }
 * 
 * But the loop-transformer passes:
 *   resumableForLoop(0, condition, increment, body, loopId)
 *   where 0 is a NUMBER, not a function!
 * 
 * Fix: Changed in-isolate runtime to:
 *   async (initValue, condition, increment, body, loopId) => {
 *       let i = initValue;
 *       while (condition(i)) { await body(i); i = increment(i); }
 *   }
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';
import { ExecutionStatus } from '@mondaydotcomorg/atp-protocol';

describe('resumableForLoop - "init is not a function" bug fix', () => {
	let server: ReturnType<typeof createServer>;
	let client: AgentToolProtocolClient;

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-for-resumable-for-loop-test';
	});

	beforeEach(() => {
		server = createServer({
			logger: 'warn',
			providers: {
				cache: new MemoryCache(),
			},
		});

		// Add mock Slack tools
		server.tool('conversations_list', {
			group: 'slack',
			description: 'List Slack conversations',
			input: { types: 'string', limit: 'number', cursor: 'string' },
			handler: async () => ({
				ok: true,
				channels: [
					{ id: 'C123', name: 'test-channel', is_private: false },
				],
				response_metadata: { next_cursor: null }
			})
		});

		server.tool('conversations_members', {
			group: 'slack',
			description: 'Get channel members',
			input: { channel: 'string', limit: 'number', cursor: 'string' },
			handler: async () => ({
				ok: true,
				members: ['U001', 'U002', 'U003'],
				response_metadata: { next_cursor: null }
			})
		});

		server.tool('users_info', {
			group: 'slack',
			description: 'Get user info',
			input: { user: 'string' },
			handler: async (params: any) => ({
				ok: true,
				user: {
					id: params.user,
					name: `user_${params.user}`,
					real_name: `User ${params.user}`,
					profile: { display_name: `Display ${params.user}` }
				}
			})
		});

		client = new AgentToolProtocolClient({ server });
	});

	afterEach(() => {
		server = null as unknown as ReturnType<typeof createServer>;
		client = null as unknown as AgentToolProtocolClient;
	});

	afterAll(() => {
		delete process.env.ATP_JWT_SECRET;
	});

	test('simple for loop with await should work', async () => {
		await client.init({ name: 'test', version: '1.0.0' });

		// This code has a for loop with await, which gets transformed to resumableForLoop
		const result = await client.execute(`
			let sum = 0;
			for (let i = 0; i < 3; i++) {
				const info = await api.slack.users_info({ user: 'U00' + i });
				sum++;
			}
			return sum;
		`);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect(result.result).toBe(3);
	});

	test('nested for loop with await should work', async () => {
		await client.init({ name: 'test', version: '1.0.0' });

		const result = await client.execute(`
			let calls = 0;
			for (let i = 0; i < 2; i++) {
				for (let j = 0; j < 2; j++) {
					const info = await api.slack.users_info({ user: 'U' + i + j });
					calls++;
				}
			}
			return calls;
		`);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect(result.result).toBe(4);
	});

	test('for loop with function declaration inside should work', async () => {
		await client.init({ name: 'test', version: '1.0.0' });

		// This is the pattern that caused "init is not a function" error
		const result = await client.execute(`
			function chunk(arr, size) {
				const chunks = [];
				for (let i = 0; i < arr.length; i += size) {
					chunks.push(arr.slice(i, i + size));
				}
				return chunks;
			}
			
			const arr = [1, 2, 3, 4, 5, 6];
			const chunked = chunk(arr, 2);
			return chunked;
		`);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect(result.result).toEqual([[1, 2], [3, 4], [5, 6]]);
	});

	test('complex Slack channel members code should work', async () => {
		await client.init({ name: 'test', version: '1.0.0' });

		// This is the exact code that was failing with "init is not a function"
		const result = await client.execute(`
			// Step 1: Find the channel ID by name (with pagination)
			const targetName = 'test-channel';
			let channel = null;
			let cursor = undefined;
			for (let page = 0; page < 20 && !channel; page++) {
				const result = await api.slack.conversations_list({ types: 'public_channel,private_channel', limit: 1000, cursor });
				if (!result.ok) return \`Error: \${result.error}\`;
				channel = result.channels?.find(c => c.name === targetName || c.name?.toLowerCase() === targetName);
				cursor = result.response_metadata?.next_cursor;
				if (!cursor) page = 999;
			}
			if (!channel) return \`Channel "\${targetName}" not found.\`;
			
			// Step 2: Get the member IDs of this channel (paginated)
			let members = [];
			cursor = undefined;
			let done = false;
			for (let i = 0; i < 50 && !done; i++) {
				const result = await api.slack.conversations_members({ channel: channel.id, limit: 1000, cursor });
				if (!result.ok) return \`Error fetching members: \${result.error}\`;
				members.push(...(result.members || []));
				cursor = result.response_metadata?.next_cursor;
				if (!cursor) done = true;
			}
			if (!members.length) return \`No members found.\`;
			
			// Step 3: Look up user details in parallel batches of 50
			const chunk = (arr, size) => {
				const chunks = [];
				for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
				return chunks;
			};
			const memberChunks = chunk(members, 50);
			let userDetails = [];
			for (const chunkItem of memberChunks) {
				const details = await Promise.all(chunkItem.map(id => api.slack.users_info({ user: id }).catch(() => null)));
				userDetails.push(...details.filter(Boolean));
			}
			const readable = userDetails.map(u => ({
				id: u.user.id,
				name: u.user.real_name || u.user.name,
				displayName: u.user.profile?.display_name
			}));
			return {
				channel: { id: channel.id, name: channel.name },
				memberCount: readable.length,
				members: readable
			};
		`);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const resultObj = result.result as any;
		expect(resultObj.channel).toEqual({ id: 'C123', name: 'test-channel' });
		expect(resultObj.memberCount).toBe(3);
		expect(Array.isArray(resultObj.members)).toBe(true);
		expect(resultObj.members.length).toBe(3);
	});

	test('for loop starting from non-zero should work', async () => {
		await client.init({ name: 'test', version: '1.0.0' });

		const result = await client.execute(`
			let results = [];
			for (let i = 5; i < 8; i++) {
				const info = await api.slack.users_info({ user: 'U' + i });
				results.push(info.user.id);
			}
			return results;
		`);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect(result.result).toEqual(['U5', 'U6', 'U7']);
	});

	test('for loop with decrement should work', async () => {
		await client.init({ name: 'test', version: '1.0.0' });

		const result = await client.execute(`
			let results = [];
			for (let i = 3; i > 0; i--) {
				const info = await api.slack.users_info({ user: 'U' + i });
				results.push(info.user.id);
			}
			return results;
		`);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect(result.result).toEqual(['U3', 'U2', 'U1']);
	});
});

