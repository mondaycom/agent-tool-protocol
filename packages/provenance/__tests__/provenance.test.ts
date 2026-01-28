/**
 * Tests for Provenance Tracking System
 */

import { describe, it, expect } from '@jest/globals';
import {
	createProvenanceProxy,
	getProvenance,
	hasProvenance,
	getAllProvenance,
	canRead,
	ProvenanceSource,
	SecurityPolicyEngine,
	preventDataExfiltration,
	requireUserOrigin,
	blockLLMRecipients,
} from '@mondaydotcomorg/atp-provenance';
import { log } from '@mondaydotcomorg/atp-runtime';

describe('ProvenanceProxy', () => {
	it('should wrap values with provenance metadata', () => {
		const data = { name: 'Alice', email: 'alice@company.com' };
		const wrapped = createProvenanceProxy(
			data,
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'public' }
		);

		expect(hasProvenance(wrapped)).toBe(true);

		const metadata = getProvenance(wrapped);
		expect(metadata).toBeDefined();
		expect(metadata?.source.type).toBe(ProvenanceSource.TOOL);
		if (metadata?.source.type === ProvenanceSource.TOOL) {
			expect(metadata.source.toolName).toBe('getUser');
		}
	});

	it('should preserve provenance through property access', () => {
		const data = { user: { name: 'Bob', details: { role: 'Admin' } } };
		const wrapped = createProvenanceProxy(
			data,
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getData',
				apiGroup: 'api',
				timestamp: Date.now(),
			},
			{ type: 'restricted', readers: ['admin@company.com'] }
		);

		const user = wrapped.user;
		expect(hasProvenance(user)).toBe(true);

		const metadata = getProvenance(user);
		expect(metadata?.source.type).toBe(ProvenanceSource.TOOL);
		if (metadata?.source.type === ProvenanceSource.TOOL) {
			expect(metadata.source.toolName).toBe('getData');
		}
		expect(metadata?.readers.type).toBe('restricted');
	});

	it('should track all provenance in nested objects', () => {
		const data = {
			field1: 'value1',
			nested: {
				field2: 'value2',
			},
		};

		const wrapped = createProvenanceProxy(
			data,
			{ type: ProvenanceSource.USER, timestamp: Date.now() },
			{ type: 'public' }
		);

		const allProvenance = getAllProvenance(wrapped);
		expect(allProvenance.length).toBeGreaterThan(0);
		expect(allProvenance?.[0]?.source?.type).toBe(ProvenanceSource.USER);
	});

	it('should handle reader permissions correctly', () => {
		const publicPermissions = { type: 'public' as const };
		const restrictedPermissions = {
			type: 'restricted' as const,
			readers: ['alice@company.com', 'bob@company.com'],
		};

		expect(canRead('anyone@anywhere.com', publicPermissions)).toBe(true);
		expect(canRead('alice@company.com', restrictedPermissions)).toBe(true);
		expect(canRead('attacker@evil.com', restrictedPermissions)).toBe(false);
	});
});

describe('SecurityPolicyEngine', () => {
	const logger = log.child({ test: 'security-policy' });

	it('should allow tools when policies pass', async () => {
		const engine = new SecurityPolicyEngine([preventDataExfiltration], logger);

		const args = {
			to: 'recipient@company.com',
			body: 'Public message',
		};

		await expect(engine.checkTool('sendEmail', 'email', args)).resolves.not.toThrow();
	});

	it('should block data exfiltration to unauthorized recipients', async () => {
		const engine = new SecurityPolicyEngine([preventDataExfiltration], logger);

		const sensitiveData = createProvenanceProxy(
			{ ssn: '123-45-6789', salary: 150000 },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUserData',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'restricted', readers: ['alice@company.com'] }
		);

		const args = {
			to: 'attacker@evil.com',
			body: sensitiveData,
		};

		await expect(engine.checkTool('sendEmail', 'email', args)).rejects.toThrow(/cannot read/i);
	});

	it('should enforce user origin for critical tools', async () => {
		const engine = new SecurityPolicyEngine([requireUserOrigin], logger);

		// Data from tool (not user) - pass the entire object with provenance
		const toolData = createProvenanceProxy(
			{ account: '999-ATTACKER', amount: 10000 },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'extractAccount',
				apiGroup: 'parser',
				timestamp: Date.now(),
			},
			{ type: 'public' }
		);

		// Pass the entire proxied object so provenance is preserved
		const args = {
			toAccount: toolData, // Pass the entire object, not just the property
			amount: 10000,
		};

		await expect(engine.checkTool('sendMoney', 'banking', args)).rejects.toThrow(
			/must come from user input/i
		);
	});

	it('should block LLM-extracted recipients', async () => {
		const engine = new SecurityPolicyEngine([blockLLMRecipients], logger);

		// LLM extracted data - wrap in object to preserve provenance
		const llmExtractedData = createProvenanceProxy(
			{ email: 'attacker@evil.com' },
			{
				type: ProvenanceSource.LLM,
				operation: 'extract',
				timestamp: Date.now(),
			},
			{ type: 'public' }
		);

		const args = {
			to: llmExtractedData, // Pass the whole proxied object
			body: 'Message',
		};

		await expect(engine.checkTool('sendEmail', 'email', args)).rejects.toThrow(
			/LLM-extracted recipient/i
		);
	});

	it('should allow tools with user-originated data', async () => {
		const engine = new SecurityPolicyEngine([requireUserOrigin], logger);

		const userData = createProvenanceProxy(
			{ toAccount: '123-LEGITIMATE', amount: 100 },
			{
				type: ProvenanceSource.USER,
				timestamp: Date.now(),
			},
			{ type: 'public' }
		);

		await expect(engine.checkTool('sendMoney', 'banking', userData)).resolves.not.toThrow();
	});
});

describe('Provenance Integration', () => {
	it('should maintain provenance through operations', () => {
		const user1 = createProvenanceProxy(
			{ name: 'Alice' },
			{ type: ProvenanceSource.TOOL, toolName: 'getUser', apiGroup: 'api', timestamp: Date.now() },
			{ type: 'restricted', readers: ['admin@company.com'] }
		);

		const user2 = createProvenanceProxy(
			{ name: 'Bob' },
			{ type: ProvenanceSource.TOOL, toolName: 'getUser', apiGroup: 'api', timestamp: Date.now() },
			{ type: 'restricted', readers: ['manager@company.com'] }
		);

		// Combine data from different sources
		const combined = { user1, user2 };

		const allProvenance = getAllProvenance(combined);
		expect(allProvenance.length).toBeGreaterThanOrEqual(2);

		// Check that both sources are tracked
		const sources = allProvenance
			.filter((p) => p.source.type === ProvenanceSource.TOOL)
			.map((p) => (p.source as any).toolName);
		expect(sources).toContain('getUser');
	});
});

describe('Approval Policy Actions', () => {
	const logger = log.child({ test: 'approval-policies' });

	it('should return log action when policy passes', async () => {
		const { preventDataExfiltration } = await import('@mondaydotcomorg/atp-provenance');

		const args = {
			to: 'bob@company.com',
			body: 'Hello world',
		};

		const result = await preventDataExfiltration.check('sendEmail', args, getProvenance);
		expect(result.action).toBe('log');
	});

	it('should return block action when policy blocks', async () => {
		const { preventDataExfiltration } = await import('@mondaydotcomorg/atp-provenance');

		const sensitiveData = createProvenanceProxy(
			{ ssn: '123-45-6789', name: 'Alice' },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'restricted', readers: ['admin@company.com'] }
		);

		const args = {
			to: 'unauthorized@hacker.com',
			body: sensitiveData,
		};

		const result = await preventDataExfiltration.check('sendEmail', args, getProvenance);
		expect(result.action).toBe('block');
		expect(result.reason).toContain('cannot read data');
	});

	it('should return approve action when approval policy is triggered', async () => {
		const { preventDataExfiltrationWithApproval } = await import('@mondaydotcomorg/atp-provenance');

		const sensitiveData = createProvenanceProxy(
			{ ssn: '123-45-6789', name: 'Alice' },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'restricted', readers: ['admin@company.com'] }
		);

		const args = {
			to: 'unauthorized@company.com',
			body: sensitiveData,
		};

		const result = await preventDataExfiltrationWithApproval.check(
			'sendEmail',
			args,
			getProvenance
		);
		expect(result.action).toBe('approve');
		expect(result.reason).toContain('Sending data from');
		expect(result.context).toBeDefined();
		expect(result.context?.recipient).toBe('unauthorized@company.com');
	});

	it('should handle approval callback for approve action', async () => {
		const { preventDataExfiltrationWithApproval } = await import('@mondaydotcomorg/atp-provenance');

		const policyEngine = new SecurityPolicyEngine([preventDataExfiltrationWithApproval], logger);

		let approvalCalled = false;
		let approvalMessage = '';

		policyEngine.setApprovalCallback(async (message, context) => {
			approvalCalled = true;
			approvalMessage = message;
			return true; // Grant approval
		});

		const sensitiveData = createProvenanceProxy(
			{ ssn: '123-45-6789' },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'restricted', readers: ['admin@company.com'] }
		);

		const args = {
			to: 'unauthorized@company.com',
			body: sensitiveData,
		};

		await policyEngine.checkTool('sendEmail', 'email', args);

		expect(approvalCalled).toBe(true);
		expect(approvalMessage).toContain('Sending data from');
	});

	it('should throw error when approval is denied', async () => {
		const { preventDataExfiltrationWithApproval } = await import('@mondaydotcomorg/atp-provenance');

		const policyEngine = new SecurityPolicyEngine([preventDataExfiltrationWithApproval], logger);

		policyEngine.setApprovalCallback(async () => {
			return false; // Deny approval
		});

		const sensitiveData = createProvenanceProxy(
			{ ssn: '123-45-6789' },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'restricted', readers: ['admin@company.com'] }
		);

		const args = {
			to: 'unauthorized@company.com',
			body: sensitiveData,
		};

		await expect(policyEngine.checkTool('sendEmail', 'email', args)).rejects.toThrow(
			'Approval denied'
		);
	});

	it('should throw error when approval callback not configured', async () => {
		const { preventDataExfiltrationWithApproval } = await import('@mondaydotcomorg/atp-provenance');

		const policyEngine = new SecurityPolicyEngine([preventDataExfiltrationWithApproval], logger);
		// No approval callback set

		const sensitiveData = createProvenanceProxy(
			{ ssn: '123-45-6789' },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'restricted', readers: ['admin@company.com'] }
		);

		const args = {
			to: 'unauthorized@company.com',
			body: sensitiveData,
		};

		await expect(policyEngine.checkTool('sendEmail', 'email', args)).rejects.toThrow(
			'Approval required but approval handler not configured'
		);
	});

	it('should support log action for audit policies', async () => {
		const { auditSensitiveAccess } = await import('@mondaydotcomorg/atp-provenance');

		const args = { id: '123' };

		const result = await auditSensitiveAccess.check('getPassword', args, getProvenance);
		expect(result.action).toBe('log');
		expect(result.reason).toContain('Sensitive data accessed');
	});

	it('should handle all three policy actions correctly', async () => {
		const { preventDataExfiltration, preventDataExfiltrationWithApproval, auditSensitiveAccess } =
			await import('@mondaydotcomorg/atp-provenance');

		const policyEngine = new SecurityPolicyEngine(
			[auditSensitiveAccess, preventDataExfiltrationWithApproval],
			logger
		);

		let approvalCount = 0;
		policyEngine.setApprovalCallback(async () => {
			approvalCount++;
			return true;
		});

		// Test 1: log action (audit policy)
		await policyEngine.checkTool('someOperation', 'api', {});

		// Test 2: approve action (with approval granted)
		const sensitiveData = createProvenanceProxy(
			{ data: 'sensitive' },
			{
				type: ProvenanceSource.TOOL,
				toolName: 'getUser',
				apiGroup: 'users',
				timestamp: Date.now(),
			},
			{ type: 'restricted', readers: ['admin@company.com'] }
		);

		await policyEngine.checkTool('sendEmail', 'email', {
			to: 'unauthorized@company.com',
			body: sensitiveData,
		});

		expect(approvalCount).toBe(1);
	});
});
