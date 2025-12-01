/**
 * Generic chat formatting utilities for ATP agents
 * Provides console coloring, code display, and error formatting
 */

export const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	dim: '\x1b[2m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
};

export interface ChatFormatterOptions {
	title?: string;
	subtitle?: string;
	serverUrl?: string;
	toolCount?: number;
}

export class ChatFormatter {
	suppressZodWarnings() {
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			const msg = args[0]?.toString() || '';
			if (msg.includes('Zod field') || msg.includes('.optional()') || msg.includes('.nullable()')) {
				return;
			}
			originalWarn.apply(console, args);
		};
	}

	showHeader(options: ChatFormatterOptions) {
		console.clear();
		console.log(`${colors.bright}${colors.blue}`);
		console.log('╔════════════════════════════════════════════════════════════╗');
		const title = options.title || 'ATP Agent';
		const paddedTitle = `║  ${title.padEnd(56)} ║`;
		console.log(paddedTitle);
		console.log('╚════════════════════════════════════════════════════════════╝');
		console.log(colors.reset);

		if (options.subtitle) {
			console.log(`${colors.dim}${options.subtitle}${colors.reset}`);
		}
		console.log(`${colors.dim}Type 'exit' to quit.${colors.reset}\n`);
	}

	showConnecting(serverUrl: string) {
		console.log(`${colors.yellow}📡 Connecting to ATP server...${colors.reset}`);
		console.log(`${colors.dim}   Server: ${serverUrl}${colors.reset}`);
	}

	showConnected(toolCount: number) {
		console.log(`${colors.green}✅ Connected! ${toolCount} tools available${colors.reset}\n`);
	}

	showError(message: string) {
		console.error(`${colors.red}❌ Error: ${message}${colors.reset}`);
	}

	showGoodbye() {
		console.log(`\n${colors.yellow}👋 Goodbye!${colors.reset}\n`);
	}

	showThinking(stepNumber?: number) {
		const step = stepNumber ? ` Step ${stepNumber}` : '';
		console.log(`${colors.yellow}💭 Agent${step}:${colors.reset}`);
	}

	showAgentWritingCode() {
		console.log(`\n${colors.magenta}🤖 Agent writing code...${colors.reset}\n`);
	}

	showToolCall(toolName: string, args: Record<string, any>) {
		console.log(`\n${colors.cyan}🔍 Calling tool:${colors.reset}`);
		console.log(`${colors.dim}   Tool: ${toolName}${colors.reset}`);
		console.log(`${colors.dim}   Path: ${args.path || '/'}${colors.reset}\n`);
	}

	showExploreResult(result: any) {
		console.log(`${colors.green}✅ Explore Result:${colors.reset}`);

		if (result.type === 'directory') {
			console.log(`${colors.dim}   Path: ${result.path}${colors.reset}`);
			if (result.items && result.items.length > 0) {
				console.log(`${colors.dim}   Items (${result.items.length}):${colors.reset}`);
				result.items.forEach((item: any) => {
					const icon = item.type === 'directory' ? '📁' : '⚡';
					console.log(`${colors.dim}     ${icon} ${item.name}${colors.reset}`);
				});
			}
		} else if (result.type === 'function') {
			console.log(`${colors.dim}   Name: ${result.name}${colors.reset}`);
			console.log(`${colors.dim}   Description: ${result.description || 'N/A'}${colors.reset}`);

			// Show parameters with descriptions if available
			if (result.inputSchema && result.inputSchema.properties) {
				console.log(`${colors.dim}   Parameters:${colors.reset}`);
				const required = result.inputSchema.required || [];
				for (const [key, value] of Object.entries(result.inputSchema.properties)) {
					const prop = value as any;
					const isRequired = required.includes(key);
					const optional = isRequired ? '' : ' (optional)';
					const description = prop.description ? ` - ${prop.description}` : '';
					const type = prop.type || (prop.enum ? 'enum' : 'any');
					console.log(
						`${colors.dim}     • ${key}${optional} (${type})${description}${colors.reset}`
					);
				}
			}

			if (result.definition) {
				console.log(`${colors.dim}   Signature: ${result.definition}${colors.reset}`);
			}
		} else {
			// Legacy format
			if (result.folders && result.folders.length > 0) {
				console.log(
					`${colors.dim}   Folders: ${result.folders.map((f: any) => f.name).join(', ')}${colors.reset}`
				);
			}

			if (result.functions && result.functions.length > 0) {
				console.log(
					`${colors.dim}   Functions: ${result.functions.length} available${colors.reset}`
				);
				const functionNames = result.functions
					.slice(0, 5)
					.map((f: any) => f.name)
					.join(', ');
				console.log(
					`${colors.dim}   Examples: ${functionNames}${result.functions.length > 5 ? '...' : ''}${colors.reset}`
				);
			}
		}

		console.log();
	}

	showCodeExecution(code: string) {
		console.log(
			`\n${colors.bright}${colors.cyan}📝 TypeScript Code Being Executed:${colors.reset}`
		);
		console.log(`${colors.cyan}${'═'.repeat(80)}${colors.reset}`);

		const lines = code.split('\n');
		const maxLineNumWidth = String(lines.length).length;

		lines.forEach((line: string, i: number) => {
			const lineNum = String(i + 1).padStart(maxLineNumWidth, ' ');
			const coloredLine = this.syntaxHighlight(line);
			console.log(`${colors.dim}${lineNum} │${colors.reset} ${coloredLine}`);
		});

		console.log(`${colors.cyan}${'═'.repeat(80)}${colors.reset}\n`);
	}

	private syntaxHighlight(line: string): string {
		let coloredLine = line;

		// Keywords
		coloredLine = coloredLine.replace(
			/\b(const|let|var|await|async|return|if|else|for|while|function|class|new|import|export|from|try|catch|throw)\b/g,
			`${colors.magenta}$1${colors.reset}`
		);

		// Strings
		coloredLine = coloredLine.replace(/(["'`][^"'`]*["'`])/g, `${colors.green}$1${colors.reset}`);

		// Comments
		coloredLine = coloredLine.replace(/(\/\/.*$)/g, `${colors.dim}$1${colors.reset}`);

		// API calls
		coloredLine = coloredLine.replace(/\bapi\b/g, `${colors.yellow}api${colors.reset}`);

		return coloredLine;
	}

	showExecutionResult(result: unknown) {
		console.log(`${colors.green}✅ Code Execution Result:${colors.reset}`);
		const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
		const maxLength = 800;
		console.log(
			output.substring(0, maxLength) + (output.length > maxLength ? '...(truncated)' : '')
		);
		console.log();
	}

	showExecutionError(error: unknown) {
		console.log(`${colors.red}❌ Code Execution Error:${colors.reset}`);

		if (typeof error === 'string') {
			console.log(`${colors.red}${error}${colors.reset}`);
		} else if (typeof error === 'object' && error !== null) {
			const errorObj = error as Record<string, unknown>;
			const errorMsg = errorObj.message || errorObj.error || JSON.stringify(error, null, 2);
			console.log(`${colors.red}${errorMsg}${colors.reset}`);

			if (errorObj.details) {
				console.log(
					`${colors.dim}Details: ${JSON.stringify(errorObj.details, null, 2)}${colors.reset}`
				);
			}
			if (errorObj.stack) {
				console.log(`${colors.dim}Stack: ${errorObj.stack}${colors.reset}`);
			}
		}
		console.log();
	}

	showAgentResponse(response: string) {
		console.log(`${colors.bright}${colors.blue}Agent: ${colors.reset}${response}\n`);
	}

	showExecutionSummary(count: number) {
		console.log(
			`${colors.dim}💡 Executed ${count} code block(s) with multiple tool calls${colors.reset}\n`
		);
	}

	showRecursionLimitHint() {
		console.log(
			`${colors.yellow}💡 The agent got stuck. Try rephrasing your question.${colors.reset}\n`
		);
	}

	promptUser(prompt: string): string {
		return `${colors.bright}${colors.green}${prompt}${colors.reset}`;
	}
}
