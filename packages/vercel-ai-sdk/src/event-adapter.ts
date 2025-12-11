/**
 * Vercel AI SDK Event Adapter
 *
 * Converts ATP streaming events to Vercel AI SDK UIMessageStream format.
 * Use this to forward ATP events to the chat UI.
 */

import { type ATPEvent, ATPEventType } from '@mondaydotcomorg/atp-protocol';

/**
 * UIMessageStreamWriter interface (subset of Vercel AI SDK's UIMessageStreamWriter)
 */
export interface UIMessageStreamWriter {
	write(event: UIStreamEvent): void;
}

/**
 * UI Stream event types that Vercel AI SDK understands
 */
export type UIStreamEvent =
	| { type: 'text-start'; id: string }
	| { type: 'text-delta'; id: string; delta: string }
	| { type: 'text-end'; id: string }
	| { type: 'reasoning-start'; id: string }
	| { type: 'reasoning-delta'; id: string; delta: string }
	| { type: 'reasoning-end'; id: string }
	| { type: 'source-url'; url: string; title: string; sourceId: string; providerMetadata?: unknown }
	| { type: string; data?: unknown; transient?: boolean };

/**
 * Options for creating the Vercel event handler
 */
export interface CreateVercelEventHandlerOptions {
	/**
	 * Prefix for generated text run IDs
	 * @default 'atp-text'
	 */
	textRunIdPrefix?: string;
}

/**
 * Creates an event handler that forwards ATP events to a Vercel AI SDK UIMessageStreamWriter.
 *
 * Handles nested tool calls properly:
 * - First tool_start triggers agentStepStart
 * - Inner tool_start/end emit agentStep updates (not start/end)
 * - Last tool_end triggers agentStepEnd
 *
 * @param dataStream - The Vercel AI SDK UIMessageStreamWriter to write events to
 * @param options - Optional configuration
 * @returns An event handler function to pass to ATP's executeStream
 *
 * @example
 * ```typescript
 * const handler = createVercelEventHandler(dataStream);
 *
 * const result = await client.executeStream(code, {}, handler);
 * ```
 */
export function createVercelEventHandler(
	dataStream: UIMessageStreamWriter,
	options: CreateVercelEventHandlerOptions = {}
): (event: ATPEvent) => void {
	const { textRunIdPrefix = 'atp-text' } = options;

	let currentTextRunId: string | undefined;
	let textRunCounter = 0;

	// Track reasoning state for proper start/delta/end events
	let reasoningRunId: string | undefined;
	let reasoningCounter = 0;

	// Track nested tool calls with a stack
	const toolStack: Array<{ toolName: string; apiGroup: string }> = [];

	return (event: ATPEvent) => {
		switch (event.type) {
			case ATPEventType.THINKING: {
				const data = event.data as { content: string; step?: string };

				// Start new reasoning block if needed
				if (!reasoningRunId) {
					reasoningRunId = `atp-reasoning-${++reasoningCounter}`;
					dataStream.write({
						type: 'reasoning-start',
						id: reasoningRunId,
					} as UIStreamEvent);
				}

				// Write reasoning delta
				dataStream.write({
					type: 'reasoning-delta',
					id: reasoningRunId,
					delta: data.content + '\n',
				} as UIStreamEvent);
				break;
			}

			case ATPEventType.TOOL_START: {
				const data = event.data as { toolName: string; apiGroup: string; input: unknown };
				const isFirstTool = toolStack.length === 0;

				toolStack.push({ toolName: data.toolName, apiGroup: data.apiGroup });

				if (isFirstTool) {
					// First tool - emit agentStepStart
					dataStream.write({
						type: 'data-agentStepStart',
						data: `Executing ${data.apiGroup}.${data.toolName}...`,
						transient: true,
					});
				} else {
					// Nested tool - emit progress update instead
					dataStream.write({
						type: 'data-agentStep',
						data: `→ ${data.apiGroup}.${data.toolName}`,
						transient: true,
					});
				}
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

				toolStack.pop();
				const isLastTool = toolStack.length === 0;

				// Close reasoning block when outer tool ends
				if (isLastTool && reasoningRunId) {
					dataStream.write({
						type: 'reasoning-end',
						id: reasoningRunId,
					} as UIStreamEvent);
					reasoningRunId = undefined;
				}

				if (isLastTool) {
					// Last tool - emit agentStepEnd
					dataStream.write({
						type: 'data-agentStepEnd',
						data: data.success
							? `Completed ${data.apiGroup}.${data.toolName} (${data.duration}ms)`
							: `Failed ${data.apiGroup}.${data.toolName}: ${data.error}`,
						transient: true,
					});
				} else {
					// Nested tool finished - emit progress update
					dataStream.write({
						type: 'data-agentStep',
						data: data.success
							? `✓ ${data.apiGroup}.${data.toolName} (${data.duration}ms)`
							: `✗ ${data.apiGroup}.${data.toolName}: ${data.error}`,
						transient: true,
					});
				}
				break;
			}

			case ATPEventType.TEXT: {
				const data = event.data as { text: string };
				const runId = event.runId || `${textRunIdPrefix}-${++textRunCounter}`;

				// If we're starting a new text run, close the previous one
				if (currentTextRunId && currentTextRunId !== runId) {
					dataStream.write({ type: 'text-end', id: currentTextRunId });
					currentTextRunId = undefined;
				}

				// Start new text run if needed
				if (!currentTextRunId || currentTextRunId !== runId) {
					currentTextRunId = runId;
					dataStream.write({ type: 'text-start', id: currentTextRunId });
				}

				// Write text delta
				dataStream.write({
					type: 'text-delta',
					id: currentTextRunId,
					delta: data.text,
				});
				break;
			}

			case ATPEventType.TEXT_END:
				if (currentTextRunId) {
					dataStream.write({ type: 'text-end', id: currentTextRunId });
					currentTextRunId = undefined;
				}
				break;

			case ATPEventType.SOURCE: {
				const data = event.data as {
					url: string;
					title: string;
					summary?: string;
					createdAt?: string;
				};
				dataStream.write({
					type: 'source-url',
					url: data.url,
					title: data.title,
					sourceId: `${data.title}-${event.timestamp}`,
					providerMetadata: {
						aiChat: {
							summary: data.summary,
							createdAt: data.createdAt,
						},
					},
				});
				break;
			}

			case ATPEventType.PROGRESS: {
				const data = event.data as { message: string; fraction: number };
				dataStream.write({
					type: 'data-agentStep',
					data: `${data.message} (${Math.round(data.fraction * 100)}%)`,
					transient: true,
				});
				break;
			}

			case ATPEventType.ERROR: {
				const data = event.data as { message: string; code?: string };
				dataStream.write({
					type: 'data-error',
					data: data.message,
				});
				break;
			}

			default:
				// Forward unknown events as custom data events
				dataStream.write({
					type: `data-${event.type}`,
					data: event.data,
					transient: true,
				});
				break;
		}
	};
}

/**
 * Creates an event handler that collects events into an array.
 * Useful for testing or post-processing events.
 *
 * @returns Object with handler function and collected events array
 */
export function createEventCollector(): {
	handler: (event: ATPEvent) => void;
	events: ATPEvent[];
	clear: () => void;
} {
	const events: ATPEvent[] = [];

	return {
		handler: (event: ATPEvent) => {
			events.push(event);
		},
		events,
		clear: () => {
			events.length = 0;
		},
	};
}

