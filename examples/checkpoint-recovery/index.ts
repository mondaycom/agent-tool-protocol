/**
 * Checkpoint Recovery with LangChain Agent
 * 
 * This example demonstrates how an LLM agent automatically uses checkpoint data
 * to recover from failures without re-executing expensive operations.
 * 
 * Flow:
 * 1. Agent attempts to fetch and analyze user data
 * 2. Code executes, checkpoints are created for expensive API calls
 * 3. Code fails during processing
 * 4. Agent receives error with checkpoint data
 * 5. Agent writes recovery code using __checkpoint.restore()
 * 6. Recovery succeeds without re-executing expensive APIs
 */

import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient, ExecutionStatus } from '@mondaydotcomorg/atp-client';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MemoryCache } from "@mondaydotcomorg/atp-providers";

// Set up environment
process.env.ATP_JWT_SECRET = process.env.ATP_JWT_SECRET || 'test-secret-key';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Check for OpenAI API key
if (!process.env.OPENAI_API_KEY) {
	console.error('❌ Error: OPENAI_API_KEY environment variable is required');
	console.error('Set it with: export OPENAI_API_KEY=your-api-key');
	process.exit(1);
}

async function main() {
	console.log('🤖 Checkpoint Recovery with LangChain Agent\n');
	console.log('This demonstrates how an AI agent uses checkpoint data to recover from failures.\n');

	// ========================
	// Setup ATP Server
	// ========================
	const cacheProvider = new MemoryCache();

	const server = new AgentToolProtocolServer({
		execution: {
			timeout: 60000,
			memory: 128 * 1024 * 1024,
			llmCalls: 20,
		},
		providers: {
			cache: cacheProvider,
		},
	});

	// Mock expensive API endpoints
	let apiCallCount = { users: 0, analytics: 0 };

	server.tool('fetchUsers', {
		description: 'Fetch users from the company database (expensive operation)',
		input: {
			department: 'string',
			limit: 'number'
		},
		handler: async (params: { department: string; limit: number }) => {
			apiCallCount.users++;
			console.log(`  📡 [API Call #${apiCallCount.users}] Fetching ${params.limit} users from ${params.department} department...`);
			await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate slow API

			return Array.from({ length: params.limit }, (_, i) => ({
				id: i + 1,
				name: `${params.department} User ${i + 1}`,
				email: `user${i + 1}@company.com`,
				department: params.department,
				salary: 50000 + Math.floor(Math.random() * 100000),
				performance: Math.random() > 0.5 ? 'excellent' : Math.random() > 0.3 ? 'good' : 'needs improvement',
				yearsOfService: Math.floor(Math.random() * 15) + 1,
			}));
		},
	});

	server.tool('fetchAnalytics', {
		description: 'Fetch detailed analytics for users (expensive operation)',
		input: {
			userIds: 'number[]'
		},
		handler: async (params: { userIds: number[] }) => {
			apiCallCount.analytics++;
			console.log(`  📡 [API Call #${apiCallCount.analytics}] Fetching analytics for ${params.userIds.length} users...`);
			await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate slow API

			return params.userIds.map(id => ({
				userId: id,
				projectsCompleted: Math.floor(Math.random() * 50),
				averageTaskTime: Math.floor(Math.random() * 240) + 10,
				collaborationScore: Math.floor(Math.random() * 100),
				customerSatisfaction: Math.random() * 5,
			}));
		},
	});

	await server.listen(3336);
	await new Promise((resolve) => setTimeout(resolve, 1000));

	console.log('✅ ATP Server started on http://localhost:3336\n');

	// ========================
	// Setup LangChain Agent
	// ========================
	const client = new AgentToolProtocolClient({
		baseUrl: 'http://localhost:3336',
	});
	await client.init({ name: 'checkpoint-agent', version: '1.0.0' });

	const llm = new ChatOpenAI({
		modelName: 'gpt-4o-mini',
		temperature: 0,
	});

	console.log('✅ LangChain Agent initialized\n');

	// ========================
	// ATTEMPT 1: Initial execution that will fail
	// ========================
	console.log('=' .repeat(70));
	console.log('ATTEMPT 1: Agent tries to analyze user data');
	console.log('=' .repeat(70) + '\n');

	const task = `
Analyze the engineering department's performance:
1. Fetch all users from the engineering department (limit: 120)
2. Fetch detailed analytics for the top 10 users
3. Calculate average metrics and identify top performers
4. Return a summary report
`.trim();

	console.log('📝 Task:', task);
	console.log('\n🤖 Agent: Let me write code to accomplish this...\n');

	// Agent's first attempt at solving the task
	const initialCode = `
// Fetch engineering users (expensive API call - will be checkpointed)
const users = await api.custom.fetchUsers({ department: "engineering", limit: 120 });

// Get top 10 by salary
const top10 = users
	.sort((a, b) => b.salary - a.salary)
	.slice(0, 10);

// Fetch analytics for top users (expensive API call - will be checkpointed)  
const analytics = await api.custom.fetchAnalytics({ 
	userIds: top10.map(u => u.id) 
});

// BUG: Intentional error - trying to access non-existent property
const avgMetrics = analytics.reduce((acc, a) => ({
	projects: acc.projects + a.projectsCompletedd.rr,  // Typo: 'projectsCompletedd' doesn't exist!
	avgTime: acc.avgTime + a.averageTaskTime,
	collaboration: acc.collaboration + a.collaborationScore,
}), { projects: 0, avgTime: 0, collaboration: 0 });

return {
	totalUsers: users.length,
	analyzedUsers: top10.length,
	avgMetrics
};
	`.trim();

	console.log('💻 Generated Code:');
	console.log('─'.repeat(70));
	console.log(initialCode);
	console.log('─'.repeat(70) + '\n');

	const result1 = await client.execute(initialCode);

	if (result1.status === ExecutionStatus.FAILED) {
		console.log('\n❌ Execution Failed!');
		console.log('Error:', result1.error?.message);

		if (result1.error?.checkpointData) {
			const { checkpoints, stats, restoreInstructions } = result1.error.checkpointData;

			console.log('\n' + '='.repeat(70));
			console.log('📊 CHECKPOINT DATA AVAILABLE');
			console.log('='.repeat(70));
			console.log(`\n✅ ${stats.total} expensive operations were checkpointed:`);
			console.log(`   - Full Snapshots: ${stats.fullSnapshots}`);
			console.log(`   - References: ${stats.references}`);
			console.log(`   - Total Size: ${Math.round(stats.totalSizeBytes / 1024)}KB\n`);

			checkpoints.forEach((cp, i) => {
				console.log(`${i + 1}. ${cp.operation}`);
				console.log(`   ID: "${cp.id}"`);
				console.log(`   Type: ${cp.type}`);
				console.log(`   Description: ${cp.description}`);
				if (cp.type === 'reference' && cp.reference) {
					console.log(`   Description: ${cp.reference.description}`);
					const preview = cp.reference.preview;
					if (Array.isArray(preview)) {
						console.log(`   Preview: ${JSON.stringify(preview.slice(0, 2))}`);
					} else {
						console.log(`   Preview: ${JSON.stringify(preview)}`);
					}
				}
				console.log('');
			});

			// ========================
			// ATTEMPT 2: Agent uses checkpoint data to recover
			// ========================
			console.log('='.repeat(70));
			console.log('ATTEMPT 2: Agent uses checkpoint data to recover');
			console.log('='.repeat(70) + '\n');

			console.log('🤖 Agent receives checkpoint data and restore instructions:');
			console.log('─'.repeat(70));
			console.log(restoreInstructions);
			console.log('─'.repeat(70) + '\n');

			// Prepare LLM prompt with checkpoint data
			const recoveryPrompt = `
You are a code execution agent. The previous code execution failed with this error:
${result1.error.message}

Original code:
${initialCode}

Available checkpoints:
${checkpoints.map(cp => `- ${cp.operation}: checkpoint id "${cp.id}"`).join('\n')}

Instructions:
${restoreInstructions}

Task: Fix the code.`.trim();

			console.log('🤖 Agent: Analyzing error and checkpoint data...\n');

			const response = await llm.invoke([
				new SystemMessage('You are a helpful code execution agent. Return only code, no markdown formatting, no explanations.'),
				new HumanMessage(recoveryPrompt),
			]);

			const recoveryCode = response.content.toString()
				.replace(/```typescript\n?/g, '')
				.replace(/```javascript\n?/g, '')
				.replace(/```\n?/g, '')
				.trim();

			console.log('💻 Agent Generated Recovery Code:');
			console.log('─'.repeat(70));
			console.log(recoveryCode);
			console.log('─'.repeat(70) + '\n');

			console.log('🔄 Executing recovery code...\n');

			// Execute the recovery code
			const result2 = await client.execute(recoveryCode);

			if (result2.status === ExecutionStatus.COMPLETED) {
				console.log('✅ RECOVERY SUCCESSFUL!\n');
				console.log('📊 Final Result:');
				console.log(JSON.stringify(result2.result, null, 2));

				console.log('\n' + '='.repeat(70));
				console.log('🎉 CHECKPOINT RECOVERY COMPLETE');
				console.log('='.repeat(70));
				console.log('\n✨ Key Achievements:');
				console.log(`   1. Expensive API calls executed only ONCE (initial attempt)`);
				console.log(`   2. Total API calls made: ${apiCallCount.users} fetchUsers, ${apiCallCount.analytics} fetchAnalytics`);
				console.log(`   3. Agent automatically used checkpoint data for recovery`);
				console.log(`   4. No re-execution of expensive operations`);
				console.log(`   5. Bug was fixed and task completed successfully`);
				console.log('\n💡 Without checkpoints: Would need 4 API calls (2 initial + 2 retry)');
				console.log('💡 With checkpoints: Only 2 API calls needed!');
				console.log('💡 Time saved: ~2 seconds (avoided 2 slow API calls)\n');
			} else {
				console.log('❌ Recovery also failed:', result2.error?.message);
			}
		} else {
			console.log('\n⚠️  No checkpoint data available');
		}
	} else {
		console.log('✅ Execution succeeded on first attempt (unexpected!)');
		console.log('Result:', JSON.stringify(result1.result, null, 2));
	}

	process.exit(0);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
