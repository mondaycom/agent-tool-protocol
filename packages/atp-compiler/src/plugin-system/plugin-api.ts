/**
 * ATP Compiler Plugin API
 *
 * Extensible plugin system for custom transformations and detections
 */

import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import type { CompilerConfig, DetectionResult, TransformMetadata, AsyncPattern } from '../types.js';

/**
 * Base plugin interface
 */
export interface CompilerPlugin {
	/**
	 * Unique plugin name
	 */
	name: string;

	/**
	 * Plugin version (semver)
	 */
	version: string;

	/**
	 * Plugin priority (higher = runs first)
	 * Built-in plugins: 100
	 * User plugins: 50 (default)
	 * Low priority: 10
	 */
	priority?: number;

	/**
	 * Plugin initialization (optional)
	 * Called once when plugin is registered
	 */
	initialize?(config: CompilerConfig): void | Promise<void>;

	/**
	 * Plugin cleanup (optional)
	 * Called when compiler is disposed
	 */
	dispose?(): void | Promise<void>;
}

/**
 * Detection plugin - detects patterns that need transformation
 */
export interface DetectionPlugin extends CompilerPlugin {
	/**
	 * Detect patterns in code
	 */
	detect(code: string, ast: t.File): DetectionResult | Promise<DetectionResult>;

	/**
	 * Custom async patterns this plugin can detect
	 */
	patterns: AsyncPattern[];
}

/**
 * Transformation plugin - transforms AST nodes
 */
export interface TransformationPlugin extends CompilerPlugin {
	/**
	 * Visitor pattern for AST traversal
	 * Return visitor object compatible with @babel/traverse
	 */
	getVisitor(config: CompilerConfig): BabelVisitor;

	/**
	 * Get transformation metadata after transform
	 */
	getMetadata(): Partial<TransformMetadata>;

	/**
	 * Reset plugin state (called before each transform)
	 */
	reset(): void;
}

/**
 * Optimizer plugin - optimizes transformed code
 */
export interface OptimizerPlugin extends CompilerPlugin {
	/**
	 * Optimize AST after all transformations
	 */
	optimize(ast: t.File, config: CompilerConfig): t.File | Promise<t.File>;
}

/**
 * Validator plugin - validates code before/after transformation
 */
export interface ValidatorPlugin extends CompilerPlugin {
	/**
	 * Validate code (throw error if invalid)
	 */
	validate(code: string, ast: t.File, phase: 'pre' | 'post'): void | Promise<void>;
}

/**
 * Babel visitor type (simplified)
 */
export interface BabelVisitor {
	[key: string]: (path: NodePath<any>) => void;
}

/**
 * Plugin context - shared state during transformation
 */
export interface PluginContext {
	config: CompilerConfig;
	executionId?: string;
	metadata: TransformMetadata;
	patterns: Set<AsyncPattern>;
}

/**
 * Plugin registry for managing plugins
 */
export class PluginRegistry {
	private detectors: DetectionPlugin[] = [];
	private transformers: TransformationPlugin[] = [];
	private optimizers: OptimizerPlugin[] = [];
	private validators: ValidatorPlugin[] = [];

	/**
	 * Register a plugin
	 */
	register(plugin: CompilerPlugin): void {
		// Check for name conflicts
		if (this.findPlugin(plugin.name)) {
			throw new Error(
				`Plugin "${plugin.name}" is already registered. ` +
					`Please use a unique name or unregister the existing plugin first.`
			);
		}

		// Type guards to determine plugin type
		if (this.isDetectionPlugin(plugin)) {
			this.detectors.push(plugin);
			this.detectors.sort((a, b) => (b.priority || 50) - (a.priority || 50));
		}

		if (this.isTransformationPlugin(plugin)) {
			this.transformers.push(plugin);
			this.transformers.sort((a, b) => (b.priority || 50) - (a.priority || 50));
		}

		if (this.isOptimizerPlugin(plugin)) {
			this.optimizers.push(plugin);
			this.optimizers.sort((a, b) => (b.priority || 50) - (a.priority || 50));
		}

		if (this.isValidatorPlugin(plugin)) {
			this.validators.push(plugin);
			this.validators.sort((a, b) => (b.priority || 50) - (a.priority || 50));
		}
	}

	/**
	 * Find a plugin by name
	 */
	findPlugin(name: string): CompilerPlugin | undefined {
		const allPlugins = [
			...this.detectors,
			...this.transformers,
			...this.optimizers,
			...this.validators,
		];
		return allPlugins.find((p) => p.name === name);
	}

	/**
	 * Unregister a plugin by name
	 */
	unregister(name: string): boolean {
		let removed = false;

		this.detectors = this.detectors.filter((p) => {
			if (p.name === name) {
				removed = true;
				return false;
			}
			return true;
		});

		this.transformers = this.transformers.filter((p) => {
			if (p.name === name) {
				removed = true;
				return false;
			}
			return true;
		});

		this.optimizers = this.optimizers.filter((p) => {
			if (p.name === name) {
				removed = true;
				return false;
			}
			return true;
		});

		this.validators = this.validators.filter((p) => {
			if (p.name === name) {
				removed = true;
				return false;
			}
			return true;
		});

		return removed;
	}

	/**
	 * Get all detection plugins
	 */
	getDetectors(): DetectionPlugin[] {
		return this.detectors;
	}

	/**
	 * Get all transformation plugins
	 */
	getTransformers(): TransformationPlugin[] {
		return this.transformers;
	}

	/**
	 * Get all optimizer plugins
	 */
	getOptimizers(): OptimizerPlugin[] {
		return this.optimizers;
	}

	/**
	 * Get all validator plugins
	 */
	getValidators(): ValidatorPlugin[] {
		return this.validators;
	}

	/**
	 * Initialize all plugins
	 */
	async initializeAll(config: CompilerConfig): Promise<void> {
		const allPlugins = [
			...this.detectors,
			...this.transformers,
			...this.optimizers,
			...this.validators,
		];

		for (const plugin of allPlugins) {
			if (plugin.initialize) {
				await plugin.initialize(config);
			}
		}
	}

	/**
	 * Dispose all plugins
	 */
	async disposeAll(): Promise<void> {
		const allPlugins = [
			...this.detectors,
			...this.transformers,
			...this.optimizers,
			...this.validators,
		];

		for (const plugin of allPlugins) {
			if (plugin.dispose) {
				await plugin.dispose();
			}
		}
	}

	/**
	 * Type guards
	 */
	private isDetectionPlugin(plugin: CompilerPlugin): plugin is DetectionPlugin {
		return 'detect' in plugin && 'patterns' in plugin;
	}

	private isTransformationPlugin(plugin: CompilerPlugin): plugin is TransformationPlugin {
		return 'getVisitor' in plugin && 'getMetadata' in plugin && 'reset' in plugin;
	}

	private isOptimizerPlugin(plugin: CompilerPlugin): plugin is OptimizerPlugin {
		return 'optimize' in plugin;
	}

	private isValidatorPlugin(plugin: CompilerPlugin): plugin is ValidatorPlugin {
		return 'validate' in plugin;
	}
}

/**
 * Utility function to create a simple transformation plugin
 */
export function createTransformPlugin(config: {
	name: string;
	version: string;
	priority?: number;
	visitor: BabelVisitor;
	getMetadata?: () => Partial<TransformMetadata>;
}): TransformationPlugin {
	let transformCount = 0;

	return {
		name: config.name,
		version: config.version,
		priority: config.priority || 50,

		getVisitor() {
			return config.visitor;
		},

		getMetadata() {
			return config.getMetadata ? config.getMetadata() : { loopCount: transformCount };
		},

		reset() {
			transformCount = 0;
		},
	};
}
