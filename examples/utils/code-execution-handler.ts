/**
 * Generic code execution event handler for ATP agents
 * Handles streaming events and displays code execution with formatting
 */

import { ChatFormatter } from './chat-formatter';

export interface ToolCall {
	name: string;
	args?: Record<string, unknown>;
}

export interface AgentMessage {
	content?: string | unknown;
	tool_calls?: ToolCall[];
}

export interface AgentEvent {
	agent?: {
		messages?: AgentMessage[];
	};
	tools?: {
		messages?: Array<{ content: string | unknown }>;
	};
}

export interface CodeExecutionState {
	stepNumber: number;
	codeExecutions: string[];
	finalResponse: string;
}

export class CodeExecutionHandler {
	private formatter: ChatFormatter;
	private state: CodeExecutionState;

	constructor(formatter: ChatFormatter) {
		this.formatter = formatter;
		this.state = {
			stepNumber: 0,
			codeExecutions: [],
			finalResponse: '',
		};
	}

	resetState() {
		this.state = {
			stepNumber: 0,
			codeExecutions: [],
			finalResponse: '',
		};
	}

	getState(): CodeExecutionState {
		return this.state;
	}

	handleAgentEvent(event: AgentEvent) {
		if (event.agent) {
			this.state.stepNumber++;
			const messages = event.agent.messages || [];
			if (messages.length > 0) {
				const lastMessage = messages[messages.length - 1];

				if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
					this.formatter.showThinking(this.state.stepNumber);
					for (const toolCall of lastMessage.tool_calls) {
						this.handleToolCall(toolCall);
					}
				}

				if (lastMessage?.content) {
					this.state.finalResponse =
						typeof lastMessage.content === 'string'
							? lastMessage.content
							: JSON.stringify(lastMessage.content);
				}
			}
		}
	}

	private handleToolCall(toolCall: ToolCall) {
		if (toolCall.name === 'atp_execute_code' || toolCall.name.includes('execute_code')) {
			const code = this.extractCode(toolCall.args);

			if (code && code.length > 0) {
				this.formatter.showCodeExecution(code);
				this.state.codeExecutions.push(code);
			} else {
				console.log(
					`${this.formatter.constructor.name}   → Executing code (checking args structure...)`
				);
			}
		} else if (toolCall.name === 'atp_explore_api' || toolCall.name.includes('explore_api')) {
			const path = toolCall.args?.path || '/';
			this.formatter.showToolCall('explore_api', { path: path as string });
		} else {
			console.log(`   → ${toolCall.name}`);
		}
	}

	private extractCode(args?: Record<string, unknown>): string {
		if (!args) return '';

		let code = (args.code as string) || (args.sourceCode as string) || (args.input as string) || '';

		if (typeof code === 'string') {
			code = code.replace(/\\n/g, '\n').replace(/\\t/g, '  ');
		}

		return code;
	}

	handleToolsEvent(event: AgentEvent) {
		if (!event.tools) return;

		const toolMessages = event.tools.messages || [];
		for (const toolMsg of toolMessages) {
			if (toolMsg.content) {
				this.handleToolResult(toolMsg.content);
			}
		}
	}

	private handleToolResult(content: string | unknown) {
		const contentStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

		try {
			const result = JSON.parse(contentStr);

			// Check if this is an explore_api tool result
			if (result.success && (result.type === 'directory' || result.type === 'function')) {
				this.formatter.showExploreResult(result);
				return;
			}

			// Check for legacy explore format
			if (result.folders || result.functions) {
				this.formatter.showExploreResult(result);
				return;
			}

			if (result.error || result.status === 'failed') {
				this.formatter.showExecutionError(result.error || result.message || result);
			} else if (result.result || result.output) {
				const output = result.result || result.output;
				this.formatter.showExecutionResult(output);
			}
		} catch {
			if (
				contentStr.toLowerCase().includes('error') ||
				contentStr.toLowerCase().includes('failed')
			) {
				this.formatter.showExecutionError(contentStr);
			} else {
				this.formatter.showExecutionResult(contentStr);
			}
		}
	}

	showFinalResponse() {
		if (this.state.finalResponse) {
			this.formatter.showAgentResponse(this.state.finalResponse);
		}

		if (this.state.codeExecutions.length > 0) {
			this.formatter.showExecutionSummary(this.state.codeExecutions.length);
		}
	}
}
