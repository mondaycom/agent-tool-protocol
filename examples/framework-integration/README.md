# Framework Integration Examples

These examples demonstrate how to integrate Agent Tool Protocol (ATP) with popular Node.js web frameworks.

## Overview

ATP provides three integration methods:

1. **Standalone Mode** (Recommended for getting started)
   - Use `server.listen(port)` - ATP manages its own HTTP server
   - Simplest approach, great for development and simple deployments

2. **Framework Integration** (Recommended for production)
   - Use `server.handler()`, `server.toExpress()`, or `server.toFastify()`
   - Integrate with your existing web framework
   - Use framework-native middleware for auth, CORS, rate limiting, etc.
   - Server components initialize automatically on first request - no manual setup needed

## Examples

### Express Integration (`express-example.ts`)

Integrate ATP with Express and use the Express middleware ecosystem:

```typescript
import express from 'express';
import { createServer } from '@mondaydotcomorg/atp-server';

const app = express();
const atpServer = createServer();

// Use Express middleware
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Mount ATP routes - components initialize automatically on first request
app.all('/atp/*', atpServer.toExpress());

app.listen(3000);
```

**Benefits:**

- Use Express's vast middleware ecosystem
- Integrate with existing Express apps
- Familiar Express patterns

### Fastify Integration (`fastify-example.ts`)

Integrate ATP with Fastify and use Fastify plugins:

```typescript
import Fastify from 'fastify';
import { createServer } from '@mondaydotcomorg/atp-server';

const fastify = Fastify();
const atpServer = createServer();

// Use Fastify plugins
await fastify.register(cors);
await fastify.register(rateLimit);

// Mount ATP routes - components initialize automatically on first request
fastify.all('/atp/*', atpServer.toFastify());

await fastify.listen({ port: 3000 });
```

**Benefits:**

- High performance with Fastify
- Schema validation and serialization
- Plugin ecosystem

### Raw Handler (`raw-handler-example.ts`)

Use the raw Node.js request handler for maximum flexibility:

```typescript
import { createServer as createHTTPServer } from 'node:http';
import { createServer } from '@mondaydotcomorg/atp-server';

const atpServer = createServer();
const atpHandler = atpServer.handler();

// Components initialize automatically on first request
const server = createHTTPServer(async (req, res) => {
	// Your custom routing logic
	if (req.url?.startsWith('/api/')) {
		await atpHandler(req, res);
	}
});

server.listen(3000);
```

**Benefits:**

- Maximum control and flexibility
- Works with any framework (Hono, Koa, etc.)
- No framework dependencies

## Running the Examples

1. **Install dependencies:**

   ```bash
   cd examples/framework-integration
   yarn install
   ```

2. **Run an example:**

   ```bash
   # Express
   npx tsx express-example.ts

   # Fastify
   npx tsx fastify-example.ts

   # Raw Handler
   npx tsx raw-handler-example.ts
   ```

3. **Test the server:**

   ```bash
   # Get server info
   curl http://localhost:3000/atp/api/info

   # Or for raw handler
   curl http://localhost:3000/api/info
   ```

## Custom Middleware

All examples show how to implement your own authentication, CORS, and rate limiting using the framework's native capabilities. This gives you full control over your security and middleware stack.

### Example: Custom Auth Middleware

**Express:**

```typescript
app.use((req, res, next) => {
	const apiKey = req.headers['x-api-key'];
	if (!isValidKey(apiKey)) {
		return res.status(403).json({ error: 'Invalid API key' });
	}
	next();
});
```

**Fastify:**

```typescript
fastify.addHook('onRequest', async (request, reply) => {
	const apiKey = request.headers['x-api-key'];
	if (!isValidKey(apiKey)) {
		reply.code(403).send({ error: 'Invalid API key' });
	}
});
```

**Raw Handler:**

```typescript
const server = createHTTPServer(async (req, res) => {
	const apiKey = req.headers['x-api-key'];
	if (!isValidKey(apiKey)) {
		res.writeHead(403, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Invalid API key' }));
		return;
	}
	await atpHandler(req, res);
});
```

## When to Use Each Approach

- **Standalone (`server.listen()`)**: Best for getting started, simple deployments, or when you don't need additional HTTP routing
- **Express**: Best when you have an existing Express app or need Express-specific middleware
- **Fastify**: Best for high-performance applications or when you need Fastify's schema validation
- **Raw Handler**: Best for custom frameworks (Hono, Koa, etc.) or when you need maximum control

## See Also

- [Complete Guide](../../docs/complete-guide.md) - Full ATP documentation
- [Custom Middleware Guide](../../docs/getting-started.md) - How to implement custom middleware
- [Production Example](../production-example/) - Full production setup with providers
