# Vercel AI SDK + ATP Example

This example demonstrates how to use the Vercel AI SDK integration with Agent Tool Protocol (ATP).

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file:

```bash
OPENAI_API_KEY=your-openai-api-key
ATP_SERVER_URL=http://localhost:3333
ATP_API_KEY=test-key
```

3. Start an ATP server (in another terminal):

```bash
# From the root of the repository
npm run example:production
```

## Examples

### Basic Agent

Run the basic agent example with CLI approval:

```bash
npm run agent
```

This demonstrates:
- Creating ATP tools for Vercel AI SDK
- Using `generateText` with multi-step execution
- Human-in-the-loop approvals via CLI
- LLM sampling within ATP code

### Streaming Example

Run the streaming example:

```bash
npm run streaming
```

This demonstrates:
- Streaming responses with ATP tools
- Using `streamText` from Vercel AI SDK
- Real-time output

### Webhook-Based Approval

Run the webhook approval example:

```bash
npm run webhook
```

This demonstrates:
- Production-ready async approval pattern
- Webhook-based approval system
- Timeout handling
- REST API for approval management

To approve/deny requests:

```bash
# List pending approvals
curl http://localhost:3000/approvals

# Approve a request
curl -X POST http://localhost:3000/approve/APPROVAL_ID \
  -H "Content-Type: application/json" \
  -d '{"approved": true}'
```

## What's Happening

When you run these examples, the Vercel AI SDK agent:

1. Receives a prompt asking it to use ATP
2. Calls the `atp_execute_code` tool
3. Executes TypeScript code in the ATP sandbox
4. The code can use runtime APIs:
   - `atp.llm.call()` - Routes to your Vercel AI SDK model
   - `atp.approval.request()` - Triggers your approval handler
   - `atp.embedding.embed()` - If embedding provider configured
5. Returns the result back to the agent

This creates a powerful loop where your AI agent can execute arbitrary code with access to LLMs, approvals, and other runtime capabilities.

