# Checkpoint Recovery with LangChain Agent

This example demonstrates how an AI agent (using LangChain and OpenAI) automatically leverages ATP's checkpoint system to recover from failures without re-executing expensive operations.

## Overview

When code execution fails after expensive operations (API calls, database queries, LLM calls), ATP automatically:
1. ✅ **Checkpoints** the results of expensive operations
2. 📦 **Includes checkpoint data** in the error response
3. 🔄 **Enables recovery** using `__restore.checkpoint(id)`

This example shows a **realistic scenario** where an AI agent:
- Writes code to analyze company data
- The code fails due to a bug
- The agent receives checkpoint data and automatically writes recovery code
- Recovery succeeds without re-executing expensive API calls

## Prerequisites

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=your-api-key-here
```

## Running the Example

```bash
yarn start
```

## What Happens

### 1. Initial Execution (Fails)

The agent writes code to:
- Fetch 120 users from engineering department (expensive API call ~1s)
- Fetch analytics for top 10 users (expensive API call ~1s)
- Analyze and return results

**Result**: Code fails due to a typo (`projectsCompletedd` instead of `projectsCompleted`)

### 2. Checkpoint Data Captured

ATP automatically creates checkpoints:
```json
{
  "checkpoints": [
    {
      "id": "exec-123:op_L3_C15",
      "operation": "api.custom.fetchUsers",
      "type": "reference",
      "reference": {
        "description": "Array with 120 items from api.company.fetchUsers",
        "count": 120,
        "preview": [...]
      }
    },
    {
      "id": "exec-123:op_L12_C18",
      "operation": "api.custom.fetchAnalytics", 
      "type": "full_snapshot",
      "result": [...]
    }
  ],
  "stats": {
    "total": 2,
    "fullSnapshots": 1,
    "references": 1
  },
  "restoreInstructions": "..."
}
```

### 3. Agent Receives Checkpoint Data

The agent's LLM receives:
- The error message
- The original code
- **Checkpoint data** with restore instructions
- Clear guidance to use `__restore.checkpoint()`

### 4. Agent Writes Recovery Code

The LLM automatically generates recovery code:

```typescript
// Restore checkpointed data instead of re-executing!
const users = await __restore.checkpoint("exec-123:op_L3_C15");
const analytics = await __restore.checkpoint("exec-123:op_L12_C18");

// Fix the bug (correct property name)
const avgMetrics = analytics.reduce((acc, a) => ({
  projects: acc.projects + a.projectsCompleted,  // Fixed typo!
  avgTime: acc.avgTime + a.averageTaskTime,
  collaboration: acc.collaboration + a.collaborationScore,
}), { projects: 0, avgTime: 0, collaboration: 0 });

return {
  totalUsers: users.length,
  analyzedUsers: analytics.length,
  avgMetrics
};
```

### 5. Recovery Succeeds

✅ Task completes successfully without re-executing expensive APIs!

## Key Benefits Demonstrated

### 🚀 Performance

- **Without checkpoints**: 4 API calls (2 initial + 2 retry) = ~4 seconds
- **With checkpoints**: 2 API calls (initial only) = ~2 seconds
- **Time saved**: ~50%

### 💰 Cost Savings

- Avoids re-executing expensive operations
- Particularly valuable for:
  - Expensive API calls
  - LLM calls ($$$)
  - Database queries
  - Long-running computations

### 🤖 AI-Friendly

- Checkpoint data is LLM-readable
- Clear restore instructions
- Previews help LLM understand data structure
- Agent automatically knows how to use `__restore.checkpoint()`

### 🎯 Realistic Scenario

- Real LangChain agent
- Actual OpenAI LLM
- Realistic business task
- Common bug pattern (typo)
- Demonstrates end-to-end flow

## How It Works

### Automatic Checkpointing

ATP's compiler automatically transforms:

```typescript
const users = await api.custom.fetchUsers({ department: "engineering", limit: 120 });
```

Into:

```typescript
const users = await (async () => {
  const __result = await api.custom.fetchUsers({ department: "engineering", limit: 120 });
  __checkpoint.buffer("op_L3_C15", __result, { 
    type: "api",
    namespace: "api",
    group: "custom",
    method: "fetchUsers",
    params: { department: "engineering", limit: 120 }
  });
  return __result;
})();
```

### Checkpoint Types

1. **Full Snapshot**: Small results (< 10KB) stored directly
2. **Reference**: Large results with preview (first 3 items shown, full data available via restore)

### Restore API

```typescript
// Restore from checkpoint (works across executions)
const data = await __restore.checkpoint("exec-id:checkpoint-id");
```

### Preview System

For large arrays/objects, shows first 3 items/keys with proper nesting:

```json
{
  "preview": [
    {
      "id": 1,
      "name": "User 1",
      "department": "engineering",
      "...": "... and 6 more keys"
    },
    {
      "id": 2, 
      "name": "User 2",
      "department": "engineering",
      "...": "... and 6 more keys"
    },
    {
      "id": 3,
      "name": "User 3", 
      "department": "engineering",
      "...": "... and 6 more keys"
    }
  ],
  "...": "... and 117 more items"
}
```

## Configuration

Checkpointing is enabled by default. You can customize thresholds:

```typescript
const server = createServer({
  compiler: {
    enableOperationCheckpoints: true,
    checkpointConfig: {
      maxFullSnapshotSize: 10_000,  // 10KB threshold
      maxArrayItemsFull: 100,        // Arrays > 100 items = reference
      defaultTTL: 3600,              // 1 hour cache TTL
      previewSize: 3                 // Show first 3 items in preview
    }
  }
});
```

## Learn More

- Checkpoint data is buffered in memory and only persisted on error
- Checkpoint IDs include execution ID for cross-execution restore
- Full results are always available via `__restore.checkpoint()`
- Previews are purely for LLM understanding
- Both full snapshots and references are handled transparently

## Real-World Applications

This pattern is valuable for:
- **AI Agents**: Auto-recovery from execution failures
- **Data Pipelines**: Resume from failure point
- **Batch Processing**: Don't re-process successful batches
- **LLM Applications**: Avoid expensive re-computation
- **Development**: Faster iteration during debugging
