/**
 * Provenance Token System
 *
 * Cryptographically-signed tokens for multi-step provenance tracking
 */
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { log } from '@mondaydotcomorg/atp-runtime';
import type { ProvenanceMetadata } from './types.js';

// Forward declare CacheProvider to avoid circular dependency
interface CacheProvider {
	name: string;
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown, ttl?: number): Promise<void>;
	delete(key: string): Promise<void>;
	has?(key: string): Promise<boolean>;
	disconnect?(): Promise<void>;
}

/**
 * Token payload structure
 */
export interface TokenPayload {
	v: 1; // version
	clientId: string; // tenant isolation
	executionId: string; // prevent cross-execution replay
	createdAt: number; // timestamp
	expiresAt: number; // expiry (1hr default)
	valueDigest: string; // SHA-256 of canonical value
	metaId: string; // reference to cached metadata
}

const MAX_VALUE_SIZE = 1024 * 1024; // 1MB

/**
 * Deterministic JSON stringification with sorted keys
 */
export function stableStringify(value: unknown): string | null {
	try {
		if (value === null || value === undefined) {
			return String(value);
		}

		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return JSON.stringify(value);
		}

		if (typeof value === 'function' || typeof value === 'symbol') {
			return null;
		}

		const seen = new WeakSet();

		const replacer = (_key: string, val: unknown): unknown => {
			if (val !== null && typeof val === 'object') {
				if (seen.has(val as object)) {
					return '[Circular]';
				}
				seen.add(val as object);

				if (!Array.isArray(val)) {
					const sorted: Record<string, unknown> = {};
					const keys = Object.keys(val as Record<string, unknown>).sort();
					for (const k of keys) {
						sorted[k] = (val as Record<string, unknown>)[k];
					}
					return sorted;
				}
			}
			return val;
		};

		const result = JSON.stringify(value, replacer);
		if (result.length > MAX_VALUE_SIZE) {
			return null;
		}

		return result;
	} catch (error) {
		return null;
	}
}

/**
 * Compute SHA-256 digest of value
 */
export function computeDigest(value: unknown): string | null {
	const serialized = stableStringify(value);
	if (!serialized) {
		return null;
	}
	return crypto.createHash('sha256').update(serialized).digest('base64url');
}

/**
 * Get client secret (Phase 1: single secret from env)
 */
export function getClientSecret(clientId: string): string {
	const secret = process.env.PROVENANCE_SECRET;
	if (!secret) {
		throw new Error(
			'PROVENANCE_SECRET environment variable is required for provenance tracking. ' +
				'Generate a strong secret with: openssl rand -base64 32'
		);
	}
	// Validate secret length - must be at least 32 bytes
	// Base64 encoding: 32 bytes = 44 chars, but we'll check raw byte length
	const secretBytes = Buffer.from(secret, 'utf-8').length;
	if (secretBytes < 32) {
		throw new Error(
			`PROVENANCE_SECRET must be at least 32 bytes (currently ${secretBytes} bytes). ` +
				'Generate a strong secret with: openssl rand -base64 32'
		);
	}
	return secret;
}

/**
 * Generate HMAC signature
 */
function hmacSign(data: string, secret: string): string {
	return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Issue a provenance token for a value
 */
export async function issueProvenanceToken(
	metadata: ProvenanceMetadata,
	value: unknown,
	clientId: string,
	executionId: string,
	cacheProvider: CacheProvider,
	ttl: number = 3600
): Promise<string | null> {
	const valueDigest = computeDigest(value);
	if (!valueDigest) {
		return null;
	}

	const metaId = nanoid();
	const cacheKey = `prov:meta:${clientId}:${metaId}`;

	try {
		await cacheProvider.set(cacheKey, JSON.stringify(metadata), ttl);

		if (typeof value === 'string' || typeof value === 'number') {
			const valueKey = `prov:value:${clientId}:${valueDigest}`;
			await cacheProvider.set(valueKey, JSON.stringify({ value: String(value), metaId }), ttl);
		}
	} catch (error) {
		log.error('Failed to store provenance metadata in cache', { error });
		return null;
	}

	const payload: TokenPayload = {
		v: 1,
		clientId,
		executionId,
		createdAt: Date.now(),
		expiresAt: Date.now() + ttl * 1000,
		valueDigest,
		metaId,
	};

	const payloadStr = JSON.stringify(payload);
	const payloadB64 = Buffer.from(payloadStr).toString('base64url');
	const secret = getClientSecret(clientId);
	const signature = hmacSign(payloadB64, secret);

	return `${payloadB64}.${signature}`;
}

/**
 * Verify and extract provenance from a token
 */
export async function verifyProvenanceToken(
	token: string,
	value: unknown,
	clientId: string,
	executionId: string,
	cacheProvider: CacheProvider
): Promise<ProvenanceMetadata | null> {
	try {
		const parts = token.split('.');
		if (parts.length !== 2) {
			return null;
		}

		const [payloadB64, signature] = parts;
		if (!payloadB64 || !signature) {
			return null;
		}

		const secret = getClientSecret(clientId);
		const expectedSig = hmacSign(payloadB64, secret);

		// Use constant-time comparison to prevent timing attacks
		try {
			const sigBuf = Buffer.from(signature, 'base64url');
			const expectedBuf = Buffer.from(expectedSig, 'base64url');

			if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
				log.error('Token signature verification failed');
				return null;
			}
		} catch (error) {
			log.error('Token signature comparison error', { error });
			return null;
		}

		const payloadStr = Buffer.from(payloadB64, 'base64url').toString();
		const payload: TokenPayload = JSON.parse(payloadStr);

		if (payload.v !== 1) {
			log.error('Unsupported token version', { version: payload.v });
			return null;
		}

		if (payload.clientId !== clientId) {
			log.error('Token clientId mismatch', {
				tokenClientId: payload.clientId,
				expectedClientId: clientId,
			});
			return null;
		}

		if (payload.executionId !== executionId) {
			log.error('Token executionId mismatch', {
				tokenExecutionId: payload.executionId,
				expectedExecutionId: executionId,
			});
			return null;
		}

		if (Date.now() > payload.expiresAt) {
			log.warn('Token expired');
			return null;
		}

		const valueDigest = computeDigest(value);
		if (!valueDigest || valueDigest !== payload.valueDigest) {
			log.warn('Token value digest mismatch (value may have been modified)');
			return null;
		}

		const cacheKey = `prov:meta:${payload.clientId}:${payload.metaId}`;
		const metaStr = await cacheProvider.get(cacheKey);

		if (!metaStr || typeof metaStr !== 'string') {
			log.warn('Token metadata not found in cache (expired or evicted)');
			return null;
		}

		const metadata: ProvenanceMetadata = JSON.parse(metaStr);
		return metadata;
	} catch (error) {
		log.error('Token verification error', { error });
		return null;
	}
}

/**
 * Verify multiple hints and build a digest → metadata map
 * Returns map for O(1) lookup during re-attachment
 * ALSO returns a value → metadata map for substring matching
 */
export async function verifyProvenanceHints(
	hints: string[],
	clientId: string,
	executionId: string,
	cacheProvider: CacheProvider,
	maxHints: number = 1000
): Promise<Map<string, ProvenanceMetadata>> {
	const map = new Map<string, ProvenanceMetadata>();

	const hintsToProcess = hints.slice(0, maxHints);
	if (hints.length > maxHints) {
		log.warn(`Capped provenance hints from ${hints.length} to ${maxHints}`);
	}

	const timeout = 100;
	const promises = hintsToProcess.map(async (token) => {
		try {
			const parts = token.split('.');
			if (parts.length !== 2) return;

			const [payloadB64] = parts;
			if (!payloadB64) return;

			const payloadStr = Buffer.from(payloadB64, 'base64url').toString();
			const payload: TokenPayload = JSON.parse(payloadStr);

			const cacheKey = `prov:meta:${payload.clientId}:${payload.metaId}`;

			const fetchPromise = cacheProvider.get(cacheKey);
			const timeoutPromise = new Promise<null>((resolve) =>
				setTimeout(() => resolve(null), timeout)
			);

			const metaStr = await Promise.race([fetchPromise, timeoutPromise]);

			if (metaStr && typeof metaStr === 'string') {
				const metadata: ProvenanceMetadata = JSON.parse(metaStr);
				map.set(payload.valueDigest, metadata);

				const valueKey = `prov:value:${payload.clientId}:${payload.valueDigest}`;
				const valueStr = await Promise.race([
					cacheProvider.get(valueKey),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
				]);

				if (valueStr && typeof valueStr === 'string') {
					try {
						const { value } = JSON.parse(valueStr);
						(map as any).__valueMap = (map as any).__valueMap || new Map();
						(map as any).__valueMap.set(value, metadata);
					} catch (e) {
						// Value parsing failed, skip
					}
				}
			}
		} catch (error) {
			// Skip invalid tokens silently
		}
	});

	await Promise.all(promises);

	return map;
}
