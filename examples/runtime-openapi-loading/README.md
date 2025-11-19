# Runtime OpenAPI Loading Example

This example demonstrates how to dynamically load OpenAPI specifications after your server has started.

## Features

- Load OpenAPI specs from URLs at runtime
- Add custom API groups dynamically
- Update server capabilities without restart
- **Same API works both before and after server starts!**

## Usage

The beautiful thing is you use the **same methods** whether the server is running or not:

### Load OpenAPI Spec (Before OR After Start)

```typescript
import { createServer } from '@mondaydotcomorg/atp-server';

const server = createServer();

// Works before starting
await server.loadOpenAPI('http://localhost:3040/openapi.json', {
	name: 'demo',
});

await server.listen(3000);

// Same method works after starting too!
await server.loadOpenAPI('http://api.example.com/openapi.json', {
	name: 'another-api',
	filter: {
		methods: ['GET', 'POST'],
		tags: ['pets'],
	},
});
```

### Add API Groups with use() (Before OR After Start)

```typescript
const apiGroup = {
  name: 'myapi',
  type: 'custom',
  functions: [...],
};

// Works both before and after server starts
server.use(apiGroup);
```

## When to Use Runtime Loading

Runtime loading is useful when:

- You need to load APIs from external services
- API specifications are discovered dynamically
- You want to hot-reload API configurations
- You're building a plugin system
- You want to add APIs based on user configuration

## How It Works

The server intelligently handles both scenarios:

**Before server starts** (`use()` / `loadOpenAPI()`):

- Simply adds to the configuration arrays
- No component updates needed

**After server starts** (`use()` / `loadOpenAPI()`):

- Adds to the configuration arrays
- Automatically recreates search engine with new groups
- Automatically recreates explorer service with new groups
- Automatically recreates executor with new groups

**Note:** Middleware can only be added before server starts (security restriction).

## Running the Example

```bash
# Start your OpenAPI service first (e.g., on port 3040)
# Then run this example:
npm run dev examples/runtime-openapi-loading/server.ts
```

## API

### `loadOpenAPI(source, options)`

Loads an OpenAPI spec and adds it to the server. Works both before and after server starts.

**Parameters:**

- `source`: URL or file path to OpenAPI spec
- `options`: OpenAPI loader options
  - `name`: API group name
  - `filter`: Filter operations by method, tag, etc.
  - `baseURL`: Override base URL
  - `authProvider`: Custom auth provider

**Returns:** `this` for chaining

### `use(...items)`

Adds middleware or API groups to the server. Works both before and after server starts.

**Parameters:**

- `items`: Middleware functions or API group configurations

**Returns:** `this` for chaining

**Throws:** Error if trying to add middleware after server has started.
