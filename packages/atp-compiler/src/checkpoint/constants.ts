import { CheckpointConfig } from './checkpoint-types';

/**
 * Default configuration values
 */
export const DEFAULT_CHECKPOINT_CONFIG: Required<Omit<CheckpointConfig, 'strategy'>> = {
    maxFullSnapshotSize: 10_000, // 10KB
    maxArrayItemsFull: 100,
    defaultTTL: 3600, // 1 hour
    enabled: true,
};

export const CHECKPOINT_RUNTIME_NAMESPACE = '__checkpoint';

export const CHECKPOINT_RESTORE_API_NAME = 'restore';

export const CHECKPOINT_RESTORE_METHOD_NAME = [CHECKPOINT_RUNTIME_NAMESPACE, CHECKPOINT_RESTORE_API_NAME].join('.');
