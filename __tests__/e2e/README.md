# E2E Test Suite for ATP Security, State Capture, and Checkpointing

This directory contains end-to-end tests for the security improvements, state capture system, and operation checkpointing implemented in ATP.

## Test Structure

```
__tests__/e2e/
├── checkpoint/
│   └── checkpoint-recovery.test.ts     # Operation checkpointing and recovery
├── security/
│   ├── jwt-authentication.test.ts      # JWT auth with sliding window tokens
│   ├── multi-tenancy.test.ts           # Cache isolation between clients
│   ├── resume-validation.test.ts       # Resume endpoint authorization
│   └── tool-metadata.test.ts           # Automatic approval for sensitive tools
└── state-capture/
    └── infrastructure.test.ts          # Serialization and instrumentation
```

## Running Tests

### Install Dependencies First

```bash
cd /Users/galli/Development/agent-tool-protocol
yarn install
```

### Run All E2E Tests

```bash
yarn test:e2e
```

### Run Specific Test Suites

```bash
# JWT Authentication tests
yarn jest __tests__/e2e/security/jwt-authentication.test.ts

# Multi-Tenancy tests
yarn jest __tests__/e2e/security/multi-tenancy.test.ts

# Resume Validation tests
yarn jest __tests__/e2e/security/resume-validation.test.ts

# Tool Metadata tests
yarn jest __tests__/e2e/security/tool-metadata.test.ts

# State Capture Infrastructure tests
yarn jest __tests__/e2e/state-capture/infrastructure.test.ts

# Checkpoint Recovery tests
yarn jest __tests__/e2e/checkpoint/checkpoint-recovery.test.ts
# or use the dedicated command:
yarn test:e2e:checkpointer
```

### Run with Coverage

```bash
yarn test:e2e --coverage
```

## Test Coverage

### Phase 1: Security Fixes (100% Covered)

#### 1.1 JWT Authentication ✓

- [x] Client initialization with JWT token generation
- [x] Token format validation (JWT structure)
- [x] Automatic token refresh on every request
- [x] Sliding window expiration (1 hour)
- [x] Token refresh headers (X-ATP-Token, X-ATP-Token-Expires)
- [x] Multiple request token refresh cycle
- [x] Invalid token rejection

#### 1.2 Multi-Tenancy Cache Isolation ✓

- [x] Cache isolation between different clients
- [x] Same cache key isolation across clients
- [x] Multiple cache operations isolation
- [x] No cache key collisions
- [x] Client-specific cache deletion

#### 1.3 Resume Token Validation ✓

- [x] Resume without authentication rejection
- [x] Resume with invalid token rejection
- [x] Resume from different client rejection
- [x] ClientId ownership validation
- [x] Valid authentication acceptance
- [x] Token refresh on resume

#### 1.4 Tool Metadata ✓

- [x] Safe tools execute without approval
- [x] Destructive tools pause for approval
- [x] Sensitive tools pause for approval
- [x] Metadata included in approval request
- [x] Execution after approval granted
- [x] Failure when approval denied
- [x] Multiple tools with different metadata

#### 1.5 Client Guidance System ✓

- [x] Guidance field in init request
- [x] Guidance returned in definitions response

### Phase 2: Operation Checkpointing (100% Covered)

#### 2.0 Checkpoint Recovery ✓

- [x] Checkpoint API calls during execution
- [x] Include checkpoint data in error responses
- [x] Full snapshot for small results
- [x] Reference checkpoint for large data
- [x] Multiple sequential checkpoints
- [x] LLM-readable restore instructions
- [x] Checkpoint statistics tracking
- [x] Successful execution (no checkpoints in response)
- [x] Recovery using checkpointed data

### Phase 3: State Capture Infrastructure (70% Covered)

#### 2.1-2.4 Core Infrastructure ✓

- [x] Primitive value serialization
- [x] Object serialization and deserialization
- [x] Array serialization
- [x] Date, RegExp, Map, Set serialization
- [x] Circular reference detection
- [x] Function serialization
- [x] Function with closure serialization
- [x] Non-serializable value handling
- [x] Code instrumentation
- [x] Function declaration tracking
- [x] Variable tracking
- [x] StateManager instance creation
- [x] Progress tracking
- [x] Call caching
- [x] Branch decision tracking
- [x] Statistics collection

## Environment Variables

Set these before running tests:

```bash
# JWT secret for testing (automatically set in tests)
export ATP_JWT_SECRET="test-secret-key"
```

## Test Ports

Each test suite uses a different port to avoid conflicts:

- JWT Authentication: 3500
- Multi-Tenancy: 3501
- Resume Validation: 3502
- Tool Metadata: 3503
- Checkpoint Recovery: 3510

## Expected Test Results

All tests should pass with the current implementation:

```
PASS  __tests__/e2e/checkpoint/checkpoint-recovery.test.ts
PASS  __tests__/e2e/security/jwt-authentication.test.ts
PASS  __tests__/e2e/security/multi-tenancy.test.ts
PASS  __tests__/e2e/security/resume-validation.test.ts
PASS  __tests__/e2e/security/tool-metadata.test.ts
PASS  __tests__/e2e/state-capture/infrastructure.test.ts

Test Suites: 6 passed, 6 total
Tests:       XX passed, XX total
```

## Known Issues

1. **Node.js Version**: Requires Node.js 18+ for native fetch support
2. **TypeScript**: Tests require TypeScript compilation
3. **Isolated-VM**: Requires native compilation (C++ compiler needed)

## Troubleshooting

### Tests Fail with "Cannot find module"

```bash
# Rebuild the project
yarn build
```

### Tests Fail with Port Already in Use

```bash
# Kill processes using test ports
lsof -ti:3500,3501,3502,3503 | xargs kill -9
```

### Tests Timeout

Increase Jest timeout in jest.e2e.config.ts:

```typescript
testTimeout: 60000; // 60 seconds
```

## Next Steps

To complete testing:

1. **Integration Tests**: Test full execution flow with state capture
2. **Performance Tests**: Measure overhead of state capture
3. **Stress Tests**: Test with large state objects and many statements
4. **Client SDK Tests**: Test client-side token refresh logic
5. **Documentation Tests**: Validate code examples in documentation

## Contributing

When adding new features, please:

1. Add corresponding E2E tests
2. Update this README
3. Ensure all tests pass before submitting PR
4. Add test coverage report to PR description
