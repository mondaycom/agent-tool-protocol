import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';
import type Redis from 'ioredis';

export interface RedisCacheOptions {
	redis: Redis;
	keyPrefix?: string;
	defaultTTL?: number;
}

/**
 * Redis-backed cache provider for distributed systems
 * Enables cross-pod state sharing and resume capabilities
 */
export class RedisCache implements CacheProvider {
	name = 'redis';
	private redis: Redis;
	private keyPrefix: string;
	private defaultTTL?: number;

	constructor(options: RedisCacheOptions) {
		this.redis = options.redis;
		this.keyPrefix = options.keyPrefix || 'atp:cache:';
		this.defaultTTL = options.defaultTTL;
	}

	private getFullKey(key: string): string {
		return `${this.keyPrefix}${key}`;
	}

	async get<T>(key: string): Promise<T | null> {
		try {
			const value = await this.redis.get(this.getFullKey(key));
			if (!value) return null;
			return JSON.parse(value) as T;
		} catch (error) {
			log.error('RedisCache failed to get key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
			return null;
		}
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		try {
			const serialized = JSON.stringify(value);
			const fullKey = this.getFullKey(key);
			const effectiveTTL = ttl ?? this.defaultTTL;

			if (effectiveTTL) {
				await this.redis.setex(fullKey, effectiveTTL, serialized);
			} else {
				await this.redis.set(fullKey, serialized);
			}
		} catch (error) {
			log.error('RedisCache failed to set key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.redis.del(this.getFullKey(key));
		} catch (error) {
			log.error('RedisCache failed to delete key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async has(key: string): Promise<boolean> {
		try {
			const exists = await this.redis.exists(this.getFullKey(key));
			return exists === 1;
		} catch (error) {
			log.error('RedisCache failed to check key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
			return false;
		}
	}

	async clear(pattern?: string): Promise<void> {
		try {
			if (pattern) {
				const fullPattern = this.getFullKey(pattern);
				const keys = await this.redis.keys(fullPattern);
				if (keys.length > 0) {
					await this.redis.del(...keys);
				}
			} else {
				const keys = await this.redis.keys(this.getFullKey('*'));
				if (keys.length > 0) {
					await this.redis.del(...keys);
				}
			}
		} catch (error) {
			log.error('RedisCache failed to clear cache', {
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async mget(keys: string[]): Promise<Array<unknown | null>> {
		try {
			const fullKeys = keys.map((key) => this.getFullKey(key));
			const values = await this.redis.mget(...fullKeys);
			return values.map((value) => (value ? JSON.parse(value) : null));
		} catch (error) {
			log.error('RedisCache failed to mget keys', {
				error: error instanceof Error ? error.message : error,
			});
			return keys.map(() => null);
		}
	}

	async mset(entries: Array<[string, unknown, number?]>): Promise<void> {
		try {
			const pipeline = this.redis.pipeline();
			for (const [key, value, ttl] of entries) {
				const serialized = JSON.stringify(value);
				const fullKey = this.getFullKey(key);
				const effectiveTTL = ttl ?? this.defaultTTL;

				if (effectiveTTL) {
					pipeline.setex(fullKey, effectiveTTL, serialized);
				} else {
					pipeline.set(fullKey, serialized);
				}
			}
			await pipeline.exec();
		} catch (error) {
			log.error('RedisCache failed to mset entries', {
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async disconnect(): Promise<void> {
		try {
			await this.redis.quit();
		} catch (error) {
			log.error('RedisCache failed to disconnect', {
				error: error instanceof Error ? error.message : error,
			});
		}
	}
}
