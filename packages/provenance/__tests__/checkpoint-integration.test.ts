import { describe, it, expect, beforeEach } from '@jest/globals';
import {
	extractProvenanceRecursive,
	restoreProvenanceFromSnapshot,
	hasRestrictedProvenance,
	parsePath,
	deepClone,
	ProvenanceSource,
	ProvenanceExtractor,
	ProvenanceAttacher,
	CheckpointProvenanceSnapshot,
	ProvenanceMetadata,
	ReaderPermissions,
} from '../src/index';

describe('Checkpoint Integration Utilities', () => {
	describe('parsePath', () => {
		it('should parse empty path', () => {
			expect(parsePath('')).toEqual([]);
		});

		it('should parse array index path', () => {
			expect(parsePath('[0]')).toEqual(['0']);
			expect(parsePath('[1]')).toEqual(['1']);
			expect(parsePath('[42]')).toEqual(['42']);
		});

		it('should parse object property path', () => {
			expect(parsePath('.name')).toEqual(['name']);
			expect(parsePath('.user.name')).toEqual(['user', 'name']);
		});

		it('should parse mixed array and object paths', () => {
			expect(parsePath('[0].name')).toEqual(['0', 'name']);
			expect(parsePath('[0].user.email')).toEqual(['0', 'user', 'email']);
			expect(parsePath('.items[0]')).toEqual(['items', '0']);
			expect(parsePath('.items[0].name')).toEqual(['items', '0', 'name']);
		});

		it('should parse complex nested paths', () => {
			expect(parsePath('[0].data.items[1].value')).toEqual(['0', 'data', 'items', '1', 'value']);
		});
	});

	describe('deepClone', () => {
		it('should clone primitives', () => {
			expect(deepClone(42)).toBe(42);
			expect(deepClone('hello')).toBe('hello');
			expect(deepClone(true)).toBe(true);
			expect(deepClone(null)).toBe(null);
			expect(deepClone(undefined)).toBe(undefined);
		});

		it('should clone simple objects', () => {
			const obj = { name: 'Alice', age: 30 };
			const cloned = deepClone(obj);
			expect(cloned).toEqual(obj);
			expect(cloned).not.toBe(obj); // Different reference
		});

		it('should clone arrays', () => {
			const arr = [1, 2, 3];
			const cloned = deepClone(arr);
			expect(cloned).toEqual(arr);
			expect(cloned).not.toBe(arr);
		});

		it('should clone nested structures', () => {
			const nested = {
				user: { name: 'Alice', contacts: ['email', 'phone'] },
				metadata: { created: '2024-01-01' },
			};
			const cloned = deepClone(nested);
			expect(cloned).toEqual(nested);
			expect(cloned).not.toBe(nested);
			expect(cloned.user).not.toBe(nested.user);
			expect(cloned.user.contacts).not.toBe(nested.user.contacts);
		});
	});

	describe('hasRestrictedProvenance', () => {
		const createMetadata = (readers: ReaderPermissions): ProvenanceMetadata => ({
			id: 'test-id',
			source: { type: ProvenanceSource.TOOL, toolName: 'test', apiGroup: 'test-group', timestamp: Date.now() },
			readers,
		});

		it('should return false for undefined snapshot', () => {
			expect(hasRestrictedProvenance(undefined)).toBe(false);
		});

		it('should return false for empty snapshot', () => {
			expect(hasRestrictedProvenance({})).toBe(false);
		});

		it('should return true if hasRestrictedData flag is set', () => {
			expect(hasRestrictedProvenance({ hasRestrictedData: true })).toBe(true);
		});

		it('should detect restricted readers in top-level metadata', () => {
			const snapshot: CheckpointProvenanceSnapshot = {
				metadata: createMetadata({ type: 'restricted', readers: ['alice@example.com'] }),
			};
			expect(hasRestrictedProvenance(snapshot)).toBe(true);
		});

		it('should return false for public readers in top-level metadata', () => {
			const snapshot: CheckpointProvenanceSnapshot = {
				metadata: createMetadata({ type: 'public' }),
			};
			expect(hasRestrictedProvenance(snapshot)).toBe(false);
		});

		it('should detect restricted readers in entries', () => {
			const snapshot: CheckpointProvenanceSnapshot = {
				entries: [
					{
						path: '[0]',
						metadata: createMetadata({ type: 'public' }),
					},
					{
						path: '[1]',
						metadata: createMetadata({ type: 'restricted', readers: ['bob@example.com'] }),
					},
				],
			};
			expect(hasRestrictedProvenance(snapshot)).toBe(true);
		});

		it('should detect restricted readers in primitives', () => {
			const snapshot: CheckpointProvenanceSnapshot = {
				primitives: [
					['[0]:public-value', createMetadata({ type: 'public' })],
					['[1]:secret', createMetadata({ type: 'restricted', readers: ['alice@example.com'] })],
				],
			};
			expect(hasRestrictedProvenance(snapshot)).toBe(true);
		});

		it('should return false when all provenance is public', () => {
			const snapshot: CheckpointProvenanceSnapshot = {
				metadata: createMetadata({ type: 'public' }),
				entries: [
					{ path: '[0]', metadata: createMetadata({ type: 'public' }) },
					{ path: '[1]', metadata: createMetadata({ type: 'public' }) },
				],
				primitives: [['key:value', createMetadata({ type: 'public' })]],
			};
			expect(hasRestrictedProvenance(snapshot)).toBe(false);
		});
	});

	describe('extractProvenanceRecursive', () => {
		let mockExtractor: jest.MockedFunction<ProvenanceExtractor>;

		beforeEach(() => {
			mockExtractor = jest.fn();
		});

		const createMetadata = (id: string, readers: ReaderPermissions): ProvenanceMetadata => ({
			id,
			source: { type: ProvenanceSource.TOOL, toolName: 'test', apiGroup: 'test-group', timestamp: Date.now() },
			readers,
		});

		it('should handle null and undefined', () => {
			const result1 = extractProvenanceRecursive(null, mockExtractor);
			expect(result1.entries).toEqual([]);
			expect(result1.primitives).toEqual([]);
			expect(result1.hasRestrictedData).toBe(false);

			const result2 = extractProvenanceRecursive(undefined, mockExtractor);
			expect(result2.entries).toEqual([]);
			expect(result2.primitives).toEqual([]);
			expect(result2.hasRestrictedData).toBe(false);
		});

		it('should extract provenance from primitives', () => {
			const metadata = createMetadata('prov-1', { type: 'public' });
			mockExtractor.mockReturnValue(metadata);

			const result = extractProvenanceRecursive('test-string', mockExtractor);

			expect(result.entries).toEqual([]);
			expect(result.primitives).toEqual([[':test-string', metadata]]);
			expect(result.hasRestrictedData).toBe(false);
		});

		it('should detect restricted primitives', () => {
			const metadata = createMetadata('prov-1', { type: 'restricted', readers: ['alice@example.com'] });
			mockExtractor.mockReturnValue(metadata);

			const result = extractProvenanceRecursive('secret', mockExtractor);

			expect(result.primitives).toEqual([[':secret', metadata]]);
			expect(result.hasRestrictedData).toBe(true);
		});

		it('should extract provenance from simple object', () => {
			const obj = { name: 'Alice' };
			const metadata = createMetadata('prov-1', { type: 'public' });

			mockExtractor.mockImplementation((value) => {
				if (value === obj) return metadata;
				return null;
			});

			const result = extractProvenanceRecursive(obj, mockExtractor);

			expect(result.entries).toEqual([{ path: '', metadata }]);
			expect(result.hasRestrictedData).toBe(false);
		});

		it('should extract provenance from array elements', () => {
			const item1 = { name: 'Alice' };
			const item2 = { name: 'Bob' };
			const arr = [item1, item2];

			const meta1 = createMetadata('prov-alice', { type: 'restricted', readers: ['alice@example.com'] });
			const meta2 = createMetadata('prov-bob', { type: 'restricted', readers: ['bob@example.com'] });

			mockExtractor.mockImplementation((value) => {
				if (value === item1) return meta1;
				if (value === item2) return meta2;
				return null;
			});

			const result = extractProvenanceRecursive(arr, mockExtractor);

			expect(result.entries).toEqual([
				{ path: '[0]', metadata: meta1 },
				{ path: '[1]', metadata: meta2 },
			]);
			expect(result.hasRestrictedData).toBe(true);
		});

		it('should extract provenance from nested objects', () => {
			const user = { name: 'Alice' };
			const metadata = { created: '2024-01-01' };
			const obj = { user, metadata };

			const userMeta = createMetadata('prov-user', { type: 'restricted', readers: ['alice@example.com'] });
			const metaMeta = createMetadata('prov-meta', { type: 'public' });

			mockExtractor.mockImplementation((value) => {
				if (value === user) return userMeta;
				if (value === metadata) return metaMeta;
				return null;
			});

			const result = extractProvenanceRecursive(obj, mockExtractor);

			expect(result.entries).toContainEqual({ path: '.user', metadata: userMeta });
			expect(result.entries).toContainEqual({ path: '.metadata', metadata: metaMeta });
			expect(result.hasRestrictedData).toBe(true);
		});

		it('should handle mixed array with some items having provenance', () => {
			const item1 = { name: 'Alice' };
			const item2 = { name: 'Bob' }; // No provenance
			const arr = [item1, item2];

			const meta1 = createMetadata('prov-alice', { type: 'public' });

			mockExtractor.mockImplementation((value) => {
				if (value === item1) return meta1;
				return null;
			});

			const result = extractProvenanceRecursive(arr, mockExtractor);

			expect(result.entries).toEqual([{ path: '[0]', metadata: meta1 }]);
			expect(result.hasRestrictedData).toBe(false);
		});

		it('should handle deeply nested structures', () => {
			const value = { name: 'Secret' };
			const nested = {
				data: {
					items: [value],
				},
			};

			const valueMeta = createMetadata('prov-1', { type: 'restricted', readers: ['alice@example.com'] });

			mockExtractor.mockImplementation((v) => {
				if (v === value) return valueMeta;
				return null;
			});

			const result = extractProvenanceRecursive(nested, mockExtractor);

			expect(result.entries).toContainEqual({ path: '.data.items[0]', metadata: valueMeta });
			expect(result.hasRestrictedData).toBe(true);
		});

		it('should skip __prov_id__ and __prov_meta__ properties', () => {
			const obj = {
				name: 'Alice',
				__prov_id__: 'should-be-skipped',
				__prov_meta__: { id: 'also-skipped' },
			};

			mockExtractor.mockReturnValue(null);

			const result = extractProvenanceRecursive(obj, mockExtractor);

			// Should only be called for 'obj' and 'name', not for __prov_* properties
			const calls = mockExtractor.mock.calls;
			const callValues = calls.map((call) => call[0]);

			expect(callValues).toContain(obj);
			expect(callValues).toContain('Alice');
			expect(callValues).not.toContain('should-be-skipped');
			expect(callValues).not.toContain({ id: 'also-skipped' });
		});

		it('should handle circular references without infinite recursion', () => {
			const obj: any = { name: 'Alice' };
			obj.self = obj; // Circular reference

			mockExtractor.mockReturnValue(null);

			// Should not throw
			expect(() => extractProvenanceRecursive(obj, mockExtractor)).not.toThrow();
		});

		it('should extract root-level and nested provenance together', () => {
			const item = { value: 'secret' };
			const arr = [item];

			const rootMeta = createMetadata('prov-root', { type: 'public' });
			const itemMeta = createMetadata('prov-item', { type: 'restricted', readers: ['alice@example.com'] });

			mockExtractor.mockImplementation((value) => {
				if (value === arr) return rootMeta;
				if (value === item) return itemMeta;
				return null;
			});

			const result = extractProvenanceRecursive(arr, mockExtractor);

			expect(result.entries).toContainEqual({ path: '', metadata: rootMeta });
			expect(result.entries).toContainEqual({ path: '[0]', metadata: itemMeta });
			expect(result.hasRestrictedData).toBe(true);
		});
	});

	describe('restoreProvenanceFromSnapshot', () => {
		let mockAttacher: jest.MockedFunction<ProvenanceAttacher>;

		beforeEach(() => {
			mockAttacher = jest.fn((value, metadata) => {
				// Default: return value with marker
				if (value === null) return null;
				return { ...(value as any), __restored__: metadata.id };
			});
		});

		const createMetadata = (id: string, readers: ReaderPermissions): ProvenanceMetadata => ({
			id,
			source: { type: ProvenanceSource.TOOL, toolName: 'test', apiGroup: 'test-group', timestamp: Date.now() },
			readers,
		});

		it('should handle empty snapshot', () => {
			const value = { name: 'Alice' };
			const result = restoreProvenanceFromSnapshot(value, {}, mockAttacher);

			expect(result).toEqual(value);
			expect(mockAttacher).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined);
		});

		it('should restore provenance using top-level metadata', () => {
			const value = { name: 'Alice' };
			const metadata = createMetadata('prov-1', { type: 'public' });
			const snapshot: CheckpointProvenanceSnapshot = { metadata };

			const result = restoreProvenanceFromSnapshot(value, snapshot, mockAttacher);

			expect(mockAttacher).toHaveBeenCalledWith(value, metadata, undefined);
			expect(result).toEqual({ name: 'Alice', __restored__: 'prov-1' });
		});

		it('should restore provenance to array elements using entries', () => {
			const arr = [{ name: 'Alice' }, { name: 'Bob' }];
			const meta1 = createMetadata('prov-alice', { type: 'public' });
			const meta2 = createMetadata('prov-bob', { type: 'public' });

			const snapshot: CheckpointProvenanceSnapshot = {
				entries: [
					{ path: '[0]', metadata: meta1 },
					{ path: '[1]', metadata: meta2 },
				],
			};

			const result = restoreProvenanceFromSnapshot(arr, snapshot, mockAttacher) as any[];

			// Should have called attacher for both entries
			expect(mockAttacher).toHaveBeenCalled();
			const calls = mockAttacher.mock.calls.filter((call) => call[0] !== null);
			expect(calls.length).toBeGreaterThanOrEqual(2);
		});

		it('should restore provenance to nested objects', () => {
			const obj = {
				user: { name: 'Alice' },
				metadata: { created: '2024-01-01' },
			};

			const userMeta = createMetadata('prov-user', { type: 'restricted', readers: ['alice@example.com'] });
			const metaMeta = createMetadata('prov-meta', { type: 'public' });

			const snapshot: CheckpointProvenanceSnapshot = {
				entries: [
					{ path: '.user', metadata: userMeta },
					{ path: '.metadata', metadata: metaMeta },
				],
			};

			const result = restoreProvenanceFromSnapshot(obj, snapshot, mockAttacher) as any;

			// Should have attached provenance to nested objects
			expect(result.user.__restored__).toBe('prov-user');
			expect(result.metadata.__restored__).toBe('prov-meta');
		});

		it('should prefer entries over metadata when both are present', () => {
			const value = { name: 'Alice' };
			const topMeta = createMetadata('prov-top', { type: 'public' });
			const entryMeta = createMetadata('prov-entry', { type: 'public' });

			const snapshot: CheckpointProvenanceSnapshot = {
				metadata: topMeta,
				entries: [{ path: '', metadata: entryMeta }],
			};

			const result = restoreProvenanceFromSnapshot(value, snapshot, mockAttacher) as any;

			// Should use entries (path-based restoration), not top-level metadata
			expect(result.__restored__).toBe('prov-entry');
		});

		it('should register primitive taints', () => {
			const value = { name: 'Alice' };
			const metadata = createMetadata('prov-1', { type: 'public' });
			const primitiveMeta = createMetadata('prov-prim', { type: 'restricted', readers: ['alice@example.com'] });

			const snapshot: CheckpointProvenanceSnapshot = {
				metadata,
				primitives: [[':secret-value', primitiveMeta]],
			};

			restoreProvenanceFromSnapshot(value, snapshot, mockAttacher);

			// Should have called attacher for primitive registration
			const primitiveCalls = mockAttacher.mock.calls.filter((call) => call[0] === null);
			expect(primitiveCalls.length).toBeGreaterThan(0);
			expect(primitiveCalls[0]?.[1]).toEqual(primitiveMeta);
			expect(primitiveCalls[0]?.[2]).toEqual([[':secret-value', primitiveMeta]]);
		});

		it('should handle deeply nested path restoration', () => {
			const obj = {
				data: {
					items: [{ value: 'secret' }],
				},
			};

			const valueMeta = createMetadata('prov-1', { type: 'restricted', readers: ['alice@example.com'] });

			const snapshot: CheckpointProvenanceSnapshot = {
				entries: [{ path: '.data.items[0]', metadata: valueMeta }],
			};

			const result = restoreProvenanceFromSnapshot(obj, snapshot, mockAttacher) as any;

			// Should have attached provenance to deeply nested value
			expect(result.data.items[0].__restored__).toBe('prov-1');
		});

		it('should handle mixed root and nested entries', () => {
			const arr = [{ name: 'Alice' }];
			const rootMeta = createMetadata('prov-root', { type: 'public' });
			const itemMeta = createMetadata('prov-item', { type: 'public' });

			const snapshot: CheckpointProvenanceSnapshot = {
				entries: [
					{ path: '', metadata: rootMeta },
					{ path: '[0]', metadata: itemMeta },
				],
			};

			const result = restoreProvenanceFromSnapshot(arr, snapshot, mockAttacher) as any;

			// Should have called attacher for both root and nested
			expect(mockAttacher).toHaveBeenCalled();
			const calls = mockAttacher.mock.calls.filter((call) => call[0] !== null);
			expect(calls.length).toBeGreaterThanOrEqual(2);
		});

		it('should return value unchanged if no attacher provided', () => {
			const value = { name: 'Alice' };
			const metadata = createMetadata('prov-1', { type: 'public' });
			const snapshot: CheckpointProvenanceSnapshot = { metadata };

			const result = restoreProvenanceFromSnapshot(value, snapshot, undefined as any);

			expect(result).toBe(value);
		});
	});

	describe('Integration: Extract and Restore Round-Trip', () => {
		let mockExtractor: jest.MockedFunction<ProvenanceExtractor>;
		let mockAttacher: jest.MockedFunction<ProvenanceAttacher>;

		beforeEach(() => {
			// Extractor: Return metadata for objects with __prov_id__
			mockExtractor = jest.fn((value) => {
				if (value && typeof value === 'object' && '__prov_id__' in value) {
					const id = (value as any).__prov_id__;
					return {
						id,
						source: { type: ProvenanceSource.TOOL, toolName: 'test', apiGroup: 'test-group', timestamp: Date.now() },
						readers: id.includes('restricted')
							? { type: 'restricted', readers: ['alice@example.com'] }
							: { type: 'public' },
					};
				}
				return null;
			});

			// Attacher: Add __restored__ marker
			mockAttacher = jest.fn((value, metadata) => {
				if (value === null) return null;
				return { ...(value as any), __restored__: metadata.id };
			});
		});

		it('should preserve provenance through extract-restore cycle', () => {
			const original = {
				__prov_id__: 'prov-1',
				name: 'Alice',
			};

			// Extract
			const extracted = extractProvenanceRecursive(original, mockExtractor);
			expect(extracted.entries).toHaveLength(1);
			expect(extracted.entries[0]?.metadata.id).toBe('prov-1');

			// Create snapshot
			const snapshot: CheckpointProvenanceSnapshot = {
				entries: extracted.entries,
				hasRestrictedData: extracted.hasRestrictedData,
			};

			// Simulate serialization (remove provenance markers)
			const serialized = { name: 'Alice' };

			// Restore
			const restored = restoreProvenanceFromSnapshot(serialized, snapshot, mockAttacher) as any;

			expect(restored.__restored__).toBe('prov-1');
		});

		it('should preserve nested provenance through cycle', () => {
			const original = [
				{ __prov_id__: 'prov-restricted', name: 'Alice' },
				{ __prov_id__: 'prov-public', message: 'Hello' },
			];

			// Extract
			const extracted = extractProvenanceRecursive(original, mockExtractor);
			expect(extracted.entries).toHaveLength(2);
			expect(extracted.hasRestrictedData).toBe(true);

			// Create snapshot
			const snapshot: CheckpointProvenanceSnapshot = {
				entries: extracted.entries,
				hasRestrictedData: extracted.hasRestrictedData,
			};

			// Simulate serialization
			const serialized = [{ name: 'Alice' }, { message: 'Hello' }];

			// Restore
			const restored = restoreProvenanceFromSnapshot(serialized, snapshot, mockAttacher) as any[];

			expect(restored[0].__restored__).toBe('prov-restricted');
			expect(restored[1].__restored__).toBe('prov-public');
		});

		it('should handle Promise.all-like aggregation scenario', () => {
			// Simulate Promise.all([api.getUser(1), api.getUser(2)])
			const original = [
				{ __prov_id__: 'prov-alice', name: 'Alice', id: '1' },
				{ __prov_id__: 'prov-bob', name: 'Bob', id: '2' },
			];

			// Extract (would happen on checkpoint buffer)
			const extracted = extractProvenanceRecursive(original, mockExtractor);

			// Checkpoint storage
			const snapshot: CheckpointProvenanceSnapshot = {
				entries: extracted.entries,
				primitives: extracted.primitives,
				hasRestrictedData: extracted.hasRestrictedData,
			};

			// Checkpoint restore (would happen on __restore.checkpoint call)
			const serialized = [
				{ name: 'Alice', id: '1' },
				{ name: 'Bob', id: '2' },
			];

			const restored = restoreProvenanceFromSnapshot(serialized, snapshot, mockAttacher) as any[];

			// Both items should have provenance restored
			expect(restored[0].__restored__).toBe('prov-alice');
			expect(restored[1].__restored__).toBe('prov-bob');
		});
	});
});
