/**
 * LangChain Event Adapter
 *
 * Converts ATP streaming events to LangChain-compatible event format.
 * Works with LangChain's callback system and streamEvents API.
 */

import { type ATPEvent, ATPEventType } from '@mondaydotcomorg/atp-protocol';

/**
 * LangChain-style event format
 * Compatible with LangChain's streamEvents() output format
 */
export interface LangChainEvent {
	event: string;
	name?: string;
	data: unknown;
	run_id?: string;
	metadata?: Record<string, unknown>;
	tags?: string[];
}

/**
 * Options for creating the LangChain event handler
 */
export interface CreateLangChainEventHandlerOptions {
	/**
	 * Tags to add to all events
	 */
	tags?: string[];
	/**
	 * Metadata to add to all events
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Creates an event handler that converts ATP events to LangChain event format.
 *
 * @param onEvent - Callback to receive LangChain-formatted events
 * @param options - Optional configuration
 * @returns An event handler function to pass to ATP's executeStream
 *
 * @example
 * ```typescript
 * const handler = createLangChainEventHandler((event) => {
 *   console.log(event.event, event.data);
 * });
 *
 * const result = await client.executeStream(code, {}, handler);
 * ```
 */
export function createLangChainEventHandler(
	onEvent: (event: LangChainEvent) => void,
	options: CreateLangChainEventHandlerOptions = {}
): (event: ATPEvent) => void {
	const { tags = [], metadata = {} } = options;

	return (event: ATPEvent) => {
		const baseEvent = {
			run_id: event.runId,
			tags: ['atp', ...tags],
			metadata: { ...metadata, timestamp: event.timestamp },
		};

		switch (event.type) {
			case ATPEventType.THINKING: {
				const data = event.data as { content: string; step?: string };
				onEvent({
					...baseEvent,
					event: 'on_llm_stream',
					name: 'atp_thinking',
					data: {
						chunk: data.content,
						step: data.step,
					},
				});
				break;
			}

			case ATPEventType.TOOL_START: {
				const data = event.data as { toolName: string; apiGroup: string; input: unknown };
				onEvent({
					...baseEvent,
					event: 'on_tool_start',
					name: `${data.apiGroup}.${data.toolName}`,
					data: {
						input: data.input,
					},
					metadata: {
						...baseEvent.metadata,
						apiGroup: data.apiGroup,
						toolName: data.toolName,
					},
				});
				break;
			}

			case ATPEventType.TOOL_END: {
				const data = event.data as {
					toolName: string;
					apiGroup: string;
					output: unknown;
					duration: number;
					success: boolean;
					error?: string;
				};
				onEvent({
					...baseEvent,
					event: 'on_tool_end',
					name: `${data.apiGroup}.${data.toolName}`,
					data: {
						output: data.output,
						error: data.error,
					},
					metadata: {
						...baseEvent.metadata,
						apiGroup: data.apiGroup,
						toolName: data.toolName,
						duration: data.duration,
						success: data.success,
					},
				});
				break;
			}

			case ATPEventType.TEXT: {
				const data = event.data as { text: string };
				onEvent({
					...baseEvent,
					event: 'on_chain_stream',
					name: 'atp_output',
					data: {
						chunk: data.text,
					},
				});
				break;
			}

			case ATPEventType.TEXT_END:
				onEvent({
					...baseEvent,
					event: 'on_chain_end',
					name: 'atp_output',
					data: {},
				});
				break;

			case ATPEventType.SOURCE: {
				const data = event.data as {
					url: string;
					title: string;
					summary?: string;
					createdAt?: string;
				};
				onEvent({
					...baseEvent,
					event: 'on_custom_event',
					name: 'atp_source',
					data: {
						url: data.url,
						title: data.title,
						summary: data.summary,
						createdAt: data.createdAt,
					},
				});
				break;
			}

			case ATPEventType.PROGRESS: {
				const data = event.data as { message: string; fraction: number };
				onEvent({
					...baseEvent,
					event: 'on_custom_event',
					name: 'atp_progress',
					data: {
						message: data.message,
						fraction: data.fraction,
						percentage: Math.round(data.fraction * 100),
					},
				});
				break;
			}

			case ATPEventType.ERROR: {
				const data = event.data as { message: string; code?: string };
				onEvent({
					...baseEvent,
					event: 'on_chain_error',
					name: 'atp_error',
					data: {
						error: data.message,
						code: data.code,
					},
				});
				break;
			}

			default:
				// Forward unknown events as custom events
				onEvent({
					...baseEvent,
					event: 'on_custom_event',
					name: `atp_${event.type}`,
					data: event.data,
				});
				break;
		}
	};
}

/**
 * Creates an event handler compatible with LangChain's CallbackManager.
 * Useful for integrating with existing LangChain callback infrastructure.
 *
 * @param callbackManager - LangChain CallbackManager or similar interface
 * @returns An event handler function to pass to ATP's executeStream
 */
export function createCallbackManagerHandler(callbackManager: {
	handleCustomEvent?: (
		eventName: string,
		data: unknown,
		runId?: string,
		tags?: string[],
		metadata?: Record<string, unknown>
	) => Promise<void> | void;
	handleToolStart?: (
		tool: { name: string },
		input: string,
		runId?: string,
		parentRunId?: string,
		tags?: string[],
		metadata?: Record<string, unknown>
	) => Promise<void> | void;
	handleToolEnd?: (
		output: string,
		runId?: string,
		parentRunId?: string,
		tags?: string[]
	) => Promise<void> | void;
	handleLLMNewToken?: (
		token: string,
		idx?: { prompt: number; completion: number },
		runId?: string
	) => Promise<void> | void;
}): (event: ATPEvent) => void {
	return (event: ATPEvent) => {
		switch (event.type) {
			case ATPEventType.THINKING: {
				const data = event.data as { content: string };
				callbackManager.handleLLMNewToken?.(data.content, undefined, event.runId);
				break;
			}

			case ATPEventType.TOOL_START: {
				const data = event.data as { toolName: string; apiGroup: string; input: unknown };
				callbackManager.handleToolStart?.(
					{ name: `${data.apiGroup}.${data.toolName}` },
					JSON.stringify(data.input),
					event.runId,
					undefined,
					['atp'],
					{ apiGroup: data.apiGroup }
				);
				break;
			}

			case ATPEventType.TOOL_END: {
				const data = event.data as { output: unknown };
				callbackManager.handleToolEnd?.(JSON.stringify(data.output), event.runId, undefined, [
					'atp',
				]);
				break;
			}

			case ATPEventType.TEXT: {
				const data = event.data as { text: string };
				callbackManager.handleLLMNewToken?.(data.text, undefined, event.runId);
				break;
			}

			default:
				callbackManager.handleCustomEvent?.(`atp_${event.type}`, event.data, event.runId, ['atp'], {
					timestamp: event.timestamp,
				});
				break;
		}
	};
}
