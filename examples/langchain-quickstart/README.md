# LangChain Agent Example

Demonstrates how to use ATP with LangChain/LangGraph to create autonomous agents that can interact with APIs.

## Features

- ✅ LangChain/LangGraph integration
- ✅ Autonomous agent decision-making
- ✅ OpenAPI/Swagger 2.0 support (Petstore API)
- ✅ Self-contained (no external server required)

## Usage

```bash
export OPENAI_API_KEY=sk-...
npm start
```

## What it does

1. Starts an ATP server with the Petstore API
2. Creates a LangChain agent with ATP tools
3. Gives the agent a task to fetch and analyze pets
4. The agent autonomously:
   - Decides which ATP tools to use
   - Generates and executes ATP code
   - Processes API responses
   - Returns a natural language summary

## Environment Variables

- `OPENAI_API_KEY` - **Required**: Your OpenAI API key

## Output

The agent will respond with information about available pets, including:

- Total count of available pets
- Example pet names from the API
