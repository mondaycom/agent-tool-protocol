# Embedded Engine Examples

These examples demonstrate using `ATPEngine` for direct, in-process code execution without HTTP server overhead.

## Examples

### 1. Basic Example

```bash
npm run basic
```

Shows:
- Creating an ATPEngine
- Registering custom APIs
- Executing code directly
- Getting type definitions
- Searching APIs

### 2. OpenAPI Example

```bash
npm run openapi
```

Shows:
- Loading OpenAPI specs
- Registering OpenAPI as embedded APIs
- Executing code that calls OpenAPI endpoints
- No HTTP server needed!

### 3. Provenance Security Example

```bash
npm run provenance
```

Shows:
- Provenance tracking in embedded mode
- Data exfiltration prevention
- Security policies enforcement
- Authorized vs unauthorized data access

## Key Benefits

✅ **No HTTP Server**: Direct execution, no port binding  
✅ **Lower Latency**: No network overhead  
✅ **Simpler Deployment**: Single process  
✅ **Perfect for CLI Tools**: Embed in any application  

## When to Use ATPEngine

- CLI tools and scripts
- Testing and development
- Single-process applications
- Batch processing
- When you don't need pause/resume for LLM callbacks

## When to Use ATPServer

- LLM agents need `atp.llm.*` callbacks
- Human-in-the-loop approvals
- Horizontal scaling across pods
- Client-side tool execution

## Run All Examples

```bash
npm install
npm run basic
npm run openapi
npm run provenance
```

