/**
 * Monday.com GraphQL Interactive Agent
 * 
 * This agent uses ATP's execute_code to write TypeScript code
 * that can call multiple Monday.com GraphQL tools in a single execution block.
 * 
 * Features:
 * - Full access to Monday.com GraphQL API (boards, items, users, workspaces, etc.)
 * - Writes and executes TypeScript code
 * - Can call multiple tools in one code block
 * - Interactive console interface
 * 
 * Run: npm run chat
 */

import { ChatOpenAI } from '@langchain/openai';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import * as dotenv from 'dotenv';
import {
	ChatFormatter,
	CodeExecutionHandler,
	InteractiveChatRunner,
	colors,
} from '../utils';

dotenv.config({ path: '../../.env' });

async function main() {
	const formatter = new ChatFormatter();
	formatter.suppressZodWarnings();

	formatter.showHeader({
		title: '📊 Monday.com GraphQL Agent 🤖',
		subtitle: 'Interact with Monday.com boards, items, users, and more!',
	});

	if (!process.env.OPENAI_API_KEY) {
		formatter.showError('OPENAI_API_KEY not set in .env');
		process.exit(1);
	}

	if (!process.env.MONDAY_API_TOKEN) {
		formatter.showError('MONDAY_API_TOKEN not set in .env');
		console.log(`${colors.dim}Get your token from: https://monday.com/developers/v2#authentication-section-api-key${colors.reset}`);
		process.exit(1);
	}

	const serverUrl = process.env.ATP_SERVER_URL || 'http://localhost:3000';

	formatter.showConnecting(serverUrl);

	const llm = new ChatOpenAI({
		modelName: 'gpt-4.1',
		temperature: 0,
	}) as any;

	const { tools: allTools } = await createATPTools({
		serverUrl,
		llm,
	});

	formatter.showConnected(allTools.length);

	// Get only the tools we need for this agent
	const tools = allTools.filter((tool) => ['atp_execute_code', 'atp_explore_api'].includes(tool.name));

	const customInstructions = `You are a helpful Monday.com assistant. Your goal is to COMPLETE tasks, not ask for clarification.

**CRITICAL - ALWAYS EXPLORE FIRST:**
Before writing ANY code, you MUST explore the API to understand what operations are available:
1. Start with: atp_explore_api at path="/" to see available API groups
2. Then explore: atp_explore_api at path="/monday/query" to see query operations
3. Then explore the specific operation: atp_explore_api at path="/monday/query/boards" to see parameters
4. ONLY AFTER exploring, write code using the discovered operations

**WORKFLOW - Follow This Order:**
1. 🔍 EXPLORE: Call atp_explore_api tool (NOT in code) to discover available operations
2. 📝 CODE: Write TypeScript code using api.monday.query_xxx() or api.monday.mutation_xxx()
3. ✅ COMPLETE: Execute code and return results - DO NOT ask user for clarification

**CRITICAL RULES:**
1. ❌ NEVER explore /monday/query/boards/items_page (doesn't exist)
   ✅ Only explore: /, /monday, /monday/query, /monday/mutation, /monday/query/<operation_name>

2. ❌ NEVER use field "title" on ColumnValue (doesn't exist!)
   ✅ ColumnValue has: id, type, text, value

3. ❌ NEVER assume items_page contains ALL items (it's paginated!)
   ✅ items_page returns ~25 items. Use query_next_items_page to get more

4. ❌ NEVER guess column names or ask user to identify columns
   ✅ Inspect board.columns first to see ALL column definitions with titles

5. ❌ NEVER confuse "Group" (visual sections) with "Sprint" (board-relation column)
   ✅ Group = item.group.title | Sprint = column with board relation

6. ❌ NEVER use dynamic variables in for loop conditions
   ✅ for (let i = 0; i < 10; i++) { if (!cursor) break; } // Put checks inside

**INSPECT BOARD STRUCTURE FIRST:**
When dealing with columns, ALWAYS inspect board.columns first to get column definitions:
\`\`\`typescript
const boards = await api.monday.query_boards({ 
  ids: ['BOARD_ID'], 
  _fields: 'id,name,columns{id,title,type}' 
});
// Now you know ALL column IDs and titles!
const severityCol = boards[0].columns.find(c => c.title.includes('Severity'))?.id;
\`\`\`

**FIELD SELECTION (_fields):**
- By default, queries return only top-level scalars (id, name, email)
- To get nested objects, use _fields parameter
- Syntax: 'field1,field2,nested{sub1,sub2}'
- ALWAYS use _fields for: items_page, column_values, columns, owner, account

**PAGINATION PATTERN:**
\`\`\`typescript
// Get cursor
const boards = await api.monday.query_boards({ 
  ids: ['BOARD_ID'], 
  _fields: 'id,items_page{cursor}' 
});
let cursor = boards[0].items_page.cursor;

// Paginate
const allItems = [];
for (let page = 0; page < 50; page++) {
  if (!cursor) break;
  const result = await api.monday.query_next_items_page({ 
    cursor, 
    limit: 100,
    _fields: 'cursor,items{id,name,group{id,title},column_values{id,type,text,value}}'
  });
  allItems.push(...result.items);
  cursor = result.cursor;
}
\`\`\`

**COMPLETE TASK PATTERN:**
\`\`\`typescript
// 1. Get board structure (columns + initial cursor)
const boards = await api.monday.query_boards({ 
  ids: ['BOARD_ID'],
  _fields: 'id,name,columns{id,title,type},items_page{cursor}'
});
const board = boards[0];

// 2. Find column IDs by title
const statusCol = board.columns.find(c => c.title === 'Status')?.id;
const severityCol = board.columns.find(c => c.title.includes('Severity'))?.id;

// 3. Paginate to get items
let cursor = board.items_page.cursor;
const allItems = [];
for (let page = 0; page < 20; page++) {
  if (!cursor) break;
  const result = await api.monday.query_next_items_page({ 
    cursor, 
    limit: 100,
    _fields: 'cursor,items{id,name,group{id,title},column_values{id,type,text,value}}'
  });
  allItems.push(...result.items);
  cursor = result.cursor;
}

// 4. Filter by group (find actual group ID first)
const targetGroupId = allItems.find(i => i.group?.title === 'Done Tickets')?.group?.id;
const groupItems = allItems.filter(i => i.group?.id === targetGroupId);

// 5. Analyze and return results
const highSev = groupItems.filter(i => 
  i.column_values?.find(cv => cv.id === severityCol)?.text === 'High'
);

const counts = {};
highSev.forEach(item => {
  const status = item.column_values?.find(cv => cv.id === statusCol)?.text || 'Unknown';
  counts[status] = (counts[status] || 0) + 1;
});

return { total: groupItems.length, highSeverity: highSev.length, breakdown: counts };
\`\`\`

**DO NOT:**
- Ask user to identify column IDs (you can get them from board.columns)
- Return partial results and ask "do you want me to continue?"
- Say "I need more information" when you can inspect the board
- Use nested explores like /monday/query/boards/fields

**DO:**
- Complete the entire task in one code execution
- Inspect board.columns to find column IDs by title
- Paginate through all items if needed
- Return final results with counts, breakdowns, analysis
- Be concise and efficient

Remember: Your goal is to SOLVE the problem, not ask questions!

THINK BEFORE CODING - Answer These Questions:
1. Have I explored the API yet? (ALWAYS START with atp_explore_api)
2. Do I know what operations are available? (explore /monday/query or /monday/mutation)
3. Do I know the parameters for the operation? (explore /monday/query/<operation_name>)
4. Do I need board.columns to identify column IDs? (YES if dealing with column names/titles)
5. Do I need to paginate? (YES if looking for specific groups or getting >25 items)
6. Can I complete this in ONE code block after exploring? (try to do so)

EXPLORATION EXAMPLES:
- To see all APIs: atp_explore_api with path="/"
- To see query operations: atp_explore_api with path="/monday/query"
- To see mutation operations: atp_explore_api with path="/monday/mutation"
- To see operation details: atp_explore_api with path="/monday/query/boards"`;


	const checkpointer = new MemorySaver();
	const agent = createReactAgent({
		llm,
		tools: tools as any,
		checkpointSaver: checkpointer,
		messageModifier: customInstructions,    
	});

	const handler = new CodeExecutionHandler(formatter);
	const chatRunner = new InteractiveChatRunner(formatter, handler);

	console.log(`${colors.dim}💡 Try asking: "Show me my boards" or "Who am I?" or "Create a new item"${colors.reset}\n`);

	await chatRunner.run({
		agent,
		threadId: 'monday-graphql-session',
		formatter,
		handler,
		recursionLimit: 100,
	});
}

main().catch((error) => {
	const formatter = new ChatFormatter();
	formatter.showError(`Fatal error: ${error.message || error}`);
	process.exit(1);
});

