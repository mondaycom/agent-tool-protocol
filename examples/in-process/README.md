# In-Process ATP Example

This example demonstrates how to use ATP in **in-process mode**, where the client communicates directly with the server without HTTP.

## Why In-Process Mode?

In standard HTTP mode, the ATP server binds to a port:

```typescript
const server = createServer();
await server.listen(3333); // Binds to port 3333
const client = new AgentToolProtocolClient({ baseUrl: 'http://localhost:3333' });
```

This causes problems when:

- **Multiple MCP stdio processes** run simultaneously - they all try to bind to the same port
- **Testing** requires isolated client-server pairs running in parallel
- **Embedded scenarios** where HTTP overhead is unnecessary

## In-Process Solution

With in-process mode, the client communicates directly with the server instance:

```typescript
const server = createServer();
// No listen() call needed!
const client = new AgentToolProtocolClient({ server });
await client.init();
```

This allows:

- **Multiple instances** running in the same process without port conflicts
- **Zero network overhead** - direct function calls
- **Perfect isolation** - each client-server pair is independent

## Running the Examples

```bash
# Basic example
npx ts-node index.ts

# Multi-instance example (shows parallel instances)
npx ts-node multi-instance.ts
```

## Key API Difference

| HTTP Mode                                                           | In-Process Mode                           |
| ------------------------------------------------------------------- | ----------------------------------------- |
| `new AgentToolProtocolClient({ baseUrl: 'http://localhost:3333' })` | `new AgentToolProtocolClient({ server })` |
| Requires `server.listen(port)`                                      | No `listen()` needed                      |
| One server per port                                                 | Unlimited instances                       |

## Use Cases

1. **MCP stdio servers** - Each stdio process gets its own ATP instance
2. **Parallel testing** - Run multiple isolated tests simultaneously
3. **Embedded agents** - ATP inside your application without network
4. **Microservices** - Service-like isolation without HTTP overhead
