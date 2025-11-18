/**
 * Unit tests for the Plugin System
 */

import { PluginRegistry } from '../../src/plugin-system/plugin-api.js';
import { PluggableCompiler } from '../../src/plugin-system/pluggable-compiler.js';
import type {
	DetectionPlugin,
	TransformationPlugin,
	OptimizerPlugin,
	ValidatorPlugin,
	BabelVisitor,
} from '../../src/plugin-system/plugin-api.js';
import type { CompilerConfig, TransformMetadata, DetectionResult } from '../../src/types.js';
import * as t from '@babel/types';

describe('PluginRegistry', () => {
	let registry: PluginRegistry;

	beforeEach(() => {
		registry = new PluginRegistry();
	});

	describe('Plugin Registration', () => {
		it('should register a detection plugin', () => {
			const plugin: DetectionPlugin = {
				name: 'test-detector',
				version: '1.0.0',
				priority: 100,
				patterns: ['for-of-await'],
				detect: async (code: string, ast: t.File): Promise<DetectionResult> => ({
					needsTransform: true,
					patterns: ['for-of-await'],
					batchableParallel: false,
				}),
			};

			registry.register(plugin);
			const plugins = registry.getDetectors();
			expect(plugins).toHaveLength(1);
			expect(plugins[0]!.name).toBe('test-detector');
		});

		it('should register a transformation plugin', () => {
			const plugin: TransformationPlugin = {
				name: 'test-transformer',
				version: '1.0.0',
				priority: 100,
				getVisitor: (config: CompilerConfig): BabelVisitor => ({}),
				getMetadata: () => ({ loopCount: 0 }),
				reset: () => {},
			};

			registry.register(plugin);
			const plugins = registry.getTransformers();
			expect(plugins).toHaveLength(1);
			expect(plugins[0]!.name).toBe('test-transformer');
		});

		it('should throw error when registering duplicate plugin names', () => {
			const plugin1: DetectionPlugin = {
				name: 'duplicate',
				version: '1.0.0',
				priority: 100,
				patterns: ['for-of-await'],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
			};

			const plugin2: DetectionPlugin = {
				name: 'duplicate',
				version: '2.0.0',
				priority: 50,
				patterns: ['map-async'],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
			};

			registry.register(plugin1);
			expect(() => registry.register(plugin2)).toThrow('Plugin "duplicate" is already registered');
		});

		it('should sort plugins by priority (higher first)', () => {
			const plugin1: DetectionPlugin = {
				name: 'low-priority',
				version: '1.0.0',
				priority: 10,
				patterns: [],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
			};

			const plugin2: DetectionPlugin = {
				name: 'high-priority',
				version: '1.0.0',
				priority: 100,
				patterns: [],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
			};

			registry.register(plugin1);
			registry.register(plugin2);

			const plugins = registry.getDetectors();
			expect(plugins[0]!.name).toBe('high-priority');
			expect(plugins[1]!.name).toBe('low-priority');
		});
	});

	describe('Plugin Unregistration', () => {
		it('should unregister a plugin by name', () => {
			const plugin: DetectionPlugin = {
				name: 'to-remove',
				version: '1.0.0',
				priority: 100,
				patterns: [],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
			};

			registry.register(plugin);
			expect(registry.getDetectors()).toHaveLength(1);

			const removed = registry.unregister('to-remove');
			expect(removed).toBe(true);
			expect(registry.getDetectors()).toHaveLength(0);
		});

		it('should return false when unregistering non-existent plugin', () => {
			const removed = registry.unregister('non-existent');
			expect(removed).toBe(false);
		});
	});

	describe('Plugin Retrieval', () => {
		it('should find plugin by name', () => {
			const plugin: DetectionPlugin = {
				name: 'findable',
				version: '1.0.0',
				priority: 100,
				patterns: [],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
			};

			registry.register(plugin);
			const found = registry.findPlugin('findable');
			expect(found).toBeDefined();
			expect(found?.name).toBe('findable');
		});

		it('should return undefined for non-existent plugin', () => {
			const found = registry.findPlugin('non-existent');
			expect(found).toBeUndefined();
		});
	});
});

describe('PluggableCompiler', () => {
	let compiler: PluggableCompiler;

	beforeEach(() => {
		compiler = new PluggableCompiler();
	});

	describe('Plugin Management', () => {
		it('should register plugin via use() method (chainable)', () => {
			const plugin: DetectionPlugin = {
				name: 'test-plugin',
				version: '1.0.0',
				patterns: [],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
			};

			const result = compiler.use(plugin);
			expect(result).toBe(compiler); // Chainable
		});

		it('should unregister plugin via remove() method', () => {
			const plugin: DetectionPlugin = {
				name: 'removable',
				version: '1.0.0',
				patterns: [],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
			};

			compiler.use(plugin);
			const removed = compiler.remove('removable');
			expect(removed).toBe(true);
		});
	});

	describe('Detection', () => {
		it('should detect patterns using registered plugins', async () => {
			const plugin: DetectionPlugin = {
				name: 'for-of-detector',
				version: '1.0.0',
				priority: 100,
				patterns: ['for-of-await'],
				detect: async (code: string): Promise<DetectionResult> => {
					return code.includes('for')
						? { needsTransform: true, patterns: ['for-of-await'], batchableParallel: false }
						: { needsTransform: false, patterns: [], batchableParallel: false };
				},
			};

			compiler.use(plugin);

			const code = `
				for (const item of items) {
					console.log(item);
				}
			`;

			const result = await compiler.detect(code);
			expect(result.needsTransform).toBe(true);
			expect(result.patterns).toContain('for-of-await');
		});

		it('should handle detection errors gracefully', async () => {
			const plugin: DetectionPlugin = {
				name: 'failing-detector',
				version: '1.0.0',
				priority: 100,
				patterns: [],
				detect: async () => {
					throw new Error('Detection failed');
				},
			};

			compiler.use(plugin);

			const result = await compiler.detect('some code');
			expect(result.needsTransform).toBe(false);
			expect(result.patterns).toEqual([]);
		});
	});

	describe('Transformation', () => {
		it('should execute transform with registered transformation plugins', async () => {
			const plugin: TransformationPlugin = {
				name: 'simple-transformer',
				version: '1.0.0',
				priority: 100,
				getVisitor: (): BabelVisitor => ({}),
				getMetadata: () => ({ loopCount: 1 }),
				reset: () => {},
			};

			compiler.use(plugin);

			const code = `const foo = 42;`;
			const result = await compiler.transform(code);
			expect(result.code).toBeTruthy(); // Code was processed
			expect(result.metadata).toBeDefined(); // Metadata is present
		});
	});

	describe('Lifecycle Management', () => {
		it('should initialize plugins automatically on first use', async () => {
			let initialized = false;

			const plugin: DetectionPlugin = {
				name: 'lifecycle-plugin',
				version: '1.0.0',
				priority: 100,
				patterns: [],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
				initialize: async () => {
					initialized = true;
				},
			};

			compiler.use(plugin);
			await compiler.detect('test code');

			expect(initialized).toBe(true);
		});

		it('should dispose plugins on compiler disposal', async () => {
			let disposed = false;

			const plugin: DetectionPlugin = {
				name: 'disposable-plugin',
				version: '1.0.0',
				patterns: [],
				detect: async () => ({ needsTransform: false, patterns: [], batchableParallel: false }),
				dispose: async () => {
					disposed = true;
				},
			};

			compiler.use(plugin);
			await compiler.dispose();

			expect(disposed).toBe(true);
		});
	});
});

describe('AST Caching', () => {
	it('should cache AST between detect() and transform()', async () => {
		const compiler = new PluggableCompiler();

		const code = `const x = 42;`;

		// First call - should parse and cache
		await compiler.detect(code);
		expect(compiler.getCacheStats().size).toBe(1);

		// Second call - should use cache
		await compiler.transform(code);
		expect(compiler.getCacheStats().size).toBe(1); // Still 1, not 2
	});

	it('should cache different code snippets separately', async () => {
		const compiler = new PluggableCompiler();

		const code1 = `const x = 1;`;
		const code2 = `const y = 2;`;

		await compiler.detect(code1);
		await compiler.detect(code2);

		expect(compiler.getCacheStats().size).toBe(2);
	});

	it('should clear cache on clearCache() call', async () => {
		const compiler = new PluggableCompiler();

		await compiler.detect(`const x = 1;`);
		expect(compiler.getCacheStats().size).toBe(1);

		compiler.clearCache();
		expect(compiler.getCacheStats().size).toBe(0);
	});

	it('should clear cache on dispose()', async () => {
		const compiler = new PluggableCompiler();

		await compiler.detect(`const x = 1;`);
		expect(compiler.getCacheStats().size).toBe(1);

		await compiler.dispose();
		expect(compiler.getCacheStats().size).toBe(0);
	});

	it('should return cache statistics', () => {
		const compiler = new PluggableCompiler();

		const stats = compiler.getCacheStats();
		expect(stats).toEqual({
			size: 0,
			enabled: true,
		});
	});
});

describe('Plugin Integration', () => {
	it('should work with detection + transformation plugins', async () => {
		const compiler = new PluggableCompiler();

		// Detection plugin
		compiler.use({
			name: 'detector',
			version: '1.0.0',
			priority: 100,
			patterns: ['for-of-await'],
			detect: async (code: string) =>
				code.includes('for')
					? { needsTransform: true, patterns: ['for-of-await'], batchableParallel: false }
					: { needsTransform: false, patterns: [], batchableParallel: false },
		} as DetectionPlugin);

		// Transformation plugin
		let loopCount = 0;
		compiler.use({
			name: 'transformer',
			version: '1.0.0',
			priority: 100,
			getVisitor: () => ({
				ForOfStatement: (path: any) => {
					loopCount++;
				},
			}),
			getMetadata: () => ({ loopCount }),
			reset: () => {
				loopCount = 0;
			},
		} as TransformationPlugin);

		const code = `
			for (const item of items) {
				console.log(item);
			}
		`;

		const detection = await compiler.detect(code);
		expect(detection.needsTransform).toBe(true);

		const result = await compiler.transform(code);
		expect(result.transformed).toBe(true);
		expect(result.metadata.loopCount).toBeGreaterThan(0);
	});
});

