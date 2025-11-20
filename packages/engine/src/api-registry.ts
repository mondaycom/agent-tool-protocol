/**
 * API Registry - Store and manage API groups by ID
 */

import type { APIGroupConfig } from '@mondaydotcomorg/atp-protocol';
import { APIAggregator } from './aggregator/index.js';

/**
 * Registry for storing API groups by ID
 */
export class APIRegistry {
	private apis: Map<string, APIGroupConfig> = new Map();
	private aggregator: APIAggregator;

	constructor() {
		this.aggregator = new APIAggregator([]);
	}

	/**
	 * Register an API group by ID
	 */
	register(id: string, apiGroup: APIGroupConfig): void {
		if (this.apis.has(id)) {
			throw new Error(`API with id "${id}" is already registered`);
		}
		this.apis.set(id, apiGroup);
		this.updateAggregator();
	}

	/**
	 * Unregister an API group by ID
	 */
	unregister(id: string): boolean {
		const result = this.apis.delete(id);
		if (result) {
			this.updateAggregator();
		}
		return result;
	}

	/**
	 * Get an API group by ID
	 */
	get(id: string): APIGroupConfig | undefined {
		return this.apis.get(id);
	}

	/**
	 * List all registered API IDs
	 */
	listIDs(): string[] {
		return Array.from(this.apis.keys());
	}

	/**
	 * Get all API groups (for executor)
	 */
	getAllAPIGroups(): APIGroupConfig[] {
		return Array.from(this.apis.values());
	}

	/**
	 * Generate TypeScript definitions for registered APIs
	 */
	async generateTypeScript(selectedGroups?: string[]): Promise<string> {
		const groupNames = selectedGroups ?? this.listIDs();
		return await this.aggregator.generateTypeScript(groupNames);
	}

	/**
	 * Search APIs by query
	 */
	async search(query: string, limit: number = 10): Promise<Array<{
		api: string;
		function: string;
		description: string;
		score: number;
	}>> {
		const results: Array<{
			api: string;
			function: string;
			description: string;
			score: number;
		}> = [];

		const lowerQuery = query.toLowerCase();

		for (const [id, apiGroup] of this.apis.entries()) {
			if (!apiGroup.functions) continue;

			for (const func of apiGroup.functions) {
				const funcName = func.name.toLowerCase();
				const funcDesc = (func.description ?? '').toLowerCase();

				// Simple keyword matching (could be enhanced with embeddings)
				let score = 0;
				if (funcName.includes(lowerQuery)) score += 1.0;
				if (funcDesc.includes(lowerQuery)) score += 0.5;
				if (funcName.startsWith(lowerQuery)) score += 0.5;

				if (score > 0) {
					results.push({
						api: id,
						function: func.name,
						description: func.description ?? '',
						score,
					});
				}
			}
		}

		// Sort by score descending
		results.sort((a, b) => b.score - a.score);

		return results.slice(0, limit);
	}

	/**
	 * Update aggregator with current API groups
	 */
	private updateAggregator(): void {
		this.aggregator = new APIAggregator(this.getAllAPIGroups());
	}
}

