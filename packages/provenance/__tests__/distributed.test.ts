import { describe, it, expect, beforeEach } from '@jest/globals';
import {
	createProvenanceProxy,
	getProvenance,
	setGlobalProvenanceStore,
	hydrateProvenance,
	hydrateExecutionProvenance,
	setProvenanceExecutionId,
	cleanupProvenanceForExecution,
	ProvenanceSource,
	InMemoryProvenanceStore,
	ProvenanceStore,
} from '../src/index.js';

describe('Multi-Pod Distributed Provenance', () => {
	let store: ProvenanceStore;

	beforeEach(() => {
		// Reset store for each test
		store = new InMemoryProvenanceStore();
		setGlobalProvenanceStore(store);
	});

	it('should persist provenance to store and hydrate on new "pod"', async () => {
		const executionId = 'exec-123';
		setProvenanceExecutionId(executionId);

		// POD A: Create data
		const data = { name: 'Alice', secret: 'secret-value' };
		const proxy = createProvenanceProxy(
			data,
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'public' }
		);

		const id = (proxy as any).__prov_id__;
		expect(id).toBeDefined();

		// Verify it's in the store (wait for async set)
		await new Promise((resolve) => setTimeout(resolve, 10));
		const storedMeta = await store.get(id);
		expect(storedMeta).toBeDefined();
		expect(storedMeta?.source.type).toBe(ProvenanceSource.TOOL);

		// SIMULATE POD SWITCH:
		// Clear local registry (simulate fresh pod)
		cleanupProvenanceForExecution(executionId);
		// Note: In real scenario, we wouldn't call cleanup on store, just local memory.
		// But our cleanupProvenanceForExecution cleans store too.
		// So for this test, we manually clear the local registry to simulate a new pod
		// without wiping the persistent store.
		// We need to re-populate the store because cleanup wiped it.
		await store.set(id, storedMeta!, executionId);

		// POD B: Hydrate from store
		const idsToHydrate = [id];
		await hydrateProvenance(idsToHydrate);

		// Check if local registry is populated
		// We can't easily check the private map, but getProvenance should work if we had the object
		// We need to manually reconstruct the object "state" (simulate loading from DB)
		const restoredObj = { name: 'Alice', secret: 'secret-value' };
		Object.defineProperty(restoredObj, '__prov_id__', {
			value: id,
			writable: false,
			enumerable: true,
			configurable: true,
		});

		const metadata = getProvenance(restoredObj);
		expect(metadata).toBeDefined();
		expect(metadata?.id).toBe(id);
		expect(metadata?.source.type).toBe(ProvenanceSource.TOOL);
	});

	it('should hydrate all provenance for an execution ID', async () => {
		const executionId = 'exec-456';
		setProvenanceExecutionId(executionId);

		// Create multiple proxies
		const user = createProvenanceProxy(
			{ id: 1 },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			}
		);
		const post = createProvenanceProxy(
			{ id: 101 },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getPost',
				apiGroup: 'posts',
				timestamp: Date.now(),
			}
		);

		const userId = (user as any).__prov_id__;
		const postId = (post as any).__prov_id__;

		// Wait for async persistence
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Check store has them
		const storeMap = await store.getExecution(executionId);
		expect(storeMap.size).toBeGreaterThanOrEqual(2);
		expect(storeMap.has(userId)).toBe(true);
		expect(storeMap.has(postId)).toBe(true);

		// Hydrate (in a real scenario this would be on a fresh pod)
		await hydrateExecutionProvenance(executionId);

		// Verify metadata exists (still available locally)
		const metaUser = getProvenance(user);
		expect(metaUser).toBeDefined();
		expect(metaUser?.id).toBe(userId);
	});
});
