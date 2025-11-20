# Architecture Review: Server-Engine Decoupling

## Executive Summary

✅ **The decoupling is complete and correct.** The server has been successfully refactored to use the new `@mondaydotcomorg/atp-engine` package without any behavior changes.

## What Was Moved

### Core Execution Logic → Engine Package

**Moved from `packages/server/src/` to `packages/engine/src/`:**

1. **`executor/`** - Complete sandbox execution system (12 files)
   - `executor.ts` - Main SandboxExecutor class
   - `sandbox-builder.ts` - Sandbox construction with API injection
   - `compiler-config.ts` - Pluggable compiler integration
   - `ast-tracking-runtime.ts` - AST provenance tracking
   - `bootstrap-generated.ts` - isolated-vm bootstrap
   - All error handlers and resume logic

2. **`aggregator/`** - API type generation system
   - `index.ts` - APIAggregator for TypeScript definitions
   - Generates runtime type definitions for sandboxed code

### What Stayed in Server

**Server-specific HTTP coordination layer:**

1. **HTTP Layer**
   - `http/` - Request routing and handling
   - `routes/` - Route definitions
   - `middleware/` - Audit middleware

2. **Pause/Resume System**
   - `execution-state/` - State persistence for pause/resume
   - `instrumentation/` - Code instrumentation for state capture
   - `callback/` - Client callback management

3. **Session Management**
   - `client-sessions.ts` - JWT session management
   - Multi-user support

4. **Discovery & Search**
   - `search/` - Semantic API search
   - `explorer/` - API exploration service

5. **Integration Utilities**
   - `openapi-loader.ts` - OpenAPI/Swagger parsing
   - `validator/` - Code validation
   - `utils/` - Server-specific utilities

## Architecture Verification

### ✅ Server Uses Engine Correctly

**Import Changes (Only):**
```diff
- import { SandboxExecutor } from './executor/index.js';
- import { APIAggregator } from './aggregator/index.js';
+ import { SandboxExecutor, APIAggregator } from '@mondaydotcomorg/atp-engine';
```

**Behavior Unchanged:**
- All instantiation logic identical
- All configuration passing identical
- All method calls identical
- No functional code changes

### ✅ Clean Separation of Concerns

```
┌─────────────────────────────────────────┐
│  @mondaydotcomorg/atp-server (HTTP)     │
│                                         │
│  • HTTP endpoints & routing             │
│  • Pause/resume coordination            │
│  • Client session management            │
│  • Callback routing (LLM/approval)      │
│  • State persistence                    │
│  • OpenAPI loading utilities            │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ @mondaydotcomorg/atp-engine       │  │
│  │                                   │  │
│  │  • SandboxExecutor                │  │
│  │  • APIAggregator                  │  │
│  │  • Compiler integration           │  │
│  │  • Provenance tracking            │  │
│  │  • Core execution logic           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## New Capabilities

### 1. Embedded Engine Usage (Without Server)

```typescript
import { ATPEngine } from '@mondaydotcomorg/atp-engine';

const engine = new ATPEngine({ timeout: 30000 });
engine.registerAPI('database', { type: 'custom', functions: [...] });
const result = await engine.execute(`
  const users = await atp.api.database.getUsers();
  return users.length;
`);
```

**Use Cases:**
- CLI tools
- Testing & development
- Embedded AI agents
- Low-latency scenarios (no HTTP overhead)

### 2. Full Server (With HTTP Coordination)

```typescript
import { createServer } from '@mondaydotcomorg/atp-server';

const server = createServer();
server.tool('getUser', { ... });
await server.listen(3333);
```

**Use Cases:**
- Production AI platforms
- Multi-user environments
- Pause/resume workflows (LLM callbacks, approvals)
- Horizontal scaling with state management

## Potential Improvements Identified

### 1. ✅ **FIXED**: Engine README Documentation Bug

**Issue:** Engine README referenced non-existent import path:
```typescript
import { loadOpenAPI } from '@mondaydotcomorg/atp-engine/openapi'; // ❌ Doesn't exist
```

**Fix Applied:**
```typescript
import { loadOpenAPI } from '@mondaydotcomorg/atp-server'; // ✅ Correct
```

### 2. OpenAPI Loader Location

**Current State:**
- `loadOpenAPI` lives in `@mondaydotcomorg/atp-server`
- Engine examples must import from server package
- Creates dependency: engine examples → server package

**Options:**
1. **Keep as-is** (recommended) - OpenAPI parsing is not core execution logic
2. Move to separate `@mondaydotcomorg/atp-openapi` package
3. Move to engine (adds Node.js fs/yaml dependencies)

**Recommendation:** Keep as-is. The engine works with `APIGroupConfig`, and the server provides conversion utilities.

### 3. Potential Future Decoupling

These components could potentially be extracted into separate packages if needed:

- **`@mondaydotcomorg/atp-openapi`** - OpenAPI/Swagger parsing
- **`@mondaydotcomorg/atp-search`** - Semantic API search (if useful standalone)
- **`@mondaydotcomorg/atp-state`** - Execution state management (if useful standalone)

**Not recommended now** - current separation is clean and logical.

## Testing Recommendations

### Critical Paths to Test

1. **Basic Execution** (engine)
   ```bash
   npm test packages/engine
   ```

2. **Server HTTP Endpoints**
   - POST /execute
   - POST /resume
   - GET /definitions

3. **Pause/Resume Flow**
   - Execute with pausable: true
   - Verify state persistence
   - Resume from saved state

4. **OpenAPI Integration**
   - Load OpenAPI spec via server
   - Execute code using OpenAPI functions
   - Verify type generation

5. **Provenance Security**
   - AST mode primitive tracking
   - Proxy mode object tracking
   - Policy enforcement

## Deployment Notes

### For Engine Users

```json
{
  "dependencies": {
    "@mondaydotcomorg/atp-engine": "^0.1.0",
    "@mondaydotcomorg/atp-server": "^0.18.5" // Optional, for loadOpenAPI
  }
}
```

### For Server Users

```json
{
  "dependencies": {
    "@mondaydotcomorg/atp-server": "^0.18.5"
    // Engine is automatically included as transitive dependency
  }
}
```

## Conclusion

✅ **The decoupling is production-ready:**

1. **Complete separation** - Engine contains all core execution logic
2. **No behavior changes** - Only import paths changed
3. **Clean architecture** - Server wraps engine with HTTP coordination
4. **Backward compatible** - Server API unchanged
5. **New capabilities** - Embedded engine usage now possible
6. **Well documented** - README bugs fixed, examples provided

**No additional decoupling needed** - the current architecture is clean, maintainable, and serves both embedded and server use cases effectively.

