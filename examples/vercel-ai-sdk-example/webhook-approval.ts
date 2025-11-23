import 'dotenv/config';
import express from 'express';
import { createATPTools } from '@mondaydotcomorg/atp-vercel-sdk';
import { openai } from '@ai-sdk/openai';

interface PendingApproval {
	message: string;
	context?: Record<string, unknown>;
	timestamp: number;
	resolve: (approved: boolean) => void;
}

const pendingApprovals = new Map<string, PendingApproval>();

async function webhookApprovalHandler(
	message: string,
	context?: Record<string, unknown>
): Promise<boolean> {
	const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

	console.log(`\n🔔 New approval request: ${approvalId}`);
	console.log('Message:', message);
	console.log('Webhook URL:', `http://localhost:3000/approve/${approvalId}`);

	return new Promise((resolve) => {
		pendingApprovals.set(approvalId, {
			message,
			context,
			timestamp: Date.now(),
			resolve,
		});

		setTimeout(() => {
			if (pendingApprovals.has(approvalId)) {
				console.log(`⏰ Approval ${approvalId} timed out - auto-denying`);
				pendingApprovals.delete(approvalId);
				resolve(false);
			}
		}, 60000);
	});
}

async function main() {
	const app = express();
	app.use(express.json());

	app.get('/approvals', (req, res) => {
		const approvals = Array.from(pendingApprovals.entries()).map(([id, approval]) => ({
			id,
			message: approval.message,
			context: approval.context,
			timestamp: approval.timestamp,
		}));
		res.json({ approvals });
	});

	app.post('/approve/:id', (req, res) => {
		const { id } = req.params;
		const { approved } = req.body;

		const approval = pendingApprovals.get(id);
		if (!approval) {
			return res.status(404).json({ error: 'Approval not found' });
		}

		console.log(`\n✅ Approval ${id}: ${approved ? 'APPROVED' : 'DENIED'}`);
		approval.resolve(approved === true);
		pendingApprovals.delete(id);

		res.json({ success: true, approved });
	});

	const server = app.listen(3000, () => {
		console.log('🌐 Webhook server listening on http://localhost:3000');
	});

	const model = openai('gpt-4o-mini');

	const { tools } = await createATPTools({
		serverUrl: process.env.ATP_SERVER_URL || 'http://localhost:3333',
		headers: {
			Authorization: `Bearer ${process.env.ATP_API_KEY || 'test-key'}`,
		},
		model,
		approvalHandler: webhookApprovalHandler,
	});

	console.log('✅ ATP Client connected with webhook-based approvals');
	console.log('📋 Available tools:', Object.keys(tools).join(', '));

	const { generateText } = await import('ai');

	console.log('\n🤖 Agent ready! Executing task that requires approval...\n');

	const result = await generateText({
		model,
		system: `You are a helpful assistant with access to ATP.
You can request approvals using atp.approval.request() in your code.`,
		prompt: `Use ATP to:
1. Generate a sensitive action (like deleting files or sending emails)
2. Request approval using atp.approval.request("Should I perform this sensitive action?")
3. Only proceed if approved
4. Return the result`,
		tools,
		maxSteps: 5,
	});

	console.log('\n📊 Agent Result:');
	console.log(JSON.stringify(result, null, 2));

	server.close();
	process.exit(0);
}

main().catch((error) => {
	console.error('❌ Error:', error);
	process.exit(1);
});

