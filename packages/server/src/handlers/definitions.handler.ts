import type { APIGroupConfig } from '@mondaydotcomorg/atp-protocol';
import { APIAggregator } from '@mondaydotcomorg/atp-engine';

export async function getDefinitions(apiGroups: APIGroupConfig[]): Promise<unknown> {
	const aggregator = new APIAggregator(apiGroups);
	const typescript = await aggregator.generateTypeScript();

	return {
		typescript,
		apiGroups: apiGroups.map((g) => g.name),
		version: '1.0.0',
	};
}
