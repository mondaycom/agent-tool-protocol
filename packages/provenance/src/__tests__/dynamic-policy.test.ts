import { DynamicPolicyRegistry } from '../policies/dynamic';
import { createDeclarativePolicy } from '../policies/declarative';
import { preventDataExfiltration } from '../policies/engine';
import type { ProvenanceMetadata } from '../types';

describe('DynamicPolicyRegistry', () => {
	it('should initialize with given policies', () => {
		const registry = new DynamicPolicyRegistry([preventDataExfiltration]);
		expect(registry.getPolicies()).toHaveLength(1);
		expect(registry.getPolicies()[0]?.name).toBe('prevent-data-exfiltration');
	});

	it('should add policies dynamically', () => {
		const registry = new DynamicPolicyRegistry();
		registry.addPolicy(preventDataExfiltration);
		expect(registry.getPolicies()).toHaveLength(1);
	});

	it('should remove policies', () => {
		const registry = new DynamicPolicyRegistry([preventDataExfiltration]);
		registry.removePolicy('prevent-data-exfiltration');
		expect(registry.getPolicies()).toHaveLength(0);
	});

	it('should check against all policies', async () => {
		const registry = new DynamicPolicyRegistry([preventDataExfiltration]);

		const mockGetProvenance = () =>
			({
				id: '1',
				source: { type: 'tool', toolName: 'restricted-tool' },
				readers: { type: 'restricted', readers: ['alice'] },
			}) as any;

		// Should block because recipient 'bob' is not in readers ['alice']
		const result = await registry.check(
			'sendEmail',
			{ to: 'bob', body: 'secret' },
			mockGetProvenance
		);

		expect(result.action).toBe('block');
		expect(result.policy).toBe('prevent-data-exfiltration');
	});

	it('should load from declarative configs', async () => {
		const registry = new DynamicPolicyRegistry();

		const config = {
			id: 'block-all',
			scope: {},
			rules: [
				{
					action: 'block' as const,
					conditions: [], // block everything
				},
			],
		};

		registry.loadFromConfigs([config]);

		expect(registry.getPolicies()).toHaveLength(1);

		const result = await registry.check('anyTool', {}, () => null);
		expect(result.action).toBe('block');
	});
});
