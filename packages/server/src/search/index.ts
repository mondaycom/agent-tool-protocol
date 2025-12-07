import type {
	SearchOptions,
	SearchResult,
	APIGroupConfig,
	AuthProvider,
	ScopeFilteringConfig,
} from '@mondaydotcomorg/atp-protocol';
import { filterApiGroups } from '../core/request-scope.js';

interface IndexedFunction {
	apiGroup: string;
	functionName: string;
	description: string;
	signature: string;
	keywords: string[];
	metadata?: {
		requiredScopes?: string[];
		provider?: string;
		source?: 'server' | 'user';
	};
}

/**
 * SearchEngine provides semantic and keyword-based search over available API functions.
 */
export class SearchEngine {
	private index: IndexedFunction[] = [];
	private apiGroups: APIGroupConfig[] = [];

	/**
	 * Creates a new SearchEngine instance.
	 * @param apiGroups - Array of API group configurations to index
	 */
	constructor(apiGroups?: APIGroupConfig[]) {
		if (apiGroups) {
			this.apiGroups = apiGroups;
			this.buildIndex(apiGroups);
		}
	}

	/**
	 * Builds the search index from API group configurations.
	 * @param apiGroups - API groups to index
	 */
	private buildIndex(apiGroups: APIGroupConfig[]): void {
		this.index = [];

		for (const group of apiGroups) {
			if (group.functions) {
				for (const func of group.functions) {
					const keywords = this.extractKeywords(func.description);
					const signature = this.generateSignature(func);

					this.index.push({
						apiGroup: group.name,
						functionName: func.name,
						description: func.description,
						signature,
						keywords,
						metadata: {
							requiredScopes: func.requiredScopes,
							provider: func.auth?.oauthProvider,
							source: func.auth?.source,
						},
					});
				}
			}
		}
	}

	/**
	 * Searches for API functions matching the query.
	 * Tool rules are automatically applied from the request scope.
	 * @param options - Search options including query and filters
	 * @param userId - Optional user ID for scope filtering
	 * @param authProvider - Optional auth provider for checking user scopes
	 * @param scopeFilteringConfig - Optional scope filtering configuration
	 * @returns Array of search results sorted by relevance
	 */
	async search(
		options: SearchOptions,
		userId?: string,
		authProvider?: AuthProvider,
		scopeFilteringConfig?: ScopeFilteringConfig
	): Promise<SearchResult[]> {
		const allowedGroups = filterApiGroups(this.apiGroups);
		const allowedTools = new Set<string>();
		for (const group of allowedGroups) {
			if (group.functions) {
				for (const func of group.functions) {
					allowedTools.add(`${group.name}:${func.name}`);
				}
			}
		}

		const queryWords = this.extractKeywords(options.query);
		const results: Array<{ result: SearchResult; score: number }> = [];

		for (const item of this.index) {
			if (!allowedTools.has(`${item.apiGroup}:${item.functionName}`)) {
				continue;
			}

			if (options.apiGroups && !options.apiGroups.includes(item.apiGroup)) {
				continue;
			}

			if (scopeFilteringConfig?.enabled && item.metadata?.source === 'user') {
				const shouldInclude = await this.checkScopes(
					item,
					userId,
					authProvider,
					scopeFilteringConfig
				);
				if (!shouldInclude) {
					continue;
				}
			}

			let score = 0;

			if (item.description.toLowerCase().includes(options.query.toLowerCase())) {
				score += 100;
			}

			if (item.functionName.toLowerCase().includes(options.query.toLowerCase())) {
				score += 50;
			}

			for (const word of queryWords) {
				if (item.keywords.includes(word)) {
					score += 10;
				}
				if (item.functionName.toLowerCase().includes(word)) {
					score += 5;
				}
				if (item.description.toLowerCase().includes(word)) {
					score += 3;
				}
			}

			if (score > 0) {
				results.push({
					result: {
						apiGroup: item.apiGroup,
						functionName: item.functionName,
						description: item.description,
						signature: item.signature,
						relevanceScore: score,
					},
					score,
				});
			}
		}

		results.sort((a, b) => b.score - a.score);

		const limit = options.maxResults ?? 10;
		return results.slice(0, limit).map((r) => r.result);
	}

	/**
	 * Checks if a user has the required scopes for a function.
	 * @param item - Indexed function to check
	 * @param userId - User ID
	 * @param authProvider - Auth provider for looking up credentials
	 * @param config - Scope filtering configuration
	 * @returns True if function should be included in results
	 */
	private async checkScopes(
		item: IndexedFunction,
		userId: string | undefined,
		authProvider: AuthProvider | undefined,
		config: ScopeFilteringConfig
	): Promise<boolean> {
		const requiredScopes = item.metadata?.requiredScopes;
		const provider = item.metadata?.provider;

		if (!requiredScopes || requiredScopes.length === 0) {
			return true;
		}

		if (!userId || !authProvider || !provider) {
			return config.fallback === 'allow';
		}

		try {
			const userCreds = await authProvider.getUserCredential?.(userId, provider);

			if (!userCreds) {
				return config.fallback === 'allow';
			}

			const userScopes = userCreds.scopes ?? [];
			const hasAllScopes = requiredScopes.every((required) => userScopes.includes(required));

			return hasAllScopes;
		} catch (error) {
			return config.fallback === 'allow';
		}
	}

	/**
	 * Extracts keywords from a text string.
	 * @param text - Text to extract keywords from
	 * @returns Array of lowercase keywords
	 */
	private extractKeywords(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w\s]/g, ' ')
			.split(/\s+/)
			.filter((word) => word.length > 2);
	}

	/**
	 * Generates a function signature string.
	 * @param func - Function definition
	 * @returns Signature string
	 */
	private generateSignature(func: {
		name: string;
		inputSchema?: { properties?: Record<string, unknown> };
	}): string {
		const params: string[] = [];
		if (func.inputSchema?.properties) {
			for (const [key, value] of Object.entries(func.inputSchema.properties)) {
				const prop = value as { type?: string };
				params.push(`${key}: ${prop.type ?? 'any'}`);
			}
		}
		return `${func.name}({ ${params.join(', ')} })`;
	}
}
