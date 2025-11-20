# Engine vs Server: Architectural Decoupling

## Overview

ATP now has a **decoupled architecture** that separates the execution engine from the HTTP server layer. This gives you two deployment options:

1. **`@mondaydotcomorg/atp-engine`**: Embedded execution without HTTP
2. **`@mondaydotcomorg/atp-server`**: Full-featured HTTP server with pause/resume

## Architecture

```
┌─────────────────────────────────────┐
│         ATPServer (HTTP)            │
│                                     │
│  • HTTP endpoints                   │
│  • Client sessions                  │
│  • Pause/Resume coordination        │
│  • LLM/Approval callbacks           │
│                                     │
│  ┌───────────────────────────────┐ │
│  │      ATPEngine (Core)         │ │
│  │                               │ │
│  │  • Sandbox execution          │ │
│  │  • API aggregation            │ │
│  │  • Compiler integration       │ │
│  │  • Provenance security        │ │
│  │  • Cache & state              │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
```

The server **wraps** the engine, adding HTTP coordination on top of core execution capabilities.

## When to Use Each

### Use ATPEngine When:

✅ **CLI Tools**: Command-line utilities that execute code locally  
✅ **Testing**: Unit/integration tests for ATP code  
✅ **Batch Processing**: Process data without user interaction  
✅ **Single Process**: Applications that run in one process  
✅ **No LLM Callbacks**: Don't need `atp.llm.*` or `atp.approval.*`  
✅ **Low Latency**: Need fastest possible execution  

**Example use cases:**
- Data transformation scripts
- Code analysis tools
- Automated workflows
- Development/testing
- Embedded in existing applications

### Use ATPServer When:

✅ **LLM Agents**: Agents that need `atp.llm.call()` for reasoning  
✅ **Approvals**: Human-in-the-loop workflows  
✅ **Client Embeddings**: `atp.embedding.*` with client-side models  
✅ **Client Tools**: Tools that execute on the client side  
✅ **Horizontal Scaling**: Need to scale across multiple pods  
✅ **Multi-Session**: Handle multiple concurrent users  

**Example use cases:**
- Autonomous AI agents
- Interactive chat applications
- Multi-user platforms
- Production LLM applications
- Applications requiring human approval

## Comparison

| Feature | ATPEngine | ATPServer |
|---------|-----------|-----------|
| **Deployment** | | |
| HTTP Server | ❌ No | ✅ Yes |
| Port Binding | ❌ No | ✅ Yes |
| Process Model | Single | Multi (horizontal scaling) |
| **Execution** | | |
| Direct Execution | ✅ Sync | ❌ Async (HTTP) |
| Pause/Resume | ❌ No | ✅ Yes |
| Execution Latency | 🚀 <1ms | 🐌 ~10-50ms (network) |
| **Callbacks** | | |
| `atp.llm.*` | ❌ No | ✅ Yes |
| `atp.approval.*` | ❌ No | ✅ Yes |
| `atp.embedding.*` | ❌ No | ✅ Yes |
| Client Tools | ❌ No | ✅ Yes |
| **APIs** | | |
| OpenAPI Integration | ✅ Yes | ✅ Yes |
| MCP Integration | ✅ Yes | ✅ Yes |
| Custom Functions | ✅ Yes | ✅ Yes |
| API Registration | By ID | Via `.use()` or `.addAPIGroup()` |
| **Security** | | |
| Sandbox Isolation | ✅ Yes | ✅ Yes |
| Provenance Tracking | ✅ Yes | ✅ Yes |
| Security Policies | ✅ Yes | ✅ Yes |
| **Features** | | |
| Compiler Integration | ✅ Yes | ✅ Yes |
| Batch Optimization | ✅ Yes | ✅ Yes |
| Cache Support | ✅ Yes | ✅ Yes |
| Audit Logging | ✅ Yes | ✅ Yes |
| **Development** | | |
| Complexity | 🟢 Simple | 🟡 Moderate |
| Setup | Instant | Needs port config |
| Testing | Easy (unit tests) | Harder (e2e tests) |

## Code Examples

### ATPEngine (Embedded)

```typescript
import { ATPEngine } from '@mondaydotcomorg/atp-engine';

const engine = new ATPEngine({
  timeout: 30000,
  enableCompiler: true,
});

// Register APIs by ID
engine.registerAPI('math', {
  type: 'custom',
  functions: [
    {
      name: 'add',
      handler: async (input) => ({ result: input.a + input.b })
    }
  ]
});

// Execute directly - no HTTP!
const result = await engine.execute(`
  const sum = await atp.api.math.add({ a: 10, b: 20 });
  return sum.result;
`);

console.log(result.result); // 30
```

### ATPServer (Full-Featured)

```typescript
import { createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

const server = createServer({});

server.addAPIGroup({
  name: 'math',
  type: 'custom',
  functions: [
    {
      name: 'add',
      handler: async (input) => ({ result: input.a + input.b })
    }
  ]
});

await server.start(3333);

// Client connects via HTTP
const client = new AgentToolProtocolClient({
  baseUrl: 'http://localhost:3333'
});

await client.init();

// Execute with pause/resume support
const result = await client.execute(`
  const sum = await atp.api.math.add({ a: 10, b: 20 });
  
  // Can use LLM callbacks!
  const explanation = await atp.llm.call({
    prompt: 'Explain: ' + sum.result
  });
  
  return { sum: sum.result, explanation };
`);
```

## Migration Guide

### From Server to Engine

If you're only using the execution engine without pause/resume:

```typescript
// Before (Server)
import { createServer } from '@mondaydotcomorg/atp-server';
const server = createServer({});
server.addAPIGroup(apiGroup);
await server.start(3333);

// After (Engine)
import { ATPEngine } from '@mondaydotcomorg/atp-engine';
const engine = new ATPEngine({});
engine.registerAPI('myapi', { type: 'custom', spec: apiGroup });
const result = await engine.execute(code);
```

### From Engine to Server

If you need LLM callbacks or approvals:

```typescript
// Before (Engine)
import { ATPEngine } from '@mondaydotcomorg/atp-engine';
const engine = new ATPEngine({});

// After (Server + Client)
import { createServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

const server = createServer({});
await server.start(3333);

const client = new AgentToolProtocolClient({
  baseUrl: 'http://localhost:3333'
});

client.provideLLM({ /* LLM handler */ });
await client.init();
const result = await client.execute(code);
```

## Performance Comparison

### Engine (Direct)

```
┌──────┐
│ Call │ → Engine → Execute → Result
└──────┘
          <1ms        ~20ms    <1ms
          
Total: ~21ms
```

### Server (HTTP)

```
┌──────┐
│ Call │ → HTTP → Server → Engine → Execute → Result → HTTP → Response
└──────┘
          5-10ms   <1ms      <1ms      ~20ms    <1ms    5-10ms
          
Total: ~32-42ms (without pause)
Total: ~1000ms+ (with LLM callback pause/resume)
```

## Best Practices

### For CLI Tools

```typescript
// cli-tool.ts
import { ATPEngine } from '@mondaydotcomorg/atp-engine';

const engine = new ATPEngine({
  timeout: 60000,
  provenanceMode: 'proxy',
});

// Register your APIs
engine.registerAPI('myapi', { ... });

// Execute user's code
const code = process.argv[2];
const result = await engine.execute(code);

console.log(JSON.stringify(result.result, null, 2));
```

### For LLM Agents

```typescript
// agent.ts
import { createServer } from '@mondaydotcomorg/atp-server';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

const server = createServer({});
await server.start(3333);

const { tools } = await createATPTools({
  serverUrl: 'http://localhost:3333',
  llm: new ChatOpenAI({ modelName: 'gpt-4' })
});

const agent = createReactAgent({ llm, tools });
const result = await agent.invoke({ messages: [...] });
```

## Configuration

### Shared Configuration

Both engine and server support the same core configuration:

```typescript
{
  timeout: 30000,
  memory: 128 * 1024 * 1024,
  enableCompiler: true,
  enableBatchParallel: true,
  provenanceMode: 'proxy',
  securityPolicies: [...],
  cacheProvider: redisCacheProvider,
  auditSink: auditSink,
  logger: pinoLogger,
}
```

### Server-Only Configuration

```typescript
{
  clientInit: {
    tokenTTL: 3600,
    tokenRotation: 1800,
  },
  executionState: {
    ttl: 3600,
    maxPauseDuration: 3600,
  },
  discovery: {
    embeddings: embeddingsModel,
  },
}
```

## Future: Server Wrapping Engine

In the future, the server will be refactored to use ATPEngine internally:

```typescript
// packages/server/src/server.ts (future)
import { ATPEngine } from '@mondaydotcomorg/atp-engine';

export class ATPServer {
  private engine: ATPEngine;
  
  constructor(config) {
    // Create embedded engine
    this.engine = new ATPEngine(config);
  }
  
  async start(port: number) {
    // HTTP layer wraps engine.execute()
  }
}
```

This maintains backward compatibility while enabling both deployment modes.

## Summary

The decoupled architecture gives you **flexibility**:

- **Start simple**: Use ATPEngine for direct execution
- **Scale up**: Add ATPServer when you need HTTP/pause/resume
- **Best of both**: Share the same security, compiler, and provenance features

Choose the right tool for your use case! 🚀

