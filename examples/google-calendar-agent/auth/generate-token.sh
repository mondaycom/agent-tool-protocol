#!/bin/bash
# Helper script to generate OAuth token with proper environment setup

set -e

echo "🔐 Google Calendar OAuth Token Generator"
echo "========================================"
echo ""

# Check if .env exists
if [ -f .env ]; then
    echo "📄 Loading environment from .env..."
    export $(grep -v '^#' .env | grep GOOGLE_OAUTH_CREDENTIALS | xargs)
else
    echo "⚠️  No .env file found"
fi

# Check if GOOGLE_OAUTH_CREDENTIALS is set
if [ -z "$GOOGLE_OAUTH_CREDENTIALS" ]; then
    echo ""
    echo "❌ GOOGLE_OAUTH_CREDENTIALS not set"
    echo ""
    echo "Please provide the path to your OAuth credentials file:"
    echo ""
    read -p "Enter path to gcp-oauth.keys.json: " CRED_PATH
    
    if [ -z "$CRED_PATH" ]; then
        echo "❌ No path provided. Exiting."
        exit 1
    fi
    
    export GOOGLE_OAUTH_CREDENTIALS="$CRED_PATH"
fi

# Expand ~ if present
GOOGLE_OAUTH_CREDENTIALS="${GOOGLE_OAUTH_CREDENTIALS/#\~/$HOME}"

# Check if file exists
if [ ! -f "$GOOGLE_OAUTH_CREDENTIALS" ]; then
    echo ""
    echo "❌ OAuth credentials file not found:"
    echo "   $GOOGLE_OAUTH_CREDENTIALS"
    echo ""
    echo "📋 To get OAuth credentials:"
    echo "   1. Go to: https://console.cloud.google.com/apis/credentials"
    echo "   2. Create OAuth 2.0 Client ID (Desktop App)"
    echo "   3. Download the JSON file"
    echo "   4. Save it and provide the path"
    echo ""
    exit 1
fi

echo ""
echo "✅ Found OAuth credentials file:"
echo "   $GOOGLE_OAUTH_CREDENTIALS"
echo ""
echo "🌐 Opening browser for authentication..."
echo ""
echo "You will:"
echo "  1. Sign in with your Google account"
echo "  2. Grant calendar permissions"
echo "  3. See 'Authentication successful!' message"
echo ""
read -p "Press Enter to continue..."

# Run the auth command with proper environment
npx @cocal/google-calendar-mcp auth

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ Authentication successful!"
    echo "=========================================="
    echo ""
    echo "Token saved to:"
    echo "  ~/.config/google-calendar-mcp/tokens.json"
    echo ""
    echo "🎯 You can now:"
    echo "   • Run: npm test (test connection)"
    echo "   • Run: npm start (run the agent)"
    echo ""
else
    echo ""
    echo "❌ Authentication failed"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Ensure credentials are for 'Desktop App' type"
    echo "  2. Check your email is added as test user"
    echo "  3. Wait 5 minutes after adding test user"
    echo "  4. Try using Chrome/Edge browser"
    echo ""
    exit 1
fi

