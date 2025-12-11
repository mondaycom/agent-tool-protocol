export { VercelAIATPClient } from './client.js';
export { createATPTools, createATPStreamingTools } from './tools.js';
export {
	createVercelEventHandler,
	createEventCollector,
	type UIMessageStreamWriter,
	type UIStreamEvent,
	type CreateVercelEventHandlerOptions,
} from './event-adapter.js';
export type {
	VercelAIATPClientOptions,
	CreateATPToolsOptions,
	StreamingToolsOptions,
	ATPToolsResult,
	ApprovalHandler,
	ApprovalRequest,
	ApprovalResponse,
	EmbeddingProvider,
} from './types.js';
