# ATP Agent (Code Execution)

This folder contains the ATP-based agent that uses **code execution** to call multiple tools at once.

## Architecture

```
┌─────────────┐
│   Agent     │
│ (LangChain) │
└──────┬──────┘
       │
       │ execute_code tool
       │
       v
┌─────────────┐
│ ATP Server  │
│  (Runtime)  │
└──────┬──────┘
       │
       │ MCP Adapter
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

- **`code-execution-agent.ts`**: The main agent implementation
- **`mcp-server.ts`**: ATP server that wraps the MCP
- **`start-code-agent.sh`**: Script to start server and agent together
- **`server.log`**: Server logs (created at runtime)

## Features

- ✅ **Multi-Tool Code Execution**: Write TypeScript code that calls multiple tools
- ✅ **Single Execution Block**: Multiple operations in one code block
- ✅ **Shows Generated Code**: See the actual TypeScript being executed
- ✅ **Syntax Highlighting**: Beautiful code display with colors
- ✅ **Conversation Memory**: Maintains context across interactions
- ✅ **Built with [ATP Chat Utilities](../../utils)**: Reusable components

## Usage

```bash
npm run chat:atp
```

This automatically:
1. Starts the ATP server in the background
2. Waits for it to be ready
3. Starts the agent
4. Cleans up the server on exit

## How It Works

1. **Agent** calls `execute_code` tool with TypeScript code
2. **ATP Server** executes the code in an isolated VM
3. **Code** calls multiple MCP tools via `api['google-calendar']['tool-name']()`
4. **Results** are parsed and returned to the agent

## Example Interaction

```
You: What meetings do I have today?

🤖 Agent writing code...

📝 TypeScript Code Being Executed:
════════════════════════════════════════════════════════════════════════════════
 1 │ const timeResult = await api['google-calendar']['get-current-time']({
 2 │   timeZone: 'Asia/Jerusalem'
 3 │ });
 4 │ const timeData = JSON.parse(timeResult[0].text);
 5 │ const currentTime = new Date(timeData.currentTime);
 6 │ 
 7 │ const eventsResult = await api['google-calendar']['list-events']({
 8 │   calendarId: 'primary',
 9 │   timeMin: formatForAPI(startOfDay),
10 │   timeMax: formatForAPI(endOfDay)
11 │ });
12 │ const eventsData = JSON.parse(eventsResult[0].text);
13 │ 
14 │ return {
15 │   events: eventsData.events.map(e => ({
16 │     summary: e.summary,
17 │     start: e.start.dateTime
18 │   }))
19 │ };
════════════════════════════════════════════════════════════════════════════════

✅ Code Execution Result:
{
  "events": [
    { "summary": "Team Standup", "start": "2025-11-20T09:00:00+02:00" },
    { "summary": "Project Review", "start": "2025-11-20T14:00:00+02:00" },
    { "summary": "Client Call", "start": "2025-11-20T16:00:00+02:00" }
  ]
}

Agent: You have 3 meetings today:
- 9:00 AM: Team Standup
- 2:00 PM: Project Review
- 4:00 PM: Client Call
```

## Pros

- Can combine multiple tool calls in one execution
- More efficient for complex queries
- Shows the actual code being generated
- Powerful for data processing and logic
- Single execution = atomic operations

## Cons

- More complex setup (requires ATP server)
- Additional layer of abstraction
- Server must be running
- Code must be self-contained (VM limitations)

## Server Configuration

The ATP server (`mcp-server.ts`):
- Wraps the Google Calendar MCP using `MCPConnector`
- Exposes tools via ATP protocol on port 3334
- Filters out `get-freebusy` tool by removing it from the function list
- Provides enhanced output schemas for better type information
- No authentication required (for local development)

## Troubleshooting

If the agent fails to start:
1. Check `atp/server.log` for server errors
2. Make sure port 3334 is available (kill any process using it)
3. Verify `.env` file exists in the project root with required credentials:
   - `OPENAI_API_KEY`
   - `GOOGLE_OAUTH_CREDENTIALS`
4. Ensure you've run `npm run auth` to generate OAuth tokens
5. Check that the `start-code-agent.sh` script has execute permissions

## See Also

- [MCP Agent](../mcp/) - Direct MCP connection
- [Authentication](../auth/) - OAuth setup
- [ATP Chat Utilities](../../utils/) - Reusable utilities used here

