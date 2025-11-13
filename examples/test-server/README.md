# ATP Test Server

A minimal ATP server for testing and development, particularly useful for testing the LangChain integration.

## Features

- Simple test APIs (`test.echo`, `test.add`)
- Client services enabled (LLM, approval, embedding callbacks)
- Quick startup for development and testing
- Used by LangChain integration examples

## Usage

```bash
# Start the test server
NODE_OPTIONS='--no-node-snapshot' npx tsx server.ts

# Server will start on http://localhost:3333
```

**Note**: The server uses a default JWT secret (`test-key`) for development. Set the `ATP_JWT_SECRET` environment variable for production use.

**Important**: Use `NODE_OPTIONS='--no-node-snapshot'` to avoid segmentation faults with tsx.

## Test APIs

### `test.echo`

Echoes back a message with timestamp.

```typescript
await api.test.echo({ message: 'Hello' });
// Returns: { echoed: "Hello", timestamp: 1234567890 }
```

### `test.add`

Adds two numbers.

```typescript
await api.test.add({ a: 5, b: 3 });
// Returns: { result: 8 }
```

## Use with LangChain

This server is perfect for testing the LangChain integration:

```bash
# Terminal 1: Start test server
cd examples/test-server
NODE_OPTIONS='--no-node-snapshot' npx tsx server.ts

# Terminal 2: Run LangChain examples
cd examples/langchain-react-agent
export OPENAI_API_KEY=sk-...
yarn discover
```

## Client Services

The server enables client services, allowing ATP code to use:

- `atp.llm.call()` - Routes to your LangChain LLM
- `atp.approval.request()` - Triggers approval workflows
- `atp.embedding.embed()` - Routes to your embeddings model

Perfect for testing the full ATP + LangChain integration!
