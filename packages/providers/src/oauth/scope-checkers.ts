import type { ScopeChecker, TokenInfo } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';
import { createHash } from 'node:crypto';

/**
 * Scope checker registry
 * Manages scope checkers for different OAuth providers
 */
export class ScopeCheckerRegistry {
	private checkers = new Map<string, ScopeChecker>();
	private scopeCache = new Map<string, { scopes: string[]; expiresAt: number }>();
	private cleanupInterval?: NodeJS.Timeout;
	private maxCacheSize = 10000;
	private pendingChecks = new Map<string, Promise<string[]>>();

	constructor() {
		this.startCleanup();
	}

	/**
	 * Start periodic cache cleanup
	 */
	private startCleanup(): void {
		this.cleanupInterval = setInterval(
			() => {
				this.cleanupExpiredCache();
			},
			5 * 60 * 1000
		);

		if (this.cleanupInterval.unref) {
			this.cleanupInterval.unref();
		}
	}

	/**
	 * Stop periodic cache cleanup (for testing or shutdown)
	 */
	stopCleanup(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = undefined;
		}
	}

	/**
	 * Remove expired entries from cache
	 */
	private cleanupExpiredCache(): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [key, value] of this.scopeCache.entries()) {
			if (value.expiresAt <= now) {
				this.scopeCache.delete(key);
				cleaned++;
			}
		}

		if (this.scopeCache.size > this.maxCacheSize) {
			const entriesToRemove = this.scopeCache.size - this.maxCacheSize;
			const entries = Array.from(this.scopeCache.entries());

			entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);

			for (let i = 0; i < entriesToRemove; i++) {
				const entry = entries[i];
				if (entry) {
					this.scopeCache.delete(entry[0]);
					cleaned++;
				}
			}
		}

		if (cleaned > 0) {
			log.debug(`Cleaned ${cleaned} expired/old scope cache entries`);
		}
	}

	/**
	 * Register a custom scope checker
	 */
	register(checker: ScopeChecker): void {
		this.checkers.set(checker.provider, checker);
	}

	/**
	 * Check if a scope checker is available for a provider
	 */
	hasChecker(provider: string): boolean {
		return this.checkers.has(provider);
	}

	/**
	 * Get scope checker for a provider
	 */
	getChecker(provider: string): ScopeChecker | undefined {
		return this.checkers.get(provider);
	}

	/**
	 * Check what scopes a token has (with caching and deduplication)
	 * @param provider - Provider name
	 * @param token - Access token
	 * @param cacheTTL - Cache TTL in seconds (default: 3600 = 1 hour)
	 */
	async checkScopes(provider: string, token: string, cacheTTL = 3600): Promise<string[]> {
		const cacheKey = `${provider}:${this.hashToken(token)}`;

		const cached = this.scopeCache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.scopes;
		}

		const pending = this.pendingChecks.get(cacheKey);
		if (pending) {
			return pending;
		}

		const checker = this.checkers.get(provider);
		if (!checker) {
			throw new Error(`No scope checker registered for provider: ${provider}`);
		}

		const checkPromise = (async () => {
			try {
				const scopes = await checker.check(token);

				this.scopeCache.set(cacheKey, {
					scopes,
					expiresAt: Date.now() + cacheTTL * 1000,
				});

				return scopes;
			} finally {
				this.pendingChecks.delete(cacheKey);
			}
		})();

		this.pendingChecks.set(cacheKey, checkPromise);
		return checkPromise;
	}

	/**
	 * Validate if a token is still valid
	 */
	async validateToken(provider: string, token: string): Promise<boolean> {
		const checker = this.checkers.get(provider);
		if (!checker || !checker.validate) {
			return true;
		}

		return await checker.validate(token);
	}

	/**
	 * Get complete token information
	 */
	async getTokenInfo(provider: string, token: string): Promise<TokenInfo> {
		const checker = this.checkers.get(provider);
		if (!checker) {
			throw new Error(`No scope checker registered for provider: ${provider}`);
		}

		const [scopes, valid] = await Promise.all([
			checker.check(token),
			checker.validate ? checker.validate(token) : Promise.resolve(true),
		]);

		return {
			valid,
			scopes,
		};
	}

	/**
	 * Clear cached scopes
	 */
	clearCache(provider?: string): void {
		if (provider) {
			for (const key of this.scopeCache.keys()) {
				if (key.startsWith(`${provider}:`)) {
					this.scopeCache.delete(key);
				}
			}
		} else {
			this.scopeCache.clear();
		}
	}

	/**
	 * Hash token for cache key (SHA-256, first 16 chars)
	 */
	private hashToken(token: string): string {
		return createHash('sha256').update(token).digest('hex').substring(0, 16);
	}
}
