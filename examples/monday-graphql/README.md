# Monday.com GraphQL Agent Example

This example demonstrates how to use the Agent Tool Protocol (ATP) server to expose the Monday.com GraphQL API as agent tools.

## Features

- **GraphQL Integration**: Automatically converts GraphQL queries and mutations into ATP tools.
- **Introspection**: Fetches schema directly from Monday.com API.
- **Explorer Support**: Hierarchical navigation of queries and mutations (e.g., `query/users`, `mutation/create_item`).
- **Interactive Agent**: Chat-based interface with AI assistant that can execute Monday.com operations.
- **Code Execution**: Write and execute TypeScript code that calls multiple Monday.com tools.

## Prerequisites

- Node.js 18+
- A Monday.com API Token (get it from your Profile > Developer > API)
- OpenAI API Key (for the interactive agent)

## Setup

1. Install dependencies (from root):
   ```bash
   yarn install
   ```

2. Create a `.env` file in the project root with:
   ```bash
   MONDAY_API_TOKEN=your_monday_token_here
   OPENAI_API_KEY=your_openai_key_here
   ```

   Or set environment variables:
   ```bash
   export MONDAY_API_TOKEN=your_token_here
   export OPENAI_API_KEY=your_openai_key_here
   ```

## Running

### Option 1: Interactive Agent (Recommended)

Start the ATP server in one terminal:
```bash
cd examples/monday-graphql
yarn start
```

Then run the interactive agent in another terminal:
```bash
cd examples/monday-graphql
yarn chat
```

**Debug Mode** - To see the actual GraphQL queries being generated:
```bash
cd examples/monday-graphql
yarn start:debug     # Start server with query logging

# In another terminal
yarn chat:debug      # Run agent with query logging
```

The interactive agent provides a chat interface where you can:
- Ask natural language questions about your Monday.com workspace
- Execute operations like creating boards, items, updates
- Query users, workspaces, boards, and more
- Get help and guidance on API usage

Example queries:
- "Show me my boards"
- "Who am I?"
- "List all users in my workspace"
- "Create a new item called 'Review Q4 metrics' in board 123456"

### Option 2: Simple Script Agent

Run the basic example script:
```bash
cd examples/monday-graphql
yarn agent
```

This runs a pre-defined script that fetches boards and items.

### Option 3: Start Server Only

```bash
cd examples/monday-graphql
yarn start
```

## Usage

Once running, the server exposes the Monday.com API tools. You can explore them using the Explorer API:

- List all APIs: `http://localhost:3000/api/explore?path=/`
- List Queries: `http://localhost:3000/api/explore?path=/graphql/monday/query`
- List Mutations: `http://localhost:3000/api/explore?path=/graphql/monday/mutation`

Example tool usage (via ATP client):

```typescript
// Fetch users
const users = await client.execute('monday', 'query_users', { limit: 10 });

// Create an item
const newItem = await client.execute('monday', 'mutation_create_item', {
  board_id: 123456,
  item_name: "New Task"
});
```

## Available Operations

The integration provides access to 218 GraphQL operations including:

- **Boards**: query_boards, mutation_create_board, mutation_update_board, mutation_archive_board
- **Items**: query_items, mutation_create_item, mutation_update_item, mutation_archive_item
- **Users**: query_users, query_me
- **Workspaces**: query_workspaces, mutation_create_workspace
- **Groups**: mutation_create_group, mutation_update_group
- **Columns**: mutation_create_column, mutation_update_column, mutation_change_column_value
- **Updates**: query_updates, mutation_create_update
- And many more!

## Type Safety

All operations are fully typed with TypeScript interfaces generated from the GraphQL schema. Your IDE will provide autocomplete and type checking for:
- Input parameters
- Output types
- Nested objects
- Enums (e.g., board states, board kinds)

