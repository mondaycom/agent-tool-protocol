# Agent Tool Protocol

A production-ready, code-first protocol for AI agents to interact with external systems through secure sandboxed code execution.

## What is Agent Tool Protocol?

Agent Tool Protocol (ATP) is a next-generation protocol that enables AI agents to interact with external systems by generating and executing TypeScript/JavaScript code in a secure, sandboxed environment. Unlike traditional function-calling protocols, ATP allows LLMs to write code that can execute multiple operations in parallel, filter and transform data, chain operations together, and use familiar programming patterns.

ATP provides a complete ecosystem for building production-ready AI agents with:

- **Secure code execution** in isolated V8 VMs with memory limits and timeouts
- **Runtime SDK** (`atp.*`) for LLM calls, embeddings, approvals, caching, and logging
- **Stateless architecture** with optional caching for scalability
- **Client tools** for seamless integration with LangChain, LangGraph, and other frameworks
- **Provenance tracking** to defend against prompt injection attacks
- **OpenAPI and MCP compatibility** for connecting to any API or MCP server

## Why ATP vs MCP?

Traditional function-calling protocols like Model Context Protocol (MCP) have fundamental limitations:

### MCP Limitations

- **Context Bloat**: Large schemas consume significant tokens in every request
- **Sequential Execution**: Only one tool can be called at a time
- **No Data Processing**: Can't filter, transform, or combine results within the protocol
- **Limited Model Support**: Not all LLMs support function calling well
- **Schema Overhead**: Complex nested schemas are verbose and token-expensive

### ATP Advantages

- ✅ **OpenAPI Integration**: Built in open api integration allowing to connect a single server to multiple mcps & openapis
- ✅ **Parallel Execution**: Execute multiple operations simultaneously
- ✅ **Data Processing**: Filter, map, reduce, and transform data inline
- ✅ **Code Flexibility**: Use familiar programming patterns (loops, conditionals, async/await)
- ✅ **Universal Compatibility**: Works with any LLM that can generate code
- ✅ **Reduced Token Usage**: Code is more concise than verbose JSON schemas
- ✅ **Type Safety**: Full TypeScript support with generated type definitions
- ✅ **Production Ready**: Built-in security, caching, state management, and observability

**ATP solves these problems** by letting LLMs write code that executes in a secure sandbox, giving agents the full power of a programming language while maintaining strict security boundaries.

## Architecture & Capabilities

### High Level Architecture

```mermaid
graph TB
    LLM[LLM/Agent] --> Client[ATP Client]
    Client --> Server[ATP Server]

    Server --> Validator[Code Validator<br/>AST Analysis]
    Server --> Executor[Sandbox Executor<br/>Isolated VM]
    Server --> Aggregator[API Aggregator<br/>OpenAPI/MCP/Custom]
    Server --> Search[Search Engine<br/>Semantic/Keyword]
    Server --> State[State Manager<br/>Pause/Resume]

    Executor --> Runtime[Runtime APIs]
    Runtime --> LLMAPI[atp.llm.*]
    Runtime --> EmbedAPI[atp.embedding.*]
    Runtime --> ApprovalAPI[atp.approval.*]
    Runtime --> CacheAPI[atp.cache.*]
    Runtime --> LogAPI[atp.log.*]

    LLMAPI -.Pause.-> Client
    EmbedAPI -.Pause.-> Client
    ApprovalAPI -.Pause.-> Client

    Aggregator --> OpenAPI[OpenAPI Loader]
    Aggregator --> MCP[MCP Connector]
    Aggregator --> Custom[Custom Functions]
```

### Runtime SDK (`atp.*`)

Agents executing code have access to a powerful runtime SDK that provides:

- **`atp.llm.*`**: Client-side LLM execution with call, extract, and classify methods
- **`atp.embedding.*`**: Semantic search with embedding storage and similarity search
- **`atp.approval.*`**: Human-in-the-loop approvals with pause/resume support
- **`atp.cache.*`**: Key-value caching with TTL support
- **`atp.log.*`**: Structured logging for debugging and observability
- **`atp.progress.*`**: Progress reporting for long-running operations
- **`atp.api.*`**: Dynamic APIs from OpenAPI specs, MCP servers, or custom functions

The runtime SDK enables agents to perform complex workflows that require LLM reasoning, data persistence, human approval, and more—all within the secure sandbox.

### Stateless Architecture with Caching

ATP is designed as a stateless system for horizontal scalability:

- **Stateless Server**: Can work completely stateless with distribute caching like redis
- **Execution State**: Long-running executions can pause and resume via state management
- **State TTL**: Configurable time-to-live for execution state

This architecture allows ATP servers to scale horizontally while maintaining execution continuity for complex workflows.

### Client Execution

ATP provides the ability to execute code in the client side:

- **LLM Callbacks**: Client-side LLM execution with automatic pause/resume
- **Approval Workflows**: Approvals for human-in-the-loop
- **Client tools**: Support executing tools defined in the client side
- **Embedding Capabilities**: Execute embedding request using the client embedding model

### Provenance Security

ATP includes advanced security features to defend against prompt injection and data exfiltration:

- **Provenance Tracking**: Tracks the origin of all data (user, LLM, API, etc.)
- **Security Policies**: Configurable policies like `preventDataExfiltration` and `requireUserOrigin`
- **AST Analysis**: Code validation to detect forbidden patterns
- **Proxy Mode**: Runtime interception of all external calls
- **Audit Logging**: Complete audit trail of all executions

Provenance security is inspired by Google Research's CAMEL paper and provides defense-in-depth against adversarial inputs.

## 📦 Installation

```bash
# Using Yarn (recommended)
yarn add @mondaydotcomorg/atp-server @mondaydotcomorg/atp-client

# Using npm
npm install @mondaydotcomorg/atp-server @mondaydotcomorg/atp-client

# Using pnpm
pnpm add @mondaydotcomorg/atp-server @mondaydotcomorg/atp-client

# Using bun
bun add @mondaydotcomorg/atp-server @mondaydotcomorg/atp-client
```

> **📝 Note:** The `--no-node-snapshot` flag is required for Node.js 20+

## 🎯 Quick Start

### Quickstart Example

A single script that integrates OpenAPI (Petstore) and MCP (Playwright):

```typescript
import { createServer, loadOpenAPI } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { MCPConnector } from '@mondaydotcomorg/atp-mcp-adapter';

process.env.ATP_JWT_SECRET = process.env.ATP_JWT_SECRET || 'test-secret-key';

async function main() {
	const server = createServer({});

	// Load OpenAPI spec (supports OpenAPI 3.0+ and Swagger 2.0)
	const petstore = await loadOpenAPI('https://petstore.swagger.io/v2/swagger.json', {
		name: 'petstore',
		filter: { methods: ['GET'] },
	});

	// Connect to MCP server
	const mcpConnector = new MCPConnector();
	const playwright = await mcpConnector.connectToMCPServer({
		name: 'playwright',
		command: 'npx',
		args: ['@playwright/mcp@latest'],
	});

	server.use([petstore, playwright]);
	await server.listen(3333);

	// Create client and execute code
	const client = new AgentToolProtocolClient({
		baseUrl: 'http://localhost:3333',
	});
	await client.init({ name: 'quickstart', version: '1.0.0' });

	// Execute code that filters, maps, and transforms API data
	const result = await client.execute(`
		const pets = await api.petstore.findPetsByStatus({ status: 'available' });
		
		const categories = pets
			.filter(p => p.category?.name)
			.map(p => p.category.name)
			.filter((v, i, a) => a.indexOf(v) === i);
		
		return {
			totalPets: pets.length,
			categories: categories.slice(0, 5),
			sample: pets.slice(0, 3).map(p => ({
				name: p.name,
				status: p.status
			}))
		};
	`);

	console.log('Result:', JSON.stringify(result.result, null, 2));
}

main().catch(console.error);
```

**Run it:**

```bash
cd examples/quickstart
NODE_OPTIONS='--no-node-snapshot' npm start
```

### LangChain Agent Example

Use ATP with LangChain/LangGraph for autonomous agents:

```typescript
import { createServer, loadOpenAPI } from '@mondaydotcomorg/atp-server';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';

async function main() {
	// Start ATP server with OpenAPI
	const server = createServer({});
	const petstore = await loadOpenAPI('https://petstore.swagger.io/v2/swagger.json', {
		name: 'petstore',
		filter: { methods: ['GET'] },
	});
	server.use([petstore]);
	await server.listen(3333);

	// Create LangChain agent with ATP tools
	const llm = new ChatOpenAI({ modelName: 'gpt-4o-mini', temperature: 0 });
	const { tools } = await createATPTools({
		serverUrl: 'http://localhost:3333',
		llm,
	});
	const agent = createReactAgent({ llm, tools });

	// Agent autonomously uses ATP to call APIs
	const result = await agent.invoke({
		messages: [
			{
				role: 'user',
				content:
					'Use ATP to fetch available pets from the petstore API, then tell me how many pets are available and list 3 example pet names.',
			},
		],
	});

	console.log('Agent response:', result.messages[result.messages.length - 1].content);
}

main().catch(console.error);
```

**Run it:**

```bash
cd examples/langchain-quickstart
export OPENAI_API_KEY=sk-...
NODE_OPTIONS='--no-node-snapshot' npm start
```

> **📝 Note:** The `--no-node-snapshot` flag is required for Node.js 20+ and is already configured in the `package.json`.

## 🧠 Advanced LangChain Features

### LLM Callbacks & Approval Workflows

ATP provides powerful LangChain/LangGraph integration with LLM callbacks and approval workflows:

```typescript
import { MemorySaver } from '@langchain/langgraph';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { ChatOpenAI } from '@langchain/openai';

const llm = new ChatOpenAI({ modelName: 'gpt-4.1' });

// Create ATP tools with LLM support and LangGraph interrupt-based approvals
const { tools, isApprovalRequired, resumeWithApproval } = await createATPTools({
	serverUrl: 'http://localhost:3333',
	llm,
	// useLangGraphInterrupts: true (default) - use LangGraph checkpoints for async approvals
});

const checkpointer = new MemorySaver();
const agent = createReactAgent({ llm, tools, checkpointSaver: checkpointer });

try {
	await agent.invoke({ messages: [...] }, { configurable: { thread_id: 'thread-1' } });
} catch (error) {
	if (isApprovalRequired(error)) {
		const { executionId, message } = error.approvalRequest;

		// Notify user (Slack, email, etc.)
		await notifyUser(message);

		// Wait for approval (async - can take hours/days)
		const approved = await waitForApproval(executionId);

		// Resume execution
		const result = await resumeWithApproval(executionId, approved);
	}
}

// Alternative: Simple synchronous approval handler
const { tools } = await createATPTools({
  serverUrl: 'http://localhost:3333',
  llm,
  useLangGraphInterrupts: false,  // Required for approvalHandler
  approvalHandler: async (message, context) => {
    console.log('Approval requested:', message);
    return true; // or false to deny
  },
});
```

## 📚 Runtime APIs Overview

The `atp.*` runtime SDK provides a comprehensive set of APIs for agents executing code:

- **`atp.llm.*`**: Client-side LLM execution for reasoning, extraction, and classification (requires `client.provideLLM()`)
- **`atp.embedding.*`**: Semantic search with embedding storage and similarity search (requires `client.provideEmbedding()`)
- **`atp.approval.*`**: Human-in-the-loop approvals with pause/resume support (requires `client.provideApproval()`)
- **`atp.cache.*`**: Key-value caching with TTL for performance optimization
- **`atp.log.*`**: Structured logging for debugging and observability
- **`atp.progress.*`**: Progress reporting for long-running operations
- **`atp.api.*`**: Dynamic APIs from OpenAPI specs, MCP servers, or custom functions

All runtime APIs are available within the secure sandbox and automatically handle pause/resume for operations that require client-side interaction (LLM, embeddings, approvals).

## 🛡️ Security Features

### Sandboxed Execution

- **Isolated VM**: Code runs in true V8 isolates with separate heaps
- **No Node.js Access**: Zero access to fs, net, child_process, etc.
- **Memory Limits**: Hard memory limits enforced at VM level
- **Timeout Protection**: Automatic termination after timeout
- **Code Validation**: AST analysis and forbidden pattern detection

### Provenance Security

Defend against prompt injection with provenance tracking:

```typescript
import { createServer, ProvenanceMode } from '@mondaydotcomorg/atp-server';
import { preventDataExfiltration, requireUserOrigin } from '@mondaydotcomorg/atp-server';

const server = createServer({
	execution: {
		provenanceMode: ProvenanceMode.PROXY, // or AST
		securityPolicies: [
			preventDataExfiltration, // Block data exfiltration
			requireUserOrigin, // Require user-originated data
		],
	},
});
```

### Runtime Controls

- **LLM Call Limits**: Configurable max LLM calls per execution
- **Rate Limiting**: Requests per minute and executions per hour
- **API Key Authentication**: Optional API key requirement
- **Audit Logging**: All executions logged for compliance

## 🔍 API Discovery

ATP provides intelligent API discovery to help agents find the right tools:

- **Semantic Search**: Embedding-based search for natural language queries (requires embeddings)
- **Keyword Search**: Fast keyword-based search across API names and descriptions
- **Type Definitions**: Generated TypeScript definitions for all available APIs
- **Schema Exploration**: Full API schema exploration via `client.explore()`

## ⚙️ Configuration

Full server configuration:

```typescript
import { createServer } from '@mondaydotcomorg/atp-server';
import { RedisCache, JSONLAuditSink } from '@mondaydotcomorg/atp-providers';

const server = createServer({
  execution: {
    timeout: 30000,              // 30 seconds
    memory: 128 * 1024 * 1024,   // 128 MB
    llmCalls: 10,                // Max LLM calls per execution
    provenanceMode: 'proxy',     // Provenance tracking mode
    securityPolicies: [...],     // Security policies
  },

  clientInit: {
    tokenTTL: 3600,              // 1 hour
    tokenRotation: 1800,         // 30 minutes
  },

  executionState: {
    ttl: 3600,                   // State TTL in seconds
    maxPauseDuration: 3600,      // Max pause duration
  },

  discovery: {
    embeddings: embeddingsModel, // Enable semantic search
  },

  audit: {
    enabled: true,
    sinks: [
      new JSONLAuditSink({ path: './logs', rotateDaily: true }),
    ],
  },

  otel: {
    enabled: true,
    serviceName: 'atp-server',
    traceEndpoint: 'http://localhost:4318/v1/traces',
  },
});

// Add providers
server.setCacheProvider(new RedisCache({ redis }));
server.setAuthProvider(authProvider);

await server.start(3333);
```

## 🚀 Production Features

### Redis Cache

```typescript
import { RedisCache } from '@mondaydotcomorg/atp-providers';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
server.setCacheProvider(new RedisCache({ redis }));
```

### Audit Logging

```typescript
import { JSONLAuditSink } from '@mondaydotcomorg/atp-providers';

const server = createServer({
	audit: {
		enabled: true,
		sinks: [new JSONLAuditSink({ path: './audit-logs', rotateDaily: true })],
	},
});
```

### OpenTelemetry

```typescript
const server = createServer({
	otel: {
		enabled: true,
		serviceName: 'atp-server',
		traceEndpoint: 'http://localhost:4318/v1/traces',
		metricsEndpoint: 'http://localhost:4318/v1/metrics',
	},
});
```

### OAuth Integration

```typescript
import { GoogleOAuthProvider } from '@mondaydotcomorg/atp-providers';

const oauthProvider = new GoogleOAuthProvider({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: 'http://localhost:3333/oauth/callback',
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

server.addAPIGroup({
  name: 'calendar',
  type: 'oauth',
  oauthProvider,
  functions: [...],
});
```

## 🏗️ Packages

```
@agent-tool-protocol/
├── protocol          # Core types and interfaces
├── server            # ATP server implementation
├── client            # Client SDK
├── runtime           # Runtime APIs (atp.*)
├── mcp-adapter       # MCP integration
├── langchain         # LangChain/LangGraph integration
├── atp-compiler      # Loop transformation and optimization
├── providers         # Cache, auth, OAuth, audit providers
└── provenance        # Provenance security (CAMEL-inspired)
```

## 🧪 Examples

All examples are self-contained and work end-to-end without external servers.

> **📝 Note:** Node.js 20+ requires the `--no-node-snapshot` flag. This is already configured in each example's `package.json` scripts, so just run `npm start`.

### 1. Quickstart - OpenAPI + MCP

Complete example with OpenAPI (Petstore) and MCP (Playwright) integration.

```bash
cd examples/quickstart
NODE_OPTIONS='--no-node-snapshot' npm start
```

**Environment variables:**

- `ATP_JWT_SECRET` - Optional (defaults to `test-secret-key` in code)

### 2. LangChain Agent

Autonomous LangChain agent using ATP to interact with APIs.

```bash
cd examples/langchain-quickstart
export OPENAI_API_KEY=sk-...
NODE_OPTIONS='--no-node-snapshot' npm start
```

**Environment variables:**

- `OPENAI_API_KEY` - **Required**: Your OpenAI API key
- `ATP_JWT_SECRET` - Optional (defaults to `test-secret-key` in code)

### 3. LangChain React Agent

Advanced LangChain agent with the test server.

```bash
# Start test server
cd examples/test-server
npx tsx server.ts

# Run agent
cd examples/langchain-react-agent
export OPENAI_API_KEY=sk-...
npm start
```

**Environment variables:**

- `OPENAI_API_KEY` - Required: Your OpenAI API key

### 4. Additional Examples

Other examples in the `examples/` directory:

- `openapi-example` - OpenAPI integration examples
- `oauth-example` - OAuth flow examples
- `production-example` - Production configuration examples

## 🚢 Development

```bash
# Clone repository
git clone https://github.com/yourusername/agent-tool-protocol.git
cd agent-tool-protocol

# Install dependencies (Node.js 18+)
yarn install

# Build all packages
yarn build

# Run tests
yarn test

# Run E2E tests
yarn test:e2e

# Lint
yarn lint
```

## 📦 Requirements

### Node.js Version

Node.js 18+ is required. Node.js 20+ requires the `--no-node-snapshot` flag.

### Compiler Setup (for isolated-vm)

`isolated-vm` requires native compilation:

- **macOS**: `xcode-select --install`
- **Ubuntu/Debian**: `sudo apt-get install python3 g++ build-essential`
- **Windows**: See [node-gyp Windows instructions](https://github.com/nodejs/node-gyp#on-windows)

## 📄 License

This project is licensed under the MIT License - see the [License](./LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol)
- Provenance security based on Google Research's [CAMEL paper](https://arxiv.org/abs/2410.02904)
- Sandboxing powered by [isolated-vm](https://github.com/laverdet/isolated-vm)
- LangChain integration via [@langchain/core](https://github.com/langchain-ai/langchainjs)

## 🔗 Links

- **Documentation**: [docs/](https://agenttoolprotocol.com/docs)
- **Examples**: [examples/](./examples/)
- **Packages**: [packages/](./packages/)

---

**Built with ❤️ for the AI community**
