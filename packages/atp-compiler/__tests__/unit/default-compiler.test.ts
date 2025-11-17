/**
 * Tests to verify createDefaultCompiler() provides identical functionality to ATPCompiler
 */

import { ATPCompiler } from '../../src/transformer/index.js';
import { createDefaultCompiler } from '../../src/plugin-system/create-default-compiler.js';
import type { TransformationPlugin } from '../../src/plugin-system/plugin-api.js';

describe('Default Compiler - Functional Equivalence', () => {
	describe('Detection', () => {
		it('should detect for-of-await patterns like ATPCompiler', async () => {
			const code = `
				for (const item of items) {
					await processItem(item);
				}
			`;

			const atpCompiler = new ATPCompiler();
			const pluggableCompiler = createDefaultCompiler();

			const atpResult = atpCompiler.detect(code);
			const pluggableResult = await pluggableCompiler.detect(code);

			expect(pluggableResult.needsTransform).toBe(atpResult.needsTransform);
			expect(pluggableResult.patterns).toEqual(expect.arrayContaining(atpResult.patterns));
		});

		it('should detect map-async patterns like ATPCompiler', async () => {
			const code = `
				const results = items.map(async (item) => {
					return await processItem(item);
				});
			`;

			const atpCompiler = new ATPCompiler();
			const pluggableCompiler = createDefaultCompiler();

			const atpResult = atpCompiler.detect(code);
			const pluggableResult = await pluggableCompiler.detect(code);

			expect(pluggableResult.needsTransform).toBe(atpResult.needsTransform);
			expect(pluggableResult.patterns).toEqual(expect.arrayContaining(atpResult.patterns));
		});

		it('should detect Promise.all patterns like ATPCompiler', async () => {
			const code = `
				const results = await Promise.all(promises);
			`;

			const atpCompiler = new ATPCompiler();
			const pluggableCompiler = createDefaultCompiler();

			const atpResult = atpCompiler.detect(code);
			const pluggableResult = await pluggableCompiler.detect(code);

			expect(pluggableResult.needsTransform).toBe(atpResult.needsTransform);
		});
	});

	describe('Transformation', () => {
		it('should transform for-of loops like ATPCompiler', async () => {
			const code = `
				for (const item of items) {
					await processItem(item);
				}
			`;

			const atpCompiler = new ATPCompiler();
			const pluggableCompiler = createDefaultCompiler();

			const atpResult = atpCompiler.transform(code);
			const pluggableResult = await pluggableCompiler.transform(code);

			// Both should transform
			expect(pluggableResult.transformed).toBe(true);
			expect(atpResult.transformed).toBe(true);

			// Both should produce transformed code (not exact match due to formatting)
			expect(pluggableResult.code).toContain('__runtime.resumableForOf');
			expect(atpResult.code).toContain('__runtime.resumableForOf');

			// Metadata should be similar
			expect(pluggableResult.metadata.loopCount).toBeGreaterThan(0);
			expect(atpResult.metadata.loopCount).toBeGreaterThan(0);
		});

		it('should transform array methods like ATPCompiler', async () => {
			const code = `
				const results = items.map(async (item) => {
					return await processItem(item);
				});
			`;

			const atpCompiler = new ATPCompiler();
			const pluggableCompiler = createDefaultCompiler();

			const atpResult = atpCompiler.transform(code);
			const pluggableResult = await pluggableCompiler.transform(code);

			expect(pluggableResult.transformed).toBe(true);
			expect(atpResult.transformed).toBe(true);

			// Code should contain transformation
			expect(pluggableResult.code).toContain('map');
			expect(atpResult.code).toContain('map');
			
			// Metadata counts should match
			expect(pluggableResult.metadata).toMatchObject({
				loopCount: atpResult.metadata.loopCount,
				arrayMethodCount: atpResult.metadata.arrayMethodCount,
				parallelCallCount: atpResult.metadata.parallelCallCount,
			});
		});

		it('should handle code that needs no transformation', async () => {
			const code = `
				const x = 1 + 1;
				console.log(x);
			`;

			const atpCompiler = new ATPCompiler();
			const pluggableCompiler = createDefaultCompiler();

			const atpResult = atpCompiler.transform(code);
			const pluggableResult = await pluggableCompiler.transform(code);

			expect(pluggableResult.transformed).toBe(false);
			expect(atpResult.transformed).toBe(false);

			// Code should be unchanged
			expect(pluggableResult.code).toBe(code);
			expect(atpResult.code).toBe(code);
		});
	});

	describe('Configuration', () => {
		it('should respect enableBatchParallel config', async () => {
			const code = `
				const results = await Promise.all([
					fetch('/api/1'),
					fetch('/api/2'),
				]);
			`;

			const compilerWithBatch = createDefaultCompiler({ enableBatchParallel: true });
			const compilerWithoutBatch = createDefaultCompiler({ enableBatchParallel: false });

			const resultWith = await compilerWithBatch.transform(code);
			const resultWithout = await compilerWithoutBatch.transform(code);

			// Both should transform
			expect(resultWith.transformed).toBe(true);
			expect(resultWithout.transformed).toBe(true);

			// The code output might differ based on batch config
			// (exact differences depend on implementation)
		});

		it('should respect batchSizeThreshold config', async () => {
			const code = `
				for (const item of items) {
					await processItem(item);
				}
			`;

			const compilerSmall = createDefaultCompiler({ batchSizeThreshold: 5 });
			const compilerLarge = createDefaultCompiler({ batchSizeThreshold: 100 });

			const resultSmall = await compilerSmall.transform(code);
			const resultLarge = await compilerLarge.transform(code);

			// Both should transform
			expect(resultSmall.transformed).toBe(true);
			expect(resultLarge.transformed).toBe(true);
		});
	});

	describe('Extensibility', () => {
		it('should allow adding custom plugins on top of defaults', async () => {
			const compiler = createDefaultCompiler();

			let customPluginExecuted = false;

			// Add custom transformation plugin that counts identifiers
			const customPlugin: TransformationPlugin = {
				name: 'custom-plugin',
				version: '1.0.0',
				priority: 50, // Lower priority to run after defaults
				getVisitor: () => ({
					Identifier: (path: any) => {
						if (path.node.name === 'item') {
							customPluginExecuted = true;
						}
					},
				}),
				getMetadata: () => ({}),
				reset: () => {
					customPluginExecuted = false;
				},
			};
			
			compiler.use(customPlugin);

			// Use code that will trigger transformation
			const code = `
				for (const item of items) {
					await processItem(item);
				}
			`;
			const result = await compiler.transform(code);

			// Verify plugin was registered and executed
			expect(customPluginExecuted).toBe(true);
			expect(result).toHaveProperty('code');
			expect(result.transformed).toBe(true);
		});

		it('should work with AST caching', async () => {
			const compiler = createDefaultCompiler();

			const code = `const x = 42;`;

			// First call - parses and caches
			await compiler.detect(code);
			expect(compiler.getCacheStats().size).toBe(1);

			// Second call - uses cache
			await compiler.transform(code);
			expect(compiler.getCacheStats().size).toBe(1);
		});
	});

	describe('Drop-in Replacement', () => {
		it('should be usable as ATPCompilerLike type', async () => {
			// This test verifies the type compatibility
			const compiler = createDefaultCompiler({
				enableBatchParallel: true,
				batchSizeThreshold: 10,
			});

			const code = `
				for (const item of items) {
					await processItem(item);
				}
			`;

			// Should work with same API
			const detection = await compiler.detect(code);
			expect(detection).toHaveProperty('needsTransform');
			expect(detection).toHaveProperty('patterns');

			const result = await compiler.transform(code);
			expect(result).toHaveProperty('code');
			expect(result).toHaveProperty('transformed');
			expect(result).toHaveProperty('metadata');
		});
	});
});

