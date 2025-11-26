export * from './errors.js';
export * from './context.js';
export * from './checkpoint-manager.js';
export * from './resumable-loops.js';
export * from './resumable-arrays.js';
export * from './resumable-parallel.js';
export * from './batch-parallel.js';
export * from './runtime-functions.js';

import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';
import { CheckpointManager, setCheckpointManager } from './checkpoint-manager.js';
import { setRuntimeContext } from './context.js';

export interface InitializeRuntimeOptions {
	executionId: string;
	cache: CacheProvider;
	checkpointPrefix?: string;
}

export function initializeRuntime(options: InitializeRuntimeOptions): void {
	const checkpointManager = new CheckpointManager(
		options.executionId,
		options.cache,
		options.checkpointPrefix
	);

	setCheckpointManager(checkpointManager);

	setRuntimeContext({
		executionId: options.executionId,
		cache: options.cache,
		checkpointPrefix: options.checkpointPrefix,
	});
}

export function cleanupRuntime(): void {}
