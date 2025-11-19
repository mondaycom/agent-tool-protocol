import { createDeclarativePolicy } from '../declarative-policy.js';
import { createProvenanceProxy, setGlobalProvenanceStore } from '../registry.js';
import { ProvenanceSource, type SourceMetadata } from '../types.js';
import { InMemoryProvenanceStore } from '../store.js';

describe('Declarative Policies', () => {
	beforeAll(() => {
		setGlobalProvenanceStore(new InMemoryProvenanceStore());
	});

	const userSource: SourceMetadata = {
		type: ProvenanceSource.USER,
		timestamp: Date.now(),
	};

	const toolSource: SourceMetadata = {
		type: ProvenanceSource.TOOL,
		toolName: 'getUser',
		apiGroup: 'users',
		timestamp: Date.now(),
	};

	const policyConfig = {
		id: 'test-policy',
		scope: {
			toolName: 'send',
		},
		rules: [
			{
				id: 'block-external-user-data',
				action: 'block' as const,
				conditions: [
					{
						field: 'args.to',
						operator: 'notEndsWith' as const,
						value: '@company.com',
					},
					{
						field: 'provenance.args.body.source.type',
						operator: 'equals' as const,
						value: 'user',
					},
				],
				reason: 'Cannot send user data to external email',
			},
		],
	};

	const policy = createDeclarativePolicy(policyConfig);

	it('should ignore calls outside of scope', async () => {
		const result = await policy.check('otherTool', { to: 'external@gmail.com' }, () => null);
		expect(result.action).toBe('log'); // Default allow
	});

	it('should block when conditions match', async () => {
		const userData = createProvenanceProxy({ data: 'sensitive' }, userSource);

		const { getProvenance } = await import('../registry.js');

		const result = await policy.check(
			'send',
			{
				to: 'attacker@evil.com',
				body: userData,
			},
			getProvenance
		);

		expect(result.action).toBe('block');
		expect(result.reason).toBe('Cannot send user data to external email');
	});

	it('should allow when conditions do not match (email is internal)', async () => {
		const userData = createProvenanceProxy({ data: 'sensitive' }, userSource);
		const { getProvenance } = await import('../registry.js');

		const result = await policy.check(
			'send',
			{
				to: 'alice@company.com',
				body: userData,
			},
			getProvenance
		);

		expect(result.action).toBe('log'); // Default allow
	});

	it('should allow when conditions do not match (data is not user source)', async () => {
		const toolData = createProvenanceProxy({ data: 'public info' }, toolSource);
		const { getProvenance } = await import('../registry.js');

		const result = await policy.check(
			'send',
			{
				to: 'attacker@evil.com',
				body: toolData,
			},
			getProvenance
		);

		expect(result.action).toBe('log'); // Default allow
	});

	it('should handle nested provenance paths', async () => {
		const complexPolicyConfig = {
			id: 'nested-test',
			scope: { toolName: 'update' },
			rules: [
				{
					action: 'block' as const,
					conditions: [
						{
							field: 'provenance.args.user.profile.email.source.type',
							operator: 'equals' as const,
							value: 'user',
						},
					],
				},
			],
		};

		const complexPolicy = createDeclarativePolicy(complexPolicyConfig);
		const { getProvenance } = await import('../registry.js');

		// Create a user object where the nested properties have provenance
		const user = createProvenanceProxy(
			{
				profile: {
					email: 'test@test.com',
				},
			},
			userSource
		);

		const args = {
			user,
		};

		const result = await complexPolicy.check('update', args, getProvenance);
		expect(result.action).toBe('block');
	});
});
