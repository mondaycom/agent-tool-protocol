import type {
	SearchOptions,
	SearchResult,
	ExploreResult,
} from '@mondaydotcomorg/atp-protocol';
import type { RuntimeAPIName } from '@mondaydotcomorg/atp-runtime';
import type { ClientSession } from './session.js';

export class APIOperations {
	private session: ClientSession;
	private apiDefinitions?: string;

	constructor(session: ClientSession) {
		this.session = session;
	}

	/**
	 * Connects to the server and retrieves API definitions.
	 */
	async connect(options?: { apiGroups?: string[] }): Promise<{
		serverVersion: string;
		capabilities: unknown;
		apiGroups: string[];
	}> {
		await this.session.ensureInitialized();

		const params = new URLSearchParams();
		if (options?.apiGroups) {
			params.set('apiGroups', options.apiGroups.join(','));
		}

		const url = `${this.session.getBaseUrl()}/api/definitions?${params}`;
		const headers = await this.session.prepareHeaders('GET', url);

		const response = await fetch(url, { headers });

		if (!response.ok) {
			throw new Error(`Connection failed: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as {
			typescript: string;
			version: string;
			apiGroups: string[];
		};
		this.apiDefinitions = data.typescript;

		return {
			serverVersion: data.version,
			capabilities: {},
			apiGroups: data.apiGroups,
		};
	}

	/**
	 * Gets the TypeScript type definitions for available APIs.
	 */
	getTypeDefinitions(): string {
		if (!this.apiDefinitions) {
			throw new Error('Not connected. Call connect() first.');
		}
		return this.apiDefinitions;
	}

	/**
	 * Searches for available API functions.
	 */
	async searchAPI(query: string, options?: SearchOptions): Promise<SearchResult[]> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/search`;
		const body = JSON.stringify({ query, ...options });
		const headers = await this.session.prepareHeaders('POST', url, body);

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		if (!response.ok) {
			throw new Error(`Search failed: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as { results: SearchResult[] };
		return data.results;
	}

	/**
	 * Explores the API filesystem at the given path.
	 */
	async exploreAPI(path: string): Promise<ExploreResult> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/explore`;
		const body = JSON.stringify({ path });
		const headers = await this.session.prepareHeaders('POST', url, body);

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		if (!response.ok) {
			throw new Error(`Explore failed: ${response.status} ${response.statusText}`);
		}

		return (await response.json()) as ExploreResult;
	}

	/**
	 * Gets information about the server.
	 */
	async getServerInfo(): Promise<{
		version: string;
		capabilities: Record<string, boolean>;
	}> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/info`;
		const headers = await this.session.prepareHeaders('GET', url);

		const response = await fetch(url, { headers });

		if (!response.ok) {
			throw new Error(`Failed to get server info: ${response.status}`);
		}

		return (await response.json()) as {
			version: string;
			capabilities: Record<string, boolean>;
		};
	}

	/**
	 * Gets ATP runtime API definitions as TypeScript declarations.
	 * Returns the full TypeScript definitions for atp.llm.*, atp.cache.*, etc.
	 * These are the APIs available during code execution.
	 * 
	 * Behavior:
	 * - No options: Returns APIs based on client capabilities (default filtering)
	 * - apis: ['llm', 'cache']: Returns only specified APIs (intersection with client capabilities)
	 * - apis: []: Returns all APIs regardless of client capabilities
	 * 
	 * @param options - Optional filtering options
	 * @param options.apis - Specific APIs to include (e.g., ['llm', 'cache', 'approval'])
	 */
	async getRuntimeDefinitions(options?: { apis?: RuntimeAPIName[] }): Promise<string> {
		await this.session.ensureInitialized();

		const params = new URLSearchParams();
		if (options?.apis && options.apis.length > 0) {
			params.set('apis', options.apis.join(','));
		}

		const url = `${this.session.getBaseUrl()}/api/runtime${params.toString() ? `?${params}` : ''}`;
		const headers = await this.session.prepareHeaders('GET', url);

		const response = await fetch(url, { headers });

		if (!response.ok) {
			throw new Error(`Failed to get runtime definitions: ${response.status}`);
		}

		return await response.text();
	}
}
