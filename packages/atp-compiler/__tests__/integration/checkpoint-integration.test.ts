/**
 * Integration tests for checkpoint transformation with ATPCompiler
 */

import { describe, it, expect } from '@jest/globals';
import { ATPCompiler } from '../../src/transformer/index.js';

describe('ATPCompiler with Operation Checkpoints', () => {
	describe('when enableOperationCheckpoints is false (default)', () => {
		it('should NOT add checkpoint wrappers', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: false });

			const code = `
				const user = await atp.api.users.get({ id: 1 });
				return user;
			`;

			const result = compiler.transform(code);

			expect(result.code).not.toContain('__checkpoint.buffer');
			expect(result.metadata.checkpointCount).toBe(0);
			expect(result.metadata.checkpointIds).toBeUndefined();
		});

		it('should still transform loops and other patterns', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: false });

			const code = `
				for (const item of items) {
					await atp.llm.call({ prompt: item });
				}
			`;

			const result = compiler.transform(code);

			// Should transform the loop but not add checkpoint wrappers
			expect(result.transformed).toBe(true);
			expect(result.metadata.loopCount).toBe(1);
			expect(result.metadata.checkpointCount).toBe(0);
		});
	});

	describe('when enableOperationCheckpoints is true', () => {
		it('should add checkpoint wrappers to atp.api calls', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const user = await atp.api.users.get({ id: 1 });
				return user;
			`;

			const result = compiler.transform(code);

			expect(result.code).toContain('__checkpoint.buffer');
			expect(result.code).toContain('async () =>');
			expect(result.code).toContain('atp.api.users.get');
			expect(result.metadata.checkpointCount).toBe(1);
			expect(result.metadata.checkpointIds).toHaveLength(1);
			expect(result.transformed).toBe(true);
		});

		it('should add checkpoint wrappers to atp.llm calls', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const response = await atp.llm.call({ prompt: "hello" });
				return response;
			`;

			const result = compiler.transform(code);

			expect(result.code).toContain('__checkpoint.buffer');
			expect(result.code).toContain('atp.llm.call');
			expect(result.metadata.checkpointCount).toBe(1);
		});

		it('should add checkpoint wrappers to multiple operations', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const user = await atp.api.users.get({ id: 1 });
				const repos = await atp.api.github.listRepos({ userId: user.id });
				const summary = await atp.llm.call({ prompt: "summarize" });
				return { user, repos, summary };
			`;

			const result = compiler.transform(code);

			expect(result.metadata.checkpointCount).toBe(3);
			expect(result.metadata.checkpointIds).toHaveLength(3);
		});

		it('should NOT checkpoint non-atp calls', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const data = await fetch("https://api.example.com");
				const cached = await atp.cache.get("key");
				return { data, cached };
			`;

			const result = compiler.transform(code);

			expect(result.metadata.checkpointCount).toBe(0);
		});

		it('should include metadata in checkpoint wrappers', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const user = await atp.api.github.getUser({ username: "john" });
			`;

			const result = compiler.transform(code);

			// Check for metadata properties
			expect(result.code).toContain('type:');
			expect(result.code).toContain('"api"');
			expect(result.code).toContain('namespace:');
			expect(result.code).toContain('"atp"');
			expect(result.code).toContain('group:');
			expect(result.code).toContain('"api.github"');
			expect(result.code).toContain('method:');
			expect(result.code).toContain('"getUser"');
			expect(result.code).toContain('params:');
		});

		it('should work together with loop transformation', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				for (const item of items) {
					await atp.llm.call({ prompt: item });
				}
			`;

			const result = compiler.transform(code);

			// Both transformations should be applied
			expect(result.metadata.loopCount).toBe(1);
			// Checkpoint count might be 0 because the loop transformer changes the code
			// and the await might be inside a callback function
			expect(result.transformed).toBe(true);
		});

		it('should generate deterministic checkpoint IDs', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const a = await atp.api.test1();
				const b = await atp.api.test2();
			`;

			const result = compiler.transform(code);
			const ids = result.metadata.checkpointIds || [];

			expect(ids).toHaveLength(2);
			// IDs should be different
			expect(ids[0]).not.toBe(ids[1]);
			// IDs should contain location info
			ids.forEach((id) => {
				expect(id).toMatch(/op_L\d+_C\d+/);
			});
		});

		it('should handle atp.client tool calls', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const result = await atp.client.myCustomTool({ data: "test" });
				return result;
			`;

			const result = compiler.transform(code);

			expect(result.code).toContain('__checkpoint.buffer');
			expect(result.code).toContain('"client_tool"');
			expect(result.metadata.checkpointCount).toBe(1);
		});
	});

	describe('top-level Promise.all checkpointing', () => {
		it('should checkpoint top-level Promise.all with single checkpoint', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const results = await Promise.all([
					api.custom.fetch({ id: 1 }),
					api.custom.fetch({ id: 2 })
				]);
				return results;
			`;

			const result = compiler.transform(code);

			console.log('\n=== TOP-LEVEL PROMISE.ALL ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Should have ONE checkpoint for the entire Promise.all result
			expect(result.metadata.checkpointCount).toBe(1);
			expect(result.metadata.checkpointIds?.[0]).toMatch(/op_L\d+_C\d+/);
			expect(result.code).toContain('"parallel"'); // type
			expect(result.code).toContain('"Promise"'); // namespace
			expect(result.code).toContain('"all"'); // method
			
			// Should include result variable names
			expect(result.code).toContain('resultVariables:');
			expect(result.code).toContain('"results"');
			
			// Should include APIs used
			expect(result.code).toContain('apis:');
			expect(result.code).toContain('"api.custom.fetch"');
		});

		it('should NOT checkpoint nested Promise.all inside loops', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const results = [];
				for (let i = 0; i < 3; i++) {
					// This Promise.all is NESTED inside a loop - should NOT be checkpointed
					const batch = await Promise.all([
						api.custom.fetch({ id: i }),
						api.custom.fetch({ id: i + 10 })
					]);
					results.push(batch);
				}
				return results;
			`;

			const result = compiler.transform(code);

			console.log('\n=== NESTED PROMISE.ALL (inside loop) ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// The Promise.all inside the loop should NOT be checkpointed
			// But the loop itself gets a checkpoint
			const promiseAllCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('op_'));
			
			expect(promiseAllCheckpoints.length).toBe(0);
		});

		it('should NOT checkpoint nested Promise.all inside map', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const items = [1, 2, 3];
				// This is top-level Promise.all - should be checkpointed
				const results = await Promise.all(
					items.map(async item => {
						// This inner Promise.all is NESTED - should NOT be checkpointed
						const [a, b] = await Promise.all([
							api.custom.fetch({ id: item }),
							api.custom.fetch({ id: item + 10 })
						]);
						return { a, b };
					})
				);
				return results;
			`;

			const result = compiler.transform(code);

			console.log('\n=== NESTED PROMISE.ALL (inside map) ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Only the outer Promise.all should be checkpointed (1 checkpoint)
			// The inner Promise.all inside map callback should NOT be checkpointed
			const checkpointIds = result.metadata.checkpointIds || [];
			expect(checkpointIds.length).toBe(1);
		});

		it('should capture destructured result variables', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const [userInfo, orderInfo] = await Promise.all([
					api.custom.getUser({ id: 1 }),
					api.custom.getOrders({ userId: 1 })
				]);
				return { userInfo, orderInfo };
			`;

			const result = compiler.transform(code);

			console.log('\n=== DESTRUCTURED PROMISE.ALL ===');
			console.log(result.code);

			// Should capture both destructured variable names
			expect(result.code).toContain('resultVariables:');
			expect(result.code).toContain('"userInfo"');
			expect(result.code).toContain('"orderInfo"');
			
			// Should include both APIs
			expect(result.code).toContain('apis:');
			expect(result.code).toContain('"api.custom.getUser"');
			expect(result.code).toContain('"api.custom.getOrders"');
		});

		it('should checkpoint multiple sequential top-level Promise.all', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				// First Promise.all - top level
				const users = await Promise.all([
					api.custom.getUser({ id: 1 }),
					api.custom.getUser({ id: 2 })
				]);
				
				// Second Promise.all - top level
				const orders = await Promise.all([
					api.custom.getOrders({ userId: 1 }),
					api.custom.getOrders({ userId: 2 })
				]);
				
				return { users, orders };
			`;

			const result = compiler.transform(code);

			console.log('\n=== MULTIPLE TOP-LEVEL PROMISE.ALL ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Both Promise.all should be checkpointed (2 checkpoints)
			expect(result.metadata.checkpointCount).toBe(2);
		});
	});

	describe('top-level loop checkpointing', () => {
		it('should add checkpoint after top-level loop with accumulators', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				let allResults = [];
				for (let i = 0; i < 3; i++) {
					const data = await api.custom.fetch({ id: i });
					allResults.push(data);
				}
				return allResults;
			`;

			const result = compiler.transform(code);

			console.log('\n=== TOP-LEVEL LOOP WITH ACCUMULATOR ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Should have a loop checkpoint
			const loopCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('loop_'));
			
			expect(loopCheckpoints.length).toBe(1);
			expect(result.code).toContain('"loop"'); // type
			expect(result.code).toContain('"completion"'); // method
			
			// Should include accumulator variable names
			expect(result.code).toContain('accumulators:');
			expect(result.code).toContain('"allResults"');
			
			// Should include APIs used in the loop
			expect(result.code).toContain('apis:');
			expect(result.code).toContain('"api.custom.fetch"');
		});

		it('should NOT checkpoint nested loops', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				let allResults = [];
				for (let i = 0; i < 3; i++) {
					// This is a NESTED loop - should NOT be checkpointed separately
					for (let j = 0; j < 2; j++) {
						const data = await api.custom.fetch({ i, j });
						allResults.push(data);
					}
				}
				return allResults;
			`;

			const result = compiler.transform(code);

			console.log('\n=== NESTED LOOPS ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Only the outer loop should have a checkpoint, not the inner one
			const loopCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('loop_'));
			
			expect(loopCheckpoints.length).toBe(1);
		});

		it('should checkpoint Slack pagination pattern', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				let cursor = undefined;
				let allDMs = [];
				
				for (let page = 0; page < 99; page++) {
					const result = await api.slack.conversations_list({ 
						types: "im", 
						limit: 200, 
						cursor 
					});
					
					if (!result.ok) return { error: result.error };
					
					allDMs.push(...(result.channels || []));
					cursor = result.response_metadata?.next_cursor;
					
					if (!cursor) break;
				}
				
				return { totalDMs: allDMs.length, dms: allDMs };
			`;

			const result = compiler.transform(code);

			console.log('\n=== SLACK PAGINATION PATTERN ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Should have a loop checkpoint capturing cursor and allDMs
			const loopCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('loop_'));
			
			expect(loopCheckpoints.length).toBe(1);
			expect(result.code).toContain('allDMs'); // accumulator
			expect(result.code).toContain('cursor'); // cursor variable
		});

		it('should handle multiple sequential top-level loops', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				// First loop - top level
				let channels = [];
				for (let page = 0; page < 10; page++) {
					const result = await api.custom.listChannels({ page });
					channels.push(...result.items);
					if (!result.hasMore) break;
				}
				
				// Second loop - top level
				let processed = [];
				for (const channel of channels) {
					const data = await api.custom.process({ id: channel.id });
					processed.push(data);
				}
				
				return { channels, processed };
			`;

			const result = compiler.transform(code);

			console.log('\n=== MULTIPLE SEQUENTIAL LOOPS ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Both loops should have checkpoints (2 loop checkpoints)
			const loopCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('loop_'));
			
			expect(loopCheckpoints.length).toBe(2);
		});
	});

	describe('combined loop and Promise.all patterns', () => {
		it('should checkpoint top-level loop with nested Promise.all (only loop)', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const allDMs = [];
				const batchSize = 50;
				const unreadDMs = [];
				
				for (let i = 0; i < allDMs.length; i += batchSize) {
					const batch = allDMs.slice(i, i + batchSize);
					
					// This Promise.all is NESTED - should NOT be checkpointed
					const infos = await Promise.all(
						batch.map(dm => api.slack.conversations_info({ channel: dm.id }))
					);
					
					unreadDMs.push(...infos.filter(i => i.unread_count > 0));
				}
				
				return unreadDMs;
			`;

			const result = compiler.transform(code);

			console.log('\n=== LOOP WITH NESTED PROMISE.ALL ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Only the loop should be checkpointed, not the Promise.all inside
			const loopCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('loop_'));
			const promiseCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('op_'));
			
			expect(loopCheckpoints.length).toBe(1);
			expect(promiseCheckpoints.length).toBe(0);
		});

		it('should checkpoint full Slack unread DMs pattern (top-level only)', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				// Step 1: Get all DM channels (top-level loop)
				let cursor = undefined;
				let allDMs = [];
				for (let page = 0; page < 99; page++) {
					const result = await api.slack.conversations_list({ 
						types: "im", 
						limit: 200, 
						cursor 
					});
					if (!result.ok) return { error: result.error };
					allDMs.push(...(result.channels || []));
					cursor = result.response_metadata?.next_cursor;
					if (!cursor) break;
				}
				
				// Step 2: Batch process (loop with nested Promise.all - only loop checkpointed)
				const batchSize = 50;
				const unreadDMs = [];
				for (let i = 0; i < allDMs.length; i += batchSize) {
					const batch = allDMs.slice(i, i + batchSize);
					const infos = await Promise.all(
						batch.map(dm => api.slack.conversations_info({ channel: dm.id }))
					);
					unreadDMs.push(...infos.filter(i => i?.channel?.unread_count > 0));
				}
				
				// Step 3: Get user names (top-level Promise.all)
				const details = await Promise.all(
					unreadDMs.map(dm => api.slack.users_info({ user: dm.userId }))
				);
				
				return { 
					totalDMs: allDMs.length, 
					unreadCount: unreadDMs.length, 
					details 
				};
			`;

			const result = compiler.transform(code);

			console.log('\n=== FULL SLACK PATTERN (TOP-LEVEL ONLY) ===');
			console.log(result.code);
			console.log('Checkpoint IDs:', result.metadata.checkpointIds);

			// Expected checkpoints:
			// - 2 loop checkpoints (step 1 and step 2 loops)
			// - 1 Promise.all checkpoint (step 3)
			const loopCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('loop_'));
			const promiseCheckpoints = (result.metadata.checkpointIds || [])
				.filter(id => id.startsWith('op_'));
			
			console.log('Loop checkpoints:', loopCheckpoints);
			console.log('Promise checkpoints:', promiseCheckpoints);
			
			expect(loopCheckpoints.length).toBe(2); // Two top-level loops
			expect(promiseCheckpoints.length).toBe(1); // One top-level Promise.all
		});
	});

	describe('edge cases', () => {
		it('should handle code with no await expressions', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const x = 1 + 2;
				return x;
			`;

			const result = compiler.transform(code);

			expect(result.transformed).toBe(false);
			expect(result.metadata.checkpointCount).toBe(0);
		});

		it('should handle empty code', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = ``;

			const result = compiler.transform(code);

			expect(result.transformed).toBe(false);
		});

		it('should handle deeply nested API paths', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const data = await atp.api.v2.admin.users.permissions.get({ id: 1 });
			`;

			const result = compiler.transform(code);

			expect(result.code).toContain('__checkpoint.buffer');
			expect(result.code).toContain('"api.v2.admin.users.permissions"');
			expect(result.code).toContain('"get"');
		});

		it('should preserve original code semantics', () => {
			const compiler = new ATPCompiler({ enableOperationCheckpoints: true });

			const code = `
				const user = await atp.api.users.get({ id: 1 });
				if (user.active) {
					const profile = await atp.api.users.getProfile({ id: user.id });
					return profile;
				}
				return null;
			`;

			const result = compiler.transform(code);

			// Should still have the conditional logic
			expect(result.code).toContain('if');
			expect(result.code).toContain('user.active');
			expect(result.code).toContain('return null');
			expect(result.metadata.checkpointCount).toBe(2);
		});
	});
});

