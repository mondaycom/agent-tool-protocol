# MCP Agent (Direct Connection)

This folder contains the MCP-based agent that connects **directly** to the Google Calendar MCP server.

## Architecture

```
┌─────────────┐
│   Agent     │
│ (LangChain) │
└──────┬──────┘
       │
       │ Direct Connection
       │
       v
┌─────────────┐
│     MCP     │
│   Server    │
│  (Google    │
│  Calendar)  │
└─────────────┘
```

## Files

- **`interactive-agent.ts`**: The main agent implementation

## Features

- ✅ **Simple Setup**: No ATP server needed
- ✅ **Direct MCP Connection**: Connects directly to `@cocal/google-calendar-mcp`
- ✅ **Individual Tool Calls**: Each calendar operation is a separate tool call
- ✅ **Transparent**: You see each tool execution separately
- ✅ **Conversation Memory**: Maintains context across interactions

## Usage

```bash
npm run chat:mcp
```

## How It Works

1. **Agent** creates MCP connector to `@cocal/google-calendar-mcp`
2. **MCP Server** handles OAuth and Google Calendar API calls
3. **Agent** calls tools like `list-events`, `create-event` individually
4. Each tool call is executed separately and results are shown

## Example Interaction

```
You: What meetings do I have today?

Agent thinking...
→ get-current-time({ timeZone: 'Asia/Jerusalem' })
→ list-events({ calendarId: 'primary', timeMin: '2025-11-20T00:00:00', ... })

Agent: You have 3 meetings today:
- 9:00 AM: Team Standup
- 2:00 PM: Project Review
- 4:00 PM: Client Call
```

## Pros

- Simple and straightforward
- No server management needed
- Easy to debug (individual tool calls)
- Fast startup

## Cons

- One tool call at a time
- Can't combine operations in code
- More verbose for complex queries
- Agent must orchestrate multiple calls

## See Also

- [ATP Agent](../atp/) - Code execution with multiple tools
- [Authentication](../auth/) - OAuth setup
