import { AgentToolProtocolClient } from './client.js';
import { log } from '@mondaydotcomorg/atp-runtime';

export class CodeGenerator {
	private client: AgentToolProtocolClient;

	constructor(client: AgentToolProtocolClient) {
		this.client = client;
	}

	async generateCode(intent: string, parameters?: unknown): Promise<string> {
		const types = this.client.getTypeDefinitions();
		log.debug('Generating code for intent', { intent, parameters, typesLength: types.length });
		return '// Generated code';
	}
}
