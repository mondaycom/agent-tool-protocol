/**
 */
import NodeCache from 'node-cache';
import { log } from '../log/index.js';
import type { CacheBackend, CacheConfig } from './types';

/**
 * In-memory cache implementation using node-cache
 */
export class MemoryCacheBackend implements CacheBackend {
	private cache: NodeCache;

	constructor(config?: { maxKeys?: number; defaultTTL?: number; checkPeriod?: number }) {
		this.cache = new NodeCache({
			stdTTL: config?.defaultTTL ?? 600,
			checkperiod: config?.checkPeriod ?? 120,
			maxKeys: config?.maxKeys ?? 1000,
			useClones: false,
		});
	}

	async get<T>(key: string): Promise<T | null> {
		const value = this.cache.get<T>(key);
		return value ?? null;
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		if (ttl) {
			this.cache.set(key, value, ttl);
		} else {
			this.cache.set(key, value);
		}
	}

	async delete(key: string): Promise<void> {
		this.cache.del(key);
	}

	async has(key: string): Promise<boolean> {
		return this.cache.has(key);
	}

	async clear(): Promise<void> {
		this.cache.flushAll();
	}
}

/**
 * Redis cache implementation (lazy-loaded only if configured)
 */
export class RedisCacheBackend implements CacheBackend {
	private client: any;
	private connected: boolean = false;

	constructor(config: NonNullable<CacheConfig['redis']>) {
		import('ioredis')
			.then((Redis) => {
				this.client = new Redis.default({
					host: config.host,
					port: config.port,
					password: config.password,
					db: config.db ?? 0,
					retryStrategy: (times: number) => {
						if (times > 3) {
							return null;
						}
						return Math.min(times * 100, 2000);
					},
					lazyConnect: true,
				});

				this.client
					.connect()
					.then(() => {
						this.connected = true;
					})
					.catch(() => {
						this.connected = false;
					});
			})
			.catch(() => {
				throw new Error('ioredis package not installed. Install it with: yarn add ioredis');
			});
	}

	async get<T>(key: string): Promise<T | null> {
		if (!this.connected) {
			log.warn('Redis Cache not connected, cannot get key', { key });
			return null;
		}
		try {
			const value = await this.client.get(key);
			return value ? JSON.parse(value) : null;
		} catch (error) {
			log.error('Redis Cache failed to get key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
			return null;
		}
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		if (!this.connected) {
			log.warn('Redis Cache not connected, cannot set key', { key });
			return;
		}
		try {
			const serialized = JSON.stringify(value);
			if (ttl) {
				await this.client.setex(key, ttl, serialized);
			} else {
				await this.client.set(key, serialized);
			}
		} catch (error) {
			log.error('Redis Cache failed to set key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async delete(key: string): Promise<void> {
		if (!this.connected) {
			log.warn('Redis Cache not connected, cannot delete key', { key });
			return;
		}
		try {
			await this.client.del(key);
		} catch (error) {
			log.error('Redis Cache failed to delete key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async has(key: string): Promise<boolean> {
		if (!this.connected) {
			log.warn('Redis Cache not connected, cannot check key', { key });
			return false;
		}
		try {
			const exists = await this.client.exists(key);
			return exists === 1;
		} catch (error) {
			log.error('Redis Cache failed to check key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
			return false;
		}
	}

	async clear(): Promise<void> {
		if (!this.connected) {
			log.warn('Redis Cache not connected, cannot clear cache');
			return;
		}
		try {
			await this.client.flushdb();
		} catch (error) {
			log.error('Redis Cache failed to clear cache', {
				error: error instanceof Error ? error.message : error,
			});
		}
	}
}

let cacheBackend: CacheBackend = new MemoryCacheBackend();

/**
 * Initializes the cache system with configuration
 */
export function initializeCache(config: CacheConfig): void {
	if (config.type === 'redis' && config.redis) {
		cacheBackend = new RedisCacheBackend(config.redis);
	} else {
		cacheBackend = new MemoryCacheBackend({
			maxKeys: config.maxKeys,
			defaultTTL: config.defaultTTL,
			checkPeriod: config.checkPeriod,
		});
	}
}

/**
 * Get the current cache backend
 */
export function getCacheBackend(): CacheBackend {
	return cacheBackend;
}
