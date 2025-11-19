# Custom Compiler Examples

This directory demonstrates the **power of Dependency Injection** in the ATP compiler system.

## Overview

Thanks to the `ICompiler` interface and dependency injection architecture, you can:

✅ **Create custom compilers** without modifying core code  
✅ **Inject them directly** for testing or specific use cases  
✅ **Add them to the factory** for production use via env vars  
✅ **Combine multiple compilers** through composition

## Quick Example

```typescript
// 1. Implement ICompiler
class MyCompiler implements ICompiler {
	detect(code: string): DetectionResult {
		/* ... */
	}
	transform(code: string): TransformResult {
		/* ... */
	}
	getType(): string {
		return 'MyCompiler';
	}
	getCacheStats() {
		return null;
	}
}

// 2. Inject it
const compiler = new CompilerWrapper(new MyCompiler());

// 3. Use it
const result = await compiler.transform(code);
```

## Examples in this Directory

### 1. **TimeoutEnforcingCompiler**

Automatically adds timeout checks to all async functions.

**Use case**: Prevent runaway functions in serverless environments

```typescript
const compiler = new TimeoutCompilerAdapter({ timeout: 3000 });
const wrapper = new CompilerWrapper(compiler);
```

### 2. **PerformanceMonitoringCompiler**

Adds performance markers and metrics to code execution.

**Use case**: Track execution time of code segments

```typescript
const compiler = new PerformanceMonitoringCompiler();
const wrapper = new CompilerWrapper(compiler);
const metrics = compiler.getMetrics();
```

### 3. **MockCompiler**

Simple mock for testing purposes.

**Use case**: Unit tests without real compiler overhead

```typescript
it('should transform code', async () => {
	const mock = new MockCompiler();
	const compiler = new CompilerWrapper(mock);
	const result = await compiler.transform('test');
	expect(result.transformed).toBe(true);
});
```

## Adding to Production

To make your custom compiler available in production:

1. **Add to CompilerFactory** in `packages/server/src/executor/compiler-config.ts`:

```typescript
class CompilerFactory {
	static create(config): ICompiler {
		const compilerType = process.env.ATP_COMPILER_TYPE || 'atp';

		switch (compilerType) {
			case 'timeout':
				return new TimeoutCompilerAdapter(config);
			case 'performance':
				return new PerformanceMonitoringCompiler();
			case 'pluggable':
				return new PluggableCompilerAdapter(config);
			case 'atp':
			default:
				return new ATPCompilerAdapter(config);
		}
	}
}
```

2. **Use via environment variable**:

```bash
ATP_COMPILER_TYPE=timeout npm start
```

That's it! No other changes needed!

## Custom Compiler Ideas

Here are some ideas for custom compilers you could build:

### Security Enforcement

```typescript
class SecurityCompiler implements ICompiler {
	// Detect and block dangerous patterns
	// Add sandboxing
	// Enforce CSP headers
}
```

### Cost Tracking

```typescript
class CostTrackingCompiler implements ICompiler {
	// Track API calls
	// Calculate compute costs
	// Enforce budget limits
}
```

### Rate Limiting

```typescript
class RateLimitingCompiler implements ICompiler {
	// Add rate limit checks to API calls
	// Track usage per user
	// Throttle based on limits
}
```

### Memory Profiling

```typescript
class MemoryProfilingCompiler implements ICompiler {
	// Track memory allocations
	// Detect memory leaks
	// Add automatic cleanup
}
```

### A/B Testing

```typescript
class ABTestingCompiler implements ICompiler {
	// Run two different transformations
	// Compare performance
	// Automatically select best one
}
```

## Architecture Benefits

### Before (Hardcoded) ❌

- Adding new compiler = modify core code
- Testing = complex mocking
- Tight coupling
- Violates Open/Closed Principle

### After (Dependency Injection) ✅

- Adding new compiler = implement interface
- Testing = inject mock
- Loose coupling
- Follows SOLID principles

## See Also

- [DEPENDENCY-INJECTION-ARCHITECTURE.md](../../DEPENDENCY-INJECTION-ARCHITECTURE.md) - Full architecture docs
- [packages/server/src/executor/compiler-config.ts](../../packages/server/src/executor/compiler-config.ts) - Implementation
- [packages/atp-compiler/](../../packages/atp-compiler/) - Compiler packages

## Contributing

Want to add a new compiler example?

1. Implement `ICompiler` interface
2. Add your compiler to this directory
3. Document the use case
4. Submit a PR!

The architecture is designed to be **open for extension**, so we welcome new compiler implementations!
