import type { APIGroupConfig } from '@mondaydotcomorg/atp-protocol';
import { APIAggregator } from '../aggregator/index.js';
import { filterApiGroups } from '../core/request-scope.js';

export async function getDefinitions(apiGroups: APIGroupConfig[]): Promise<unknown> {
	const filteredGroups = filterApiGroups(apiGroups);

	const aggregator = new APIAggregator(filteredGroups);
	const typescript = await aggregator.generateTypeScript();

	return {
		typescript,
		apiGroups: filteredGroups.map((g) => g.name),
		version: '1.0.0',
	};
}
