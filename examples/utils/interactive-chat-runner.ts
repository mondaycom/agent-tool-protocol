/**
 * Generic interactive chat runner for ATP code execution agents
 */

import * as readline from 'readline';
import { ChatFormatter } from './chat-formatter';
import { CodeExecutionHandler } from './code-execution-handler';
import { HumanMessage } from '@langchain/core/messages';

export interface InteractiveAgentConfig {
	agent: unknown;
	threadId: string;
	formatter: ChatFormatter;
	handler: CodeExecutionHandler;
	recursionLimit?: number;
}

export class InteractiveChatRunner {
	private rl: readline.Interface;
	private formatter: ChatFormatter;
	private handler: CodeExecutionHandler;

	constructor(formatter: ChatFormatter, handler: CodeExecutionHandler) {
		this.formatter = formatter;
		this.handler = handler;
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
	}

	private askQuestion(prompt: string): Promise<string> {
		return new Promise((resolve) => {
			this.rl.question(prompt, resolve);
		});
	}

	async run(config: InteractiveAgentConfig) {
		const { agent, threadId, recursionLimit } = config;
		const agentConfig = { 
			configurable: { thread_id: threadId },
			recursionLimit: recursionLimit || 25,
		};

		while (true) {
			const userInput = await this.askQuestion(this.formatter.promptUser('You: '));

			if (!userInput.trim()) continue;
			if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
				this.formatter.showGoodbye();
				break;
			}

			this.formatter.showAgentWritingCode();
			this.handler.resetState();

			try {
				const agentStream = (agent as any).stream(
					{ messages: [new HumanMessage(userInput)] },
					agentConfig
				);

				for await (const event of await agentStream) {
					this.handler.handleAgentEvent(event);
					this.handler.handleToolsEvent(event);
				}

				this.handler.showFinalResponse();
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				this.formatter.showError(errorMessage);
				
				if (errorMessage.includes('Recursion limit')) {
					this.formatter.showRecursionLimitHint();
				}
			}
		}

		this.close();
	}

	close() {
		this.rl.close();
	}
}

