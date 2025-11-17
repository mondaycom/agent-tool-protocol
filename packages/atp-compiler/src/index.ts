// Core exports
export * from './types.js';
export * from './transformer/index.js';
export * from './runtime/index.js';

// Compiler interface exports
export * from './types/compiler-interface.js';

// Plugin system exports
export * from './plugin-system/index.js';

// Main exports
export { ATPCompiler } from './transformer/index.js';
export { initializeRuntime, cleanupRuntime } from './runtime/index.js';
export { PluggableCompiler } from './plugin-system/pluggable-compiler.js';
export { PluginRegistry } from './plugin-system/plugin-api.js';
export { createDefaultCompiler } from './plugin-system/create-default-compiler.js';

// Plugin type exports for convenience
export type {
	CompilerPlugin,
	DetectionPlugin,
	TransformationPlugin,
	OptimizerPlugin,
	ValidatorPlugin,
	PluginContext,
	BabelVisitor,
} from './plugin-system/plugin-api.js';
export type { ATPCompilerLike } from './plugin-system/create-default-compiler.js';

// Compiler interface type exports
export type { ICompiler, CacheStats } from './types/compiler-interface.js';
