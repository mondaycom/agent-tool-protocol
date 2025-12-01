# Simple Code Agent Example

A minimal example demonstrating how to use ATP chat utilities to build an interactive code execution agent.

## Features

- Interactive console interface with syntax highlighting
- Code execution with ATP runtime
- Conversation memory
- Clean, reusable utilities

## Setup

1. Make sure you have an ATP server running:

   ```bash
   cd path/to/your/atp-server
   npm start
   ```

2. Create a `.env` file:

   ```bash
   OPENAI_API_KEY=your-openai-api-key
   ATP_SERVER_URL=http://localhost:3334
   ATP_AUTH_TOKEN=demo-token
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

## Usage

```bash
npm start
```

## Code Overview

This example shows the minimal code needed to create an interactive agent:

```typescript
// 1. Create formatter and handler
const formatter = new ChatFormatter();
const handler = new CodeExecutionHandler(formatter);

// 2. Connect to ATP server
const { client, tools } = await createATPTools({ serverUrl, ... });

// 3. Build system prompt inline with your domain-specific instructions
const systemPrompt = `You are a helpful assistant with access to the ATP runtime.

**Available APIs:**
${client.getTypeDefinitions()}

**CRITICAL - Code Return Values:**
- ⚠️ ALWAYS parse MCP responses with JSON.parse(result[0].text) before returning
- ⚠️ Return CLEAN, PARSED objects - NOT raw MCP content arrays

**When responding:**
- Show clear, formatted results
- Be concise and helpful`;

// 4. Create agent
const agent = createReactAgent({
  llm,
  tools: [executeCodeTool],
  messageModifier: systemPrompt,
});

// 5. Run interactive chat
const chatRunner = new InteractiveChatRunner(formatter, handler);
await chatRunner.run({ agent, threadId: 'session-id', formatter, handler });
```

## See Also

- [ATP Chat Utilities](../utils) - Documentation for the utilities
- [Google Calendar Agent](../google-calendar-agent) - More complex example
