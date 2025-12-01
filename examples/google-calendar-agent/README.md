# 📅 Google Calendar Agent Example

A real-world demonstration of LangChain agents interacting with Google Calendar, comparing **MCP** (Model Context Protocol) vs **ATP** (Agent Tool Protocol) approaches.

## 🎯 Project Structure

```
google-calendar-agent/
├── auth/               # Authentication setup (OAuth tokens)
│   ├── generate-token.sh
│   ├── env.example
│   └── README.md
├── mcp/                # MCP-based agent (direct connection)
│   ├── interactive-agent.ts
│   └── README.md
├── atp/                # ATP-based agent (code execution)
│   ├── code-execution-agent.ts
│   ├── mcp-server.ts
│   ├── start-code-agent.sh
│   └── README.md
├── package.json
├── README.md           # This file
└── SETUP.md           # Detailed setup guide
```

## 🆚 MCP vs ATP Comparison

### MCP Agent (`npm run chat:mcp`)

- **Direct Connection**: Agent → MCP Server
- **Individual Tool Calls**: One operation at a time
- **Simple Setup**: No intermediate server needed
- **Use Case**: Straightforward task automation

### ATP Agent (`npm run chat:atp`)

- **Code Execution**: Agent writes TypeScript code
- **Multi-Tool Operations**: Multiple calls in one execution
- **Shows Code**: See the generated code with syntax highlighting
- **Use Case**: Complex queries requiring data processing

See [MCP-vs-ATP-Comparison.md](./MCP-vs-ATP-Comparison.md) for detailed comparison.

## 🚀 Quick Start

### 1. Authentication Setup

First, set up Google OAuth credentials:

```bash
# Copy environment template
cp auth/env.example .env

# Edit .env and add:
# - OPENAI_API_KEY=your-openai-api-key
# - GOOGLE_OAUTH_CREDENTIALS=/path/to/gcp-oauth.keys.json

# Generate OAuth token (opens browser)
npm run auth
```

See [auth/README.md](./auth/README.md) and [SETUP.md](./SETUP.md) for detailed setup instructions.

### 2. Run MCP Agent (Recommended for First Time)

```bash
npm run chat:mcp
```

**Features:**

- Simple and straightforward
- Direct connection to Google Calendar
- Easy to debug
- No server management

See [mcp/README.md](./mcp/README.md) for details.

### 3. Run ATP Agent (Code Execution)

```bash
npm run chat:atp
```

**Features:**

- Multi-tool code execution
- Syntax-highlighted code display
- Powerful data processing
- Atomic operations

See [atp/README.md](./atp/README.md) for details.

## 📋 Available Commands

```bash
npm run auth        # Generate Google OAuth token
npm run chat:mcp    # Run MCP agent (direct connection)
npm run chat:atp    # Run ATP agent (code execution)
```

## 💬 Example Interactions

### Simple Query

```
You: What meetings do I have today?
Agent: [Lists your meetings]
```

### Complex Query

```
You: Find a 30-minute slot for me and doronna@monday.com next week
Agent: [Analyzes both calendars and suggests available times]
```

### Calendar Management

```
You: Create a meeting tomorrow at 2pm with the team
Agent: [Creates the event with attendees]
```

## 🏗️ Architecture

### MCP Agent Architecture

```
Agent (LangChain) → MCP Server (@cocal/google-calendar-mcp) → Google Calendar API
```

### ATP Agent Architecture

```
Agent (LangChain) → ATP Server (execute_code) → MCP Adapter → MCP Server → Google Calendar API
```

## 📦 Dependencies

- `@langchain/langgraph` - Agent framework
- `@langchain/openai` - OpenAI integration
- `@mondaydotcomorg/atp-client` - ATP client
- `@mondaydotcomorg/atp-langchain` - LangChain ATP integration
- `@mondaydotcomorg/atp-mcp-adapter` - ATP-MCP bridge
- `@mondaydotcomorg/atp-server` - ATP server

## 🔧 Configuration

The example is configured for:

- **Timezone**: Asia/Jerusalem
- **Working Days**: Sunday-Thursday
- **Working Hours**: 9:00 AM - 6:00 PM

You can modify these in the agent files (located in `atp/code-execution-agent.ts` and `mcp/interactive-agent.ts`).

## 🎨 Built With

The ATP agent uses the [ATP Chat Utilities](../utils/) - a set of reusable components for building interactive code execution agents:

- `ChatFormatter` - Console formatting and syntax highlighting
- `CodeExecutionHandler` - Event handling and code display
- `InteractiveChatRunner` - Chat loop management

## 📚 Learn More

- [SETUP.md](./SETUP.md) - Detailed setup instructions
- [auth/README.md](./auth/README.md) - Authentication guide
- [mcp/README.md](./mcp/README.md) - MCP agent details
- [atp/README.md](./atp/README.md) - ATP agent details
- [MCP-vs-ATP-Comparison.md](./MCP-vs-ATP-Comparison.md) - Detailed comparison

## 🤝 Contributing

This example demonstrates best practices for:

- OAuth authentication with external APIs
- MCP server integration
- ATP code execution
- Agent prompt engineering
- Error handling and user experience

Feel free to use it as a template for your own agents!
