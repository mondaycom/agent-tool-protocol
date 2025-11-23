#!/bin/bash
# Start Code Execution Agent with ATP Server
# This script starts the ATP server in the background and then runs the code execution agent

set -e

echo "🚀 Starting Google Calendar Code Execution Agent (ATP)"
echo "======================================================"
echo ""

# Get the project root directory (parent of atp folder)
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Load .env file if it exists
if [ -f .env ]; then
    echo "📝 Loading environment from .env..."
    export $(grep -v '^#' .env | xargs)
fi

# Check if .env exists in auth folder
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found in project root"
    echo "   Please create .env file (see auth/env.example)"
    exit 1
fi

# Check if OAuth credentials are set
if [ -z "$GOOGLE_OAUTH_CREDENTIALS" ]; then
    echo "❌ Error: GOOGLE_OAUTH_CREDENTIALS not set in .env"
    echo "   Please add it to your .env file"
    exit 1
fi

# Check if OpenAI API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Error: OPENAI_API_KEY not set in .env"
    echo "   Please add it to your .env file"
    exit 1
fi

echo "✅ Environment variables loaded"
echo ""

# Start ATP server in background
echo "🔧 Starting ATP server in background..."
NODE_OPTIONS='--no-node-snapshot' npx tsx atp/mcp-server.ts > atp/server.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to start (checking for up to 20 seconds)..."
SERVER_READY=false
for i in {1..40}; do
    sleep 0.5
    
    # Check if port 3334 is listening
    if lsof -i :3334 > /dev/null 2>&1; then
        SERVER_READY=true
        echo "✅ Server is listening on port 3334"
        break
    fi
    
    # Check if process died
    if ! ps -p $SERVER_PID > /dev/null 2>&1; then
        echo "❌ Server process died. Last 30 lines of atp/server.log:"
        echo ""
        tail -30 atp/server.log
        exit 1
    fi
done

if [ "$SERVER_READY" = false ]; then
    echo "❌ Server didn't start in time. Check atp/server.log:"
    echo ""
    tail -50 atp/server.log
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo "✅ Server started successfully (PID: $SERVER_PID)"
echo ""

# Cleanup function to stop server on exit
cleanup() {
    echo ""
    echo "🛑 Stopping ATP server and all child processes..."
    # Kill the entire process group
    pkill -P $SERVER_PID 2>/dev/null || true
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    echo "✅ Cleanup complete"
}

trap cleanup EXIT INT TERM

# Run the code execution agent
echo "🤖 Starting Code Execution Agent..."
echo "======================================================"
echo ""
export NODE_OPTIONS='--no-node-snapshot'
npx tsx atp/code-execution-agent.ts

# Cleanup will run automatically via trap

