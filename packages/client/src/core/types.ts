export interface PreRequestContext {
	/** Request URL */
	url: string;
	/** HTTP method */
	method: string;
	/** Current headers that will be sent */
	currentHeaders: Record<string, string>;
	/** Request body (if any) */
	body?: unknown;
}

export interface PreRequestResult {
	/** Updated headers to use for this request */
	headers?: Record<string, string>;
	/** If true, abort the request and throw an error */
	abort?: boolean;
	/** Optional error message if aborting */
	abortReason?: string;
}

/**
 * Hook called before every HTTP request to the ATP server
 *
 * Use this to:
 * - Refresh short-lived tokens
 * - Add tracing/correlation headers
 * - Log requests
 * - Implement custom authentication flows
 * - Conditionally abort requests
 *
 * @example
 * ```typescript
 * const preRequest = async (context) => {
 *   // Refresh token before each request
 *   const token = await auth.getAccessToken();
 *
 *   // Log the request
 *   console.log(`[ATP] ${context.method} ${context.url}`);
 *
 *   return {
 *     headers: {
 *       ...context.currentHeaders,
 *       Authorization: `Bearer ${token}`,
 *       'X-Trace-Id': generateTraceId()
 *     }
 *   };
 * };
 * ```
 */
export type PreRequestHook = (context: PreRequestContext) => Promise<PreRequestResult>;

/**
 * Client hooks for intercepting and modifying behavior
 *
 * @example
 * ```typescript
 * const hooks: ClientHooks = {
 *   preRequest: async (context) => {
 *     const token = await auth.getAccessToken();
 *     return {
 *       headers: {
 *         ...context.currentHeaders,
 *         Authorization: `Bearer ${token}`
 *       }
 *     };
 *   }
 * };
 *
 * const client = new AgentToolProtocolClient(serverUrl, {}, undefined, hooks);
 * ```
 */
export interface ClientHooks {
	/** Hook called before every HTTP request */
	preRequest?: PreRequestHook;
	// Future hooks can be added here without breaking changes:
	// postRequest?: PostRequestHook;
	// onError?: ErrorHook;
	// onRetry?: RetryHook;
}

/**
 * Configuration for automatic token refresh behavior
 */
export interface TokenRefreshConfig {
	/** Enable automatic token refresh (default: true) */
	enabled: boolean;
	/** Buffer time in ms before rotateAt to trigger refresh (default: 1000ms) */
	bufferMs: number;
}
