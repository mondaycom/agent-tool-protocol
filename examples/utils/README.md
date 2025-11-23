# ATP Chat Utilities

Generic utilities for building interactive chat agents with ATP code execution capabilities.

## Features

- **ChatFormatter**: Console output formatting with colors and syntax highlighting
- **CodeExecutionHandler**: Handles streaming events and displays code execution
- **InteractiveChatRunner**: Manages the interactive chat loop

## Usage

### Basic Example

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import {
  ChatFormatter,
  CodeExecutionHandler,
  InteractiveChatRunner,
} from '../utils';

async function main() {
  const formatter = new ChatFormatter();
  formatter.suppressZodWarnings();

  formatter.showHeader({
    title: '🤖 My ATP Agent',
    subtitle: 'An agent that can execute code',
  });

  const serverUrl = process.env.ATP_SERVER_URL || 'http://localhost:3334';
  formatter.showConnecting(serverUrl);

  const llm = new ChatOpenAI({
    modelName: 'gpt-4',
    temperature: 0,
  });

  const { client: atpClient, tools } = await createATPTools({
    serverUrl,
    headers: { Authorization: 'Bearer your-token' },
    llm,
  });

  formatter.showConnected(tools.length);

  const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');

  // Build your system prompt inline with domain-specific instructions
  const systemPrompt = `You are a helpful assistant with access to the ATP runtime.

**Available APIs:**
${atpClient.getTypeDefinitions()}

**CRITICAL - Code Return Values:**
- ⚠️ ALWAYS parse MCP responses with JSON.parse(result[0].text) before returning
- ⚠️ Return CLEAN, PARSED objects - NOT raw MCP content arrays

**When responding:**
- Show clear, formatted results
- Be concise and helpful`;

  const agent = createReactAgent({
    llm,
    tools: [executeCodeTool!],
    checkpointSaver: new MemorySaver(),
    messageModifier: systemPrompt,
  });

  const handler = new CodeExecutionHandler(formatter);
  const chatRunner = new InteractiveChatRunner(formatter, handler);

  await chatRunner.run({
    agent,
    threadId: 'my-session',
    formatter,
    handler,
  });
}

main();
```

## Components

### ChatFormatter

Handles all console formatting and display.

```typescript
const formatter = new ChatFormatter();

// Suppress Zod warnings
formatter.suppressZodWarnings();

// Show header
formatter.showHeader({
  title: '🤖 Agent Name',
  subtitle: 'Optional description',
});

// Show connection status
formatter.showConnecting('http://localhost:3334');
formatter.showConnected(10); // 10 tools

// Show messages
formatter.showAgentWritingCode();
formatter.showThinking(1); // Step 1
formatter.showCodeExecution('const x = 1;');
formatter.showExecutionResult({ success: true });
formatter.showExecutionError('Error message');
formatter.showAgentResponse('Agent response text');
formatter.showGoodbye();
```

### CodeExecutionHandler

Processes streaming events from the agent and displays code execution.

```typescript
const handler = new CodeExecutionHandler(formatter);

// Process events
for await (const event of agentStream) {
  handler.handleAgentEvent(event);
  handler.handleToolsEvent(event);
}

// Show final response
handler.showFinalResponse();

// Reset for next interaction
handler.resetState();
```

### InteractiveChatRunner

Manages the interactive chat loop with readline.

```typescript
const runner = new InteractiveChatRunner(formatter, handler);

await runner.run({
  agent,
  threadId: 'session-id',
  formatter,
  handler,
});
```

## Colors

The utilities use ANSI color codes for terminal formatting:

```typescript
import { colors } from '../utils';

console.log(`${colors.green}Success!${colors.reset}`);
console.log(`${colors.red}Error!${colors.reset}`);
console.log(`${colors.yellow}Warning${colors.reset}`);
console.log(`${colors.blue}Info${colors.reset}`);
console.log(`${colors.magenta}Highlight${colors.reset}`);
console.log(`${colors.cyan}Accent${colors.reset}`);
console.log(`${colors.dim}Subtle${colors.reset}`);
console.log(`${colors.bright}Bold${colors.reset}`);
```

## See Also

- [Google Calendar Agent Example](../google-calendar-agent) - Full example using these utilities

