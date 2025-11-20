import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';

export interface RuntimeContext {
	llmCallCount: number;
	approvalCallCount: number;
	logs: string[];
	startTime: number;
	maxLLMCalls: number;
	executionId: string;
	clientId?: string;
	hintMetadata?: Map<string, any>;
}

export interface ExecutorConfig {
	defaultTimeout: number;
	maxTimeout: number;
	defaultMemoryLimit: number;
	maxMemoryLimit: number;
	defaultLLMCallLimit: number;
	maxLLMCallLimit: number;
	cacheProvider?: CacheProvider;
}
