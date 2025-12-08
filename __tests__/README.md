# Test Suite Documentation

This directory contains the Jest test suite for the Agent Tool Protocol.

## Structure

- **`__tests__/unit/`** - Unit tests for individual components
  - `runtime.test.ts` - Tests for HTTP client, cache, and logging
  - `executor.test.ts` - Tests for sandbox code execution
  - `search.test.ts` - Tests for API function search engine
  - `serializer.test.ts` - Tests for function serialization with closures
  - `serializer-dynamic.test.ts` - Tests for dynamic serializer features
  - `mcp-optional-fields.test.ts` - Tests for MCP schema optional field handling
  - `aggregator-optional-fields.test.ts` - Tests for TypeScript generation with optional fields

- **`__tests__/e2e/`** - End-to-end integration tests
  - `server.test.ts` - Full ATP server integration tests

## Running Tests

```bash
# Run all tests
yarn test

# Run unit tests only
yarn test:unit

# Run E2E tests only
yarn test:e2e

# Run tests in watch mode
yarn test:watch

# Run tests with coverage
yarn test:coverage
```

## Test Configuration

The test suite uses:

- **Jest** - Test framework
- **ts-jest** - TypeScript transformation
- **@jest/globals** - Modern Jest API
- Custom resolver for `.js` to `.ts` mapping

Configuration is in `jest.config.js` at the project root.

## Notes

- One HTTP POST test is skipped due to external API certificate issues
- E2E tests start an actual server on port 3334
- Tests use in-memory cache (no external dependencies)
- LLM calls are not executed in tests (no API keys required)
