import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

interface CacheEntry {
	value: unknown;
	expiresAt: number;
}

export interface FileCacheOptions {
	cacheDir?: string;
	maxKeys?: number;
	defaultTTL?: number;
	cleanupInterval?: number;
}

/**
 * File-based cache provider for persistent local caching
 * Good for single-server deployments that need persistence across restarts
 * Supports cross-pod scenarios when using a shared filesystem (NFS, EFS, etc.)
 */
export class FileCache implements CacheProvider {
	name = 'file';
	private cacheDir: string;
	private maxKeys: number;
	private defaultTTL: number;
	private cleanupInterval: number;
	private cleanupTimer?: NodeJS.Timeout;
	private initPromise?: Promise<void>;

	constructor(options: FileCacheOptions = {}) {
		this.cacheDir = options.cacheDir || path.join(os.tmpdir(), 'atp-cache');
		this.maxKeys = options.maxKeys || 1000;
		this.defaultTTL = options.defaultTTL || 3600;
		this.cleanupInterval = options.cleanupInterval || 300; // 5 minutes

		// Initialize asynchronously
		this.initPromise = this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			await fs.mkdir(this.cacheDir, { recursive: true });
			// Start periodic cleanup
			this.startCleanup();
		} catch (error) {
			log.error('FileCache failed to initialize cache directory', {
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initPromise) {
			await this.initPromise;
		}
	}

	private getFilePath(key: string): string {
		// Sanitize key to be filesystem-safe
		const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
		return path.join(this.cacheDir, `${sanitizedKey}.json`);
	}

	private startCleanup(): void {
		if (this.cleanupInterval > 0) {
			this.cleanupTimer = setInterval(() => {
				this.cleanExpired().catch((error) => {
					log.error('FileCache cleanup error', { error });
				});
			}, this.cleanupInterval * 1000);

			// Don't prevent process exit
			if (this.cleanupTimer.unref) {
				this.cleanupTimer.unref();
			}
		}
	}

	private async cleanExpired(): Promise<void> {
		try {
			await this.ensureInitialized();
			const files = await fs.readdir(this.cacheDir);
			const now = Date.now();

			for (const file of files) {
				if (!file.endsWith('.json')) continue;

				const filePath = path.join(this.cacheDir, file);
				try {
					const content = await fs.readFile(filePath, 'utf-8');
					const entry: CacheEntry = JSON.parse(content);

					if (entry.expiresAt !== -1 && now > entry.expiresAt) {
						await fs.unlink(filePath);
					}
				} catch {
					// If we can't read or parse a file, delete it
					try {
						await fs.unlink(filePath);
					} catch {
						// Ignore deletion errors
					}
				}
			}

			// Enforce max keys limit
			await this.enforceMaxKeys();
		} catch (error) {
			log.error('FileCache failed to clean expired entries', {
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	private async enforceMaxKeys(): Promise<void> {
		try {
			const files = await fs.readdir(this.cacheDir);
			const jsonFiles = files.filter((f) => f.endsWith('.json'));

			if (jsonFiles.length > this.maxKeys) {
				// Sort by modification time and remove oldest
				const fileStats = await Promise.all(
					jsonFiles.map(async (file) => {
						const filePath = path.join(this.cacheDir, file);
						const stats = await fs.stat(filePath);
						return { file, mtime: stats.mtime.getTime() };
					})
				);

				fileStats.sort((a, b) => a.mtime - b.mtime);

				const toDelete = fileStats.slice(0, jsonFiles.length - this.maxKeys);
				await Promise.all(
					toDelete.map((item) => {
						const filePath = path.join(this.cacheDir, item.file);
						return fs.unlink(filePath).catch(() => {
							// Ignore errors
						});
					})
				);
			}
		} catch (error) {
			log.error('FileCache failed to enforce max keys', {
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async get<T>(key: string): Promise<T | null> {
		try {
			await this.ensureInitialized();
			const filePath = this.getFilePath(key);
			const content = await fs.readFile(filePath, 'utf-8');
			const entry: CacheEntry = JSON.parse(content);

			if (entry.expiresAt !== -1 && Date.now() > entry.expiresAt) {
				await this.delete(key);
				return null;
			}

			return entry.value as T;
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				return null;
			}
			log.error('FileCache failed to get key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
			return null;
		}
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		try {
			await this.ensureInitialized();
			await this.enforceMaxKeys();

			const expiresAt = ttl
				? Date.now() + ttl * 1000
				: this.defaultTTL > 0
					? Date.now() + this.defaultTTL * 1000
					: -1;

			const entry: CacheEntry = { value, expiresAt };
			const filePath = this.getFilePath(key);

			await fs.writeFile(filePath, JSON.stringify(entry), 'utf-8');
		} catch (error) {
			log.error('FileCache failed to set key', {
				key,
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.ensureInitialized();
			const filePath = this.getFilePath(key);
			await fs.unlink(filePath);
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				log.error('FileCache failed to delete key', {
					key,
					error: error instanceof Error ? error.message : error,
				});
			}
		}
	}

	async has(key: string): Promise<boolean> {
		const value = await this.get(key);
		return value !== null;
	}

	async clear(pattern?: string): Promise<void> {
		try {
			await this.ensureInitialized();
			const files = await fs.readdir(this.cacheDir);

			if (!pattern) {
				// Clear all cache files
				await Promise.all(
					files
						.filter((f) => f.endsWith('.json'))
						.map((file) => {
							const filePath = path.join(this.cacheDir, file);
							return fs.unlink(filePath).catch(() => {
								// Ignore errors
							});
						})
				);
				return;
			}

			// Convert glob pattern to regex
			const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');

			// Read all files and check if they match the pattern
			for (const file of files) {
				if (!file.endsWith('.json')) continue;

				// Extract original key from filename (reverse sanitization is approximate)
				const keyBase = file.replace('.json', '');

				// We need to read the file to get the original key
				// For now, use a simple pattern match on the sanitized filename
				if (regex.test(keyBase)) {
					const filePath = path.join(this.cacheDir, file);
					await fs.unlink(filePath).catch(() => {
						// Ignore errors
					});
				}
			}
		} catch (error) {
			log.error('FileCache failed to clear cache', {
				error: error instanceof Error ? error.message : error,
			});
		}
	}

	async mget(keys: string[]): Promise<Array<unknown | null>> {
		return Promise.all(keys.map((key) => this.get(key)));
	}

	async mset(entries: Array<[string, unknown, number?]>): Promise<void> {
		await Promise.all(entries.map(([key, value, ttl]) => this.set(key, value, ttl)));
	}

	async disconnect(): Promise<void> {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
		// Don't delete cache files on disconnect - they should persist
	}

	/** Get cache statistics */
	async getStats() {
		try {
			await this.ensureInitialized();
			const files = await fs.readdir(this.cacheDir);
			const jsonFiles = files.filter((f) => f.endsWith('.json'));

			// Calculate total size
			let totalSize = 0;
			for (const file of jsonFiles) {
				const filePath = path.join(this.cacheDir, file);
				try {
					const stats = await fs.stat(filePath);
					totalSize += stats.size;
				} catch {
					// Ignore errors
				}
			}

			return {
				keys: jsonFiles.length,
				maxKeys: this.maxKeys,
				utilization: (jsonFiles.length / this.maxKeys) * 100,
				sizeBytes: totalSize,
				cacheDir: this.cacheDir,
			};
		} catch (error) {
			log.error('[FileCache] Failed to get stats:', error);
			return {
				keys: 0,
				maxKeys: this.maxKeys,
				utilization: 0,
				sizeBytes: 0,
				cacheDir: this.cacheDir,
			};
		}
	}

	/** Manually trigger cleanup of expired entries */
	async cleanup(): Promise<void> {
		await this.cleanExpired();
	}
}
