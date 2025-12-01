# Authentication Setup

This folder contains authentication-related files for Google Calendar OAuth.

## Files

- **`env.example`**: Template for environment variables
- **`generate-token.sh`**: Script to generate OAuth tokens via browser

## Setup

1. **Copy the environment template to the project root:**

   ```bash
   # From the project root (google-calendar-agent/)
   cp auth/env.example .env
   ```

2. **Edit `.env` in the project root and add your credentials:**

   ```bash
   OPENAI_API_KEY=your-openai-api-key
   GOOGLE_OAUTH_CREDENTIALS=/path/to/gcp-oauth.keys.json
   ```

   Note: The `.env` file should be in the project root, not in the `auth/` folder.

3. **Generate OAuth token:**

   ```bash
   npm run auth
   ```

   This will:
   - Open your browser for Google OAuth consent
   - Save the token to `~/.config/google-calendar-mcp/tokens.json`

## Getting OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials (Desktop app type)
5. Download the credentials as `gcp-oauth.keys.json`
6. Set `GOOGLE_OAUTH_CREDENTIALS` to the file path in `.env`

## Token Storage

Tokens are stored in: `~/.config/google-calendar-mcp/tokens.json`

Both the MCP and ATP agents use the same token location.
