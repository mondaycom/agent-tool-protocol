# ATP Streaming Events Example

This example demonstrates ATP's generic event streaming system with both **LangChain** and **Vercel AI SDK** integrations, using both **HTTP-based** and **in-process** server modes.

## Features

- **Generic Event System**: Tools emit structured events (`thinking`, `tool_start`, `tool_end`, `text`, `source`, `progress`)
- **Framework Adapters**: Events are automatically adapted to Vercel AI SDK's `UIMessageStream` or LangChain's callback format
- **Two Server Modes**:
  - **HTTP Mode**: Client connects to ATP server over HTTP with SSE streaming
  - **In-Process Mode**: Client communicates directly with server (no network needed)

## Prerequisites

1. **OpenAI API Key**: Set in environment or `.env` file
   ```bash
   export OPENAI_API_KEY=your-key-here
   # or create .env file
   echo "OPENAI_API_KEY=your-key-here" > .env
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

## Running the Examples

### Vercel AI SDK Examples

**In-Process Mode** (no server needed):
```bash
npm run vercel:inprocess
```

**HTTP Mode** (requires server):
```bash
# Terminal 1: Start the server
npm run server

# Terminal 2: Run the example
npm run vercel:http
```

### LangChain Examples

**In-Process Mode** (no server needed):
```bash
npm run langchain:inprocess
```

**HTTP Mode** (requires server):
```bash
# Terminal 1: Start the server
npm run server

# Terminal 2: Run the example
npm run langchain:http
```

## Event Types

| Event Type | Description | Example Data |
|------------|-------------|--------------|
| `thinking` | Reasoning/chain-of-thought | `{ content: "Analyzing...", step: "1" }` |
| `tool_start` | Tool execution begins | `{ toolName: "research", apiGroup: "custom", input: {...} }` |
| `tool_end` | Tool execution completes | `{ toolName: "research", duration: 150, success: true }` |
| `text` | Streamed text chunk | `{ text: "Here is the answer..." }` |
| `text_end` | End of text stream | `{}` |
| `source` | Citation/reference | `{ url: "...", title: "...", summary: "..." }` |
| `progress` | Progress update | `{ message: "Processing...", fraction: 0.5 }` |

## Server Tools

The example server provides these streaming-enabled tools:

1. **research**: Streams thinking, sources, progress, and text events
2. **analyze_data**: Streams step-by-step reasoning
3. **stream_story**: Streams text chunks in real-time
4. **simple_calc**: Basic calculation (no streaming, for comparison)

## Code Examples

### Vercel AI SDK - In-Process

```typescript
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ATPEventType } from '@mondaydotcomorg/atp-protocol';
import { server } from './server.js';

const client = new AgentToolProtocolClient({ server });
await client.init({ name: 'my-app', version: '1.0.0' });

// Handle streaming events
const result = await client.executeStream(code, undefined, (event) => {
  switch (event.type) {
    case ATPEventType.THINKING:
      console.log('Thinking:', event.data.content);
      break;
    case ATPEventType.TEXT:
      process.stdout.write(event.data.text);
      break;
    case ATPEventType.SOURCE:
      console.log('Source:', event.data.title);
      break;
  }
});
```

### LangChain - HTTP Mode

```typescript
import { createATPTools, createLangChainEventHandler } from '@mondaydotcomorg/atp-langchain';

const eventHandler = createLangChainEventHandler((event) => {
  console.log(event.event, event.data);
});

const { tools } = await createATPTools({
  serverUrl: 'http://localhost:3333',
  llm,
  eventHandler,
});
```

### Tool Handler with Events

```typescript
server.tool('my_tool', {
  description: 'A tool that emits streaming events',
  input: { query: 'string' },
  handler: async (input, context) => {
    // Emit thinking event
    context?.emit(ATPEventType.THINKING, { 
      content: 'Processing request...' 
    });

    // Do work...
    await someAsyncWork();

    // Emit progress
    context?.emit(ATPEventType.PROGRESS, {
      message: 'Halfway done',
      fraction: 0.5
    });

    // Stream text
    context?.emit(ATPEventType.TEXT, { text: 'Result: ' });
    context?.emit(ATPEventType.TEXT, { text: 'Hello World' });
    context?.emit(ATPEventType.TEXT_END, {});

    // Emit source citation
    context?.emit(ATPEventType.SOURCE, {
      url: 'https://example.com',
      title: 'Reference Document'
    });

    return { success: true };
  }
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Application                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────┐    ┌───────────────────┐                │
│  │  Vercel AI SDK    │    │    LangChain      │                │
│  │  createATPStream- │    │  createATPTools() │                │
│  │  ingTools()       │    │                   │                │
│  └─────────┬─────────┘    └─────────┬─────────┘                │
│            │                        │                           │
│            └──────────┬─────────────┘                           │
│                       │                                         │
│  ┌────────────────────▼────────────────────┐                   │
│  │         Event Adapters                   │                   │
│  │  createVercelEventHandler()              │                   │
│  │  createLangChainEventHandler()           │                   │
│  └────────────────────┬────────────────────┘                   │
│                       │                                         │
│  ┌────────────────────▼────────────────────┐                   │
│  │       ATP Client                         │                   │
│  │  client.executeStream(code, config,      │                   │
│  │    onEvent)                              │                   │
│  └────────────────────┬────────────────────┘                   │
│                       │                                         │
└───────────────────────┼─────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
┌───────────────────┐       ┌───────────────────┐
│   HTTP Mode       │       │  In-Process Mode  │
│   (SSE Stream)    │       │  (Direct Calls)   │
└─────────┬─────────┘       └─────────┬─────────┘
          │                           │
          └───────────┬───────────────┘
                      │
┌─────────────────────▼─────────────────────────────────────────┐
│                      ATP Server                                │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                 Tool Handlers                            │ │
│  │                                                          │ │
│  │  handler: async (input, context) => {                    │ │
│  │    context.emit(ATPEventType.THINKING, {...});           │ │
│  │    // ... work ...                                       │ │
│  │    context.emit(ATPEventType.TEXT, {...});               │ │
│  │    return result;                                        │ │
│  │  }                                                       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## HTTP vs In-Process Mode

| Aspect | HTTP Mode | In-Process Mode |
|--------|-----------|-----------------|
| Server | Separate process | Same process |
| Network | Required (localhost) | Not needed |
| Streaming | SSE over HTTP | Direct callbacks |
| Use Case | Production, microservices | Testing, embedded |
| Setup | Start server first | No setup needed |
| Latency | Slightly higher | Minimal |

## Troubleshooting

**"ECONNREFUSED" error in HTTP mode**:
- Make sure to start the server first: `npm run server`
- Check the server URL (default: `http://localhost:3333`)

**"OPENAI_API_KEY not set" error**:
- Set the environment variable or create a `.env` file

**Events not showing**:
- Ensure your tool handler uses `context?.emit()` to emit events
- Check that the event type is valid (use `ATPEventType` enum)

