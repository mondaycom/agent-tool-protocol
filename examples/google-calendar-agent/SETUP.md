# Google Calendar Agent Setup Guide

Complete step-by-step guide to get the Google Calendar scheduling agent running.

## Quick Setup Checklist

- [ ] Google Cloud project created
- [ ] Calendar API enabled
- [ ] OAuth credentials downloaded (Desktop app type)
- [ ] Test user added (your email)
- [ ] OpenAI API key obtained
- [ ] Environment variables configured
- [ ] Dependencies installed

## Detailed Setup Steps

### 1. Google Cloud Setup (15 minutes)

#### A. Create Project

1. Go to https://console.cloud.google.com
2. Click project dropdown (top left)
3. Click "New Project"
4. Name: `calendar-agent-demo` (or your choice)
5. Click "Create"

#### B. Enable Calendar API

1. Select your project from dropdown
2. Navigate to: "APIs & Services" > "Library"
3. Search: "Google Calendar API"
4. Click on it, then click "Enable"
5. Wait for activation (~30 seconds)

#### C. Configure OAuth Consent Screen

1. Go to: "APIs & Services" > "OAuth consent screen"
2. Select "External" user type
3. Click "Create"
4. Fill in required fields:
   - App name: `Calendar Agent Demo`
   - User support email: your email
   - Developer contact: your email
5. Click "Save and Continue"
6. **Scopes**: Click "Add or Remove Scopes"
   - Search and add:
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/calendar.events`
   - Click "Update"
7. Click "Save and Continue"
8. **Test users**: Click "Add Users"
   - Enter your email address
   - Click "Add"
   - Click "Save and Continue"
9. Review and click "Back to Dashboard"

⚠️ **Important**: Wait 2-5 minutes for test user to propagate before proceeding!

#### D. Create OAuth Credentials

1. Go to: "APIs & Services" > "Credentials"
2. Click "+ Create Credentials" > "OAuth client ID"
3. Application type: **Desktop app** (CRITICAL!)
4. Name: `Calendar Agent Desktop`
5. Click "Create"
6. Click "Download JSON" button
7. Save file as `gcp-oauth.keys.json` in a secure location
8. Note the file path (you'll need it for .env)

Example downloaded file location:

```
/Users/yourname/credentials/gcp-oauth.keys.json
```

#### E. Publish App (Optional - Avoids Weekly Re-auth)

1. Go to: "OAuth consent screen"
2. Click "PUBLISH APP" button
3. Confirm the dialog
4. Your app stays unverified but tokens won't expire after 7 days

### 2. OpenAI API Key (5 minutes)

1. Go to https://platform.openai.com/api-keys
2. Sign in or create account
3. Click "Create new secret key"
4. Name: `calendar-agent`
5. Copy the key (starts with `sk-`)
6. Save it securely (you won't see it again!)

### 3. Install Dependencies (5 minutes)

```bash
# From monorepo root
cd /Users/galli/Development/agent-tool-protocol-public

# Install all dependencies
yarn install

# Navigate to example
cd examples/google-calendar-agent
```

### 4. Configure Environment (2 minutes)

```bash
# Create .env file from template
cp env.example .env

# Edit .env with your favorite editor
nano .env
# or
code .env
```

Update these critical values in `.env`:

```bash
# Your OpenAI key
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx

# Absolute path to your downloaded OAuth credentials
GOOGLE_OAUTH_CREDENTIALS=/Users/yourname/credentials/gcp-oauth.keys.json

# Optional: Customize working hours and timezone
WORKING_HOURS_START=09:00
WORKING_HOURS_END=17:00
TIMEZONE=America/New_York
```

### 5. First Run & OAuth Flow (5 minutes)

#### Terminal 1: Start MCP Server

```bash
cd examples/google-calendar-agent
npm run server
```

Expected output:

```
🚀 Starting ATP Server with Google Calendar MCP Integration
✅ MCP Adapter created
📋 Available tools:
   • list-calendars
   • list-events
   • get-freebusy
   • create-event
   ...
✅ ATP Server running on http://localhost:3334
```

#### Terminal 2: Run Agent

```bash
# In a new terminal, same directory
npm start
```

**First time only**: OAuth authentication flow will begin:

1. Browser opens automatically to Google sign-in
2. Sign in with the email you added as test user
3. You'll see a warning: "Google hasn't verified this app"
   - Click "Advanced"
   - Click "Go to Calendar Agent Demo (unsafe)"
   - This is normal for test apps!
4. Review permissions and click "Allow"
5. Browser shows "Authentication successful!"
6. Return to terminal - agent continues automatically

**Subsequent runs**: Uses saved tokens, no browser needed!

### 6. Verify Success

You should see output like:

```
📅 Google Calendar Scheduling Agent
✅ Connected! Available tools: 7

📋 Calendar Tools:
   • list-calendars
   • get-freebusy
   • create-event
   ...

🎬 Agent execution started...

🤔 Agent Reasoning (Step 1):
I need to check calendar availability...

🔧 Tool Call: list-calendars
{
  "calendars": [
    {"id": "primary", "summary": "John Doe"}
  ]
}

🔧 Tool Call: get-freebusy
...

✅ Meeting scheduling completed!
```

## Troubleshooting

### "OAuth Credentials File Not Found"

```bash
# Check file exists
ls -la /path/to/gcp-oauth.keys.json

# Ensure path is absolute (starts with /)
# NOT relative like: ./gcp-oauth.keys.json
```

### Browser Shows "Access Blocked"

- **Cause**: Test user not added or not propagated yet
- **Fix**: Wait 5 more minutes, try again
- **Verify**: Google Cloud Console > OAuth consent screen > Test users

### Browser Shows "Something Went Wrong"

- **Cause**: Using wrong browser or credentials issue
- **Fix**: Try Chrome/Edge browser
- **Verify**: Credentials are for "Desktop App" type (not Web or Mobile)

### "User Rate Limit Exceeded"

- **Cause**: OAuth credentials missing project_id
- **Fix**: Re-download credentials from Google Cloud Console
- **Check**: File should contain `"project_id": "your-project"`

### Tokens Expire After 7 Days

- **Cause**: App in test mode
- **Solution 1**: Re-authenticate
  ```bash
  export GOOGLE_OAUTH_CREDENTIALS="/path/to/gcp-oauth.keys.json"
  npx @cocal/google-calendar-mcp auth
  ```
- **Solution 2**: Publish app (see step 1.E above)

### Port 3334 Already in Use

```bash
# Find what's using it
lsof -i :3334

# Kill the process or change port in .env
ATP_SERVER_URL=http://localhost:3335
# Then update mcp-server.ts port variable
```

### Agent Can't Find Available Slots

- **Check**: Do you have free time tomorrow?
- **Check**: Working hours match your schedule
- **Try**: Adjust `WORKING_HOURS_START/END` in .env

## Testing Your Setup

### Manual MCP Test (Without Agent)

```bash
# Terminal 1: Start server
npm run server

# Terminal 2: Test with curl
curl -X POST http://localhost:3334/tools/list \
  -H "Authorization: Bearer calendar-demo-token" \
  -H "Content-Type: application/json"

# Should return list of available calendar tools
```

### Quick Agent Test

Modify `agent.ts` to test specific functionality:

```typescript
// Test 1: Just list calendars
const userQuery = 'List all my Google calendars';

// Test 2: Check tomorrow's schedule
const userQuery = 'What events do I have tomorrow?';

// Test 3: Check availability
const userQuery = 'Am I free tomorrow at 2pm?';
```

## Next Steps

Once setup is complete:

1. **Experiment**: Modify meeting request in `agent.ts`
2. **Customize**: Adjust working hours, timezone
3. **Extend**: Add recurring meetings, multi-attendee support
4. **Production**: Consider publishing OAuth app for long-term tokens

## Files Reference

```
google-calendar-agent/
├── README.md           # Overview and usage
├── SETUP.md           # This file - detailed setup
├── package.json       # Dependencies
├── env.example        # Environment template
├── .env              # Your config (not in git)
├── mcp-server.ts     # ATP server + MCP wrapper
└── agent.ts          # LangChain agent logic
```

## Support

If you're still stuck:

1. Check [google-calendar-mcp issues](https://github.com/nspady/google-calendar-mcp/issues)
2. Review [ATP documentation](../../README.md)
3. Verify all prerequisites from checklist above

## Security Notes

- ✅ OAuth tokens stored locally only
- ✅ Credentials never leave your machine
- ✅ All API calls authenticated
- ⚠️ Keep `gcp-oauth.keys.json` secure (don't commit!)
- ⚠️ Add `.env` to `.gitignore`
