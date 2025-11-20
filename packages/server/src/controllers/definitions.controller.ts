import type { IncomingMessage, ServerResponse } from 'node:http';
import type { APIAggregator } from '@mondaydotcomorg/atp-engine';
import { sendJson } from '../utils/response.js';

export async function handleDefinitions(
	req: IncomingMessage,
	res: ServerResponse,
	aggregator: APIAggregator,
	url: URL
): Promise<void> {
	const apiGroups = url.searchParams.get('apiGroups')?.split(',');
	const typescript = await aggregator.generateTypeScript(apiGroups);

	sendJson(res, {
		typescript,
		apiGroups: aggregator.getApiGroups(),
		version: '1.0.0',
	});
}
