/**
 * ATP Event Streaming Types
 *
 * Generic event types for streaming execution events to clients.
 * Framework-agnostic design allows adapters for Vercel AI SDK, LangChain, etc.
 */

export enum ATPEventType {
	THINKING = 'thinking',
	TOOL_START = 'tool_start',
	TOOL_END = 'tool_end',
	TEXT = 'text',
	TEXT_END = 'text_end',
	SOURCE = 'source',
	PROGRESS = 'progress',
	ERROR = 'error',
	CUSTOM = 'custom',
}

export interface ATPEvent<T = unknown> {
	type: ATPEventType | string;
	data: T;
	timestamp: number;
	runId?: string;
}

export interface ATPThinkingEvent extends ATPEvent<{ content: string; step?: string }> {
	type: ATPEventType.THINKING;
}

export interface ATPToolStartEvent
	extends ATPEvent<{
		toolName: string;
		apiGroup: string;
		input: unknown;
	}> {
	type: ATPEventType.TOOL_START;
}

export interface ATPToolEndEvent
	extends ATPEvent<{
		toolName: string;
		apiGroup: string;
		output: unknown;
		duration: number;
		success: boolean;
		error?: string;
	}> {
	type: ATPEventType.TOOL_END;
}

export interface ATPTextEvent extends ATPEvent<{ text: string }> {
	type: ATPEventType.TEXT;
}

export interface ATPTextEndEvent extends ATPEvent<Record<string, never>> {
	type: ATPEventType.TEXT_END;
}

export interface ATPSourceEvent
	extends ATPEvent<{
		url: string;
		title: string;
		summary?: string;
		createdAt?: string;
	}> {
	type: ATPEventType.SOURCE;
}

export interface ATPProgressEvent extends ATPEvent<{ message: string; fraction: number }> {
	type: ATPEventType.PROGRESS;
}

export interface ATPErrorEvent extends ATPEvent<{ message: string; code?: string }> {
	type: ATPEventType.ERROR;
}

export interface ATPCustomEvent extends ATPEvent<unknown> {
	type: ATPEventType.CUSTOM;
	customType: string;
}

export type ATPStreamEvent =
	| ATPThinkingEvent
	| ATPToolStartEvent
	| ATPToolEndEvent
	| ATPTextEvent
	| ATPTextEndEvent
	| ATPSourceEvent
	| ATPProgressEvent
	| ATPErrorEvent
	| ATPCustomEvent;

export type ATPEventHandler = (event: ATPEvent) => void;

export type EventEmitter = (
	eventOrType: ATPEvent | ATPEventType | string,
	data?: unknown,
	runId?: string
) => void;

export function createEvent<T>(type: ATPEventType | string, data: T, runId?: string): ATPEvent<T> {
	return {
		type,
		data,
		timestamp: Date.now(),
		runId,
	};
}

export function createThinkingEvent(
	content: string,
	step?: string,
	runId?: string
): ATPThinkingEvent {
	return {
		type: ATPEventType.THINKING,
		data: { content, step },
		timestamp: Date.now(),
		runId,
	};
}

export function createToolStartEvent(
	toolName: string,
	apiGroup: string,
	input: unknown,
	runId?: string
): ATPToolStartEvent {
	return {
		type: ATPEventType.TOOL_START,
		data: { toolName, apiGroup, input },
		timestamp: Date.now(),
		runId,
	};
}

export function createToolEndEvent(
	toolName: string,
	apiGroup: string,
	output: unknown,
	duration: number,
	success: boolean,
	error?: string,
	runId?: string
): ATPToolEndEvent {
	return {
		type: ATPEventType.TOOL_END,
		data: { toolName, apiGroup, output, duration, success, error },
		timestamp: Date.now(),
		runId,
	};
}

export function createTextEvent(text: string, runId?: string): ATPTextEvent {
	return {
		type: ATPEventType.TEXT,
		data: { text },
		timestamp: Date.now(),
		runId,
	};
}

export function createTextEndEvent(runId?: string): ATPTextEndEvent {
	return {
		type: ATPEventType.TEXT_END,
		data: {},
		timestamp: Date.now(),
		runId,
	};
}

export function createSourceEvent(
	url: string,
	title: string,
	summary?: string,
	createdAt?: string,
	runId?: string
): ATPSourceEvent {
	return {
		type: ATPEventType.SOURCE,
		data: { url, title, summary, createdAt },
		timestamp: Date.now(),
		runId,
	};
}

export function createProgressEvent(
	message: string,
	fraction: number,
	runId?: string
): ATPProgressEvent {
	return {
		type: ATPEventType.PROGRESS,
		data: { message, fraction },
		timestamp: Date.now(),
		runId,
	};
}
