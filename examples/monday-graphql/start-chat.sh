#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}📊 Monday.com GraphQL Interactive Agent${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check for .env file
if [ ! -f "../../.env" ]; then
    echo -e "${RED}❌ Error: .env file not found in project root${NC}"
    echo ""
    echo "Please create a .env file with:"
    echo "  OPENAI_API_KEY=your_key_here"
    echo "  MONDAY_API_TOKEN=your_token_here"
    exit 1
fi

# Check for OPENAI_API_KEY
if ! grep -q "OPENAI_API_KEY=" ../../.env; then
    echo -e "${RED}❌ Error: OPENAI_API_KEY not found in .env${NC}"
    echo ""
    echo "Please add your OpenAI API key to .env"
    exit 1
fi

# Check for MONDAY_API_TOKEN
if ! grep -q "MONDAY_API_TOKEN=" ../../.env; then
    echo -e "${RED}❌ Error: MONDAY_API_TOKEN not found in .env${NC}"
    echo ""
    echo "Please add your Monday.com API token to .env"
    echo "Get it from: https://monday.com/developers/v2#authentication-section-api-key"
    exit 1
fi

# Check if server is running
if ! lsof -i :3000 >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  ATP Server not running on port 3000${NC}"
    echo ""
    echo -e "Starting server in background..."
    cd ../.. && yarn workspace monday-graphql-example start > /dev/null 2>&1 &
    SERVER_PID=$!
    echo -e "${GREEN}✓${NC} Server started (PID: $SERVER_PID)"
    echo ""
    echo -e "Waiting for server to be ready..."
    sleep 5
else
    echo -e "${GREEN}✓${NC} ATP Server is running"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Starting Interactive Agent...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}💡 Tips:${NC}"
echo -e "  • Try: 'Show me my boards'"
echo -e "  • Try: 'Who am I?'"
echo -e "  • Try: 'List the first 5 items'"
echo -e "  • Press Ctrl+C to exit"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Run the interactive agent
yarn chat

