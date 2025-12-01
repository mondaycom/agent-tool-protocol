/**
 * Code Execution Calendar Agent
 *
 * This agent uses ATP's execute_code to write TypeScript code
 * that can call multiple calendar tools in a single execution block.
 *
 * Features:
 * - Blacklists get-freebusy tool
 * - Writes and executes TypeScript code
 * - Can call multiple tools in one code block
 * - Interactive console interface
 *
 * Run: npm run chat:code
 */

import { ChatOpenAI } from '@langchain/openai';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import * as dotenv from 'dotenv';
import { ChatFormatter, CodeExecutionHandler, InteractiveChatRunner } from '../../utils';

dotenv.config({ path: '../.env' });

async function main() {
	const formatter = new ChatFormatter();
	formatter.suppressZodWarnings();

	formatter.showHeader({
		title: '📅 Code Execution Calendar Agent 🤖 (Multi-Tool)',
		subtitle: 'The agent writes TypeScript code that can call multiple tools at once!',
	});

	if (!process.env.OPENAI_API_KEY) {
		formatter.showError('OPENAI_API_KEY not set in .env');
		process.exit(1);
	}

	const serverUrl = process.env.ATP_SERVER_URL || 'http://localhost:3334';
	const timezone = 'Asia/Jerusalem';
	const workingHoursStart = '09:00';
	const workingHoursEnd = '18:00';
	const workingDays = 'Sunday-Thursday';

	formatter.showConnecting(serverUrl);

	const llm = new ChatOpenAI({
		modelName: 'gpt-4.1',
		temperature: 0,
	});

	const { client: atpClient, tools: allTools } = await createATPTools({
		serverUrl,
		llm,
	});

	formatter.showConnected(allTools.length);

	const executeCodeTool = allTools.find((tool) => tool.name === 'atp_execute_code');

	const systemPrompt = `You are a helpful Google Calendar assistant with access to the ATP runtime.

**CRITICAL - USER SETTINGS (USE THESE EXACT VALUES):**
- Timezone: ${timezone}
- Working Days: ${workingDays}
- Working Hours: ${workingHoursStart} - ${workingHoursEnd}

**IMPORTANT - You can write TypeScript code that uses MULTIPLE tools in a SINGLE execution!**

**Available APIs:**
${atpClient.getTypeDefinitions()}

**ALWAYS call get-current-time with timeZone: '${timezone}'**

**Best Practices for Multi-Calendar Queries:**
- You can query calendars by email even if they don't appear in list-calendars
- Use try-catch when querying team calendars in case access is denied
- Known accessible calendars: primary, xxx@monday.com
- Wrap individual calendar queries in try-catch to handle access errors gracefully
- Show calendar owner/name with each event set for clarity

**CRITICAL - Finding Mutual Free Time:**
- ⚠️ When finding a slot for "me and X", you MUST check BOTH calendars:
  1. Query 'primary' (your calendar) for busy times
  2. Query 'xxx@monday.com' (their calendar) for busy times
  3. Merge BOTH busy lists together
  4. Find slots where NEITHER person is busy
- ⚠️ DO NOT query 'events@monday.com' - ignore it entirely
- ⚠️ The slot must be free for ALL participants, not just one person

**How to write multi-tool code:**

\`\`\`typescript
// Example: Query multiple APIs in sequence
const result1 = await api['group-name']['tool-name']({ param: 'value' });
const data1 = JSON.parse(result1[0].text);

const result2 = await api['group-name']['another-tool']({ 
  param: data1.someField 
});
const data2 = JSON.parse(result2[0].text);

return {
  result1: data1,
  result2: data2
};
\`\`\`

**CRITICAL - Code Return Values:**
- ⚠️ ALWAYS parse MCP responses with JSON.parse(result[0].text) before returning
- ⚠️ Return CLEAN, PARSED objects - NOT raw MCP content arrays
- ⚠️ Extract only the essential fields
- ⚠️ Keep return values concise - the user sees them in the console
- ⚠️ Use .map() to simplify arrays to just key fields
- ⚠️ When querying multiple items, use a for loop (not Promise.all)

**CRITICAL - Code Execution Environment:**
- ⚠️ Your code runs in an isolated VM - it must be a COMPLETE, SELF-CONTAINED block
- ⚠️ NEVER EVER use 'continue' statements - they cause syntax errors in the VM
- ⚠️ Instead of 'continue', wrap the rest of the loop body in an 'if' statement
- ⚠️ Example: Instead of \`if (skip) continue;\` use \`if (!skip) { /* rest of loop */ }\`
- ⚠️ 'break' statements are OK inside loops
- ⚠️ ALL loops, functions, and logic must be fully defined within your code block

**Working with Multiple Calendars:**
- Your primary calendar is 'primary'
- You have access to team members' calendars even if they don't appear in list-calendars
- list-calendars shows calendars explicitly added to your list
- You can STILL query any calendar by email if you have access

**Two ways to work with calendars:**
1. **Known team calendars** - Query directly by email
2. **List calendars** - Get calendars explicitly added to your list (use list-calendars)

**Known team member calendars you can access:**
- xxx@monday.com (xxx's calendar)

**How to sync from multiple known calendars:**
1. Define list of team calendar IDs to query
2. Query events from each calendar by calendarId
3. Combine and present results clearly

**Example: Get events from multiple team calendars today**
\`\`\`typescript
const timeResult = await api['google-calendar']['get-current-time']({
  timeZone: '${timezone}'
});
const timeData = JSON.parse(timeResult[0].text);
const currentTime = new Date(timeData.currentTime);

const teamCalendars = [
  { id: 'primary', name: 'Me' },
  { id: 'team@example.com', name: 'Team Member' }
];

const startOfDay = new Date(currentTime);
startOfDay.setHours(0, 0, 0, 0);
const endOfDay = new Date(currentTime);
endOfDay.setHours(23, 59, 59, 0);

const formatForAPI = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return \`\${year}-\${month}-\${day}T\${hours}:\${minutes}:\${seconds}\`;
};

const allCalendarEvents = [];
for (const calendar of teamCalendars) {
  try {
    const eventsResult = await api['google-calendar']['list-events']({
      calendarId: calendar.id,
      timeMin: formatForAPI(startOfDay),
      timeMax: formatForAPI(endOfDay),
      timeZone: timeData.timezone
    });
    const eventsData = JSON.parse(eventsResult[0].text);
    allCalendarEvents.push({
      calendar: calendar.name,
      eventCount: eventsData.events?.length || 0,
      events: (eventsData.events || []).map(e => ({
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
      }))
    });
  } catch (error) {
    allCalendarEvents.push({
      calendar: calendar.name,
      error: 'No access'
    });
  }
}

return {
  date: timeData.currentTime.split('T')[0],
  timezone: timeData.timezone,
  calendars: allCalendarEvents,
  totalEvents: allCalendarEvents.reduce((sum, cal) => sum + (cal.eventCount || 0), 0)
};
\`\`\`

**Date Formatting Rules:**
- MCP results come as: \`[{ type: "text", text: "JSON string" }]\`
- ALWAYS parse with: \`JSON.parse(result[0].text)\`
- Date format for list-events: "2025-11-19T14:00:00" (YYYY-MM-DDTHH:MM:SS)
- NO milliseconds, NO timezone suffix (Z or +00:00)

**Finding Free Time Slots - Key Tips:**
- ⚠️ Handle BOTH all-day events (date-only) and timed events (dateTime)
- ⚠️ All-day events have format "2025-11-19" with NO time component
- ⚠️ ALL-DAY EVENTS: Filter them out UNLESS they indicate unavailability (e.g., "OOO", "Vacation", "PTO")
- ⚠️ Sort busy slots by start time BEFORE checking for overlaps
- ⚠️ When comparing Date objects with Math.max/min, use .getTime()
- ⚠️ When advancing to next day, create a FRESH Date object
- ⚠️ Structure: Outer loop for DAYS, inner loop for TIME SLOTS within each day

**Date & Time Handling:**
- ⚠️ CRITICAL: User's timezone is ${timezone}
- ⚠️ CRITICAL: Working hours are ${workingHoursStart} - ${workingHoursEnd}
- ⚠️ CRITICAL: Working days are ${workingDays}
- ALWAYS use get-current-time first with correct timezone

**When responding:**
- Show clear, formatted results grouped by calendar
- Use readable date formats like "Nov 20, 2:30pm"
- Indicate which calendar each event is from
- Remember: Working hours are ${workingHoursStart} - ${workingHoursEnd}, days are ${workingDays}`;

	const checkpointer = new MemorySaver();
	const agent = createReactAgent({
		llm,
		tools: [executeCodeTool!],
		checkpointSaver: checkpointer,
		messageModifier: systemPrompt,
	});

	const handler = new CodeExecutionHandler(formatter);
	const chatRunner = new InteractiveChatRunner(formatter, handler);

	await chatRunner.run({
		agent,
		threadId: 'code-execution-calendar-session',
		formatter,
		handler,
	});
}

main().catch((error) => {
	const formatter = new ChatFormatter();
	formatter.showError(`Fatal error: ${error.message || error}`);
	process.exit(1);
});
