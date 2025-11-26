import type { AuditEvent, AuditFilter, AuditSink } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * JSONL (JSON Lines) audit sink
 * Writes audit events to a file, one JSON object per line
 * Simple, append-only, easy to parse with standard tools
 */
export class JSONLAuditSink implements AuditSink {
	name = 'jsonl';
	private filePath: string;
	private sanitizeSecrets: boolean;
	private buffer: AuditEvent[] = [];
	private flushInterval: NodeJS.Timeout | null = null;
	private batchSize: number;

	constructor(options: {
		filePath: string;
		sanitizeSecrets?: boolean;
		batchSize?: number;
		flushIntervalMs?: number;
	}) {
		this.filePath = options.filePath;
		this.sanitizeSecrets = options.sanitizeSecrets ?? true;
		this.batchSize = options.batchSize || 10;

		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			mkdir(dir, { recursive: true }).catch((err) => {
				log.error('Failed to create audit directory', { error: err.message });
			});
		}

		if (options.flushIntervalMs) {
			this.flushInterval = setInterval(() => {
				if (this.buffer.length > 0) {
					this.flush().catch((err) => {
						log.error('Failed to flush audit buffer', { error: err.message });
					});
				}
			}, options.flushIntervalMs);
		}
	}

	async write(event: AuditEvent): Promise<void> {
		const sanitized = this.sanitizeSecrets ? this.sanitizeEvent(event) : event;
		const line = JSON.stringify(sanitized) + '\n';

		try {
			await appendFile(this.filePath, line, 'utf8');
		} catch (error) {
			log.error('Failed to write audit event', { error: (error as Error).message });
			throw error;
		}
	}

	async writeBatch(events: AuditEvent[]): Promise<void> {
		const sanitized = this.sanitizeSecrets ? events.map((e) => this.sanitizeEvent(e)) : events;

		const lines = sanitized.map((e) => JSON.stringify(e)).join('\n') + '\n';

		try {
			await appendFile(this.filePath, lines, 'utf8');
		} catch (error) {
			log.error('Failed to write audit batch', { error: (error as Error).message });
			throw error;
		}
	}

	async query(filter: AuditFilter): Promise<AuditEvent[]> {
		try {
			const content = await readFile(this.filePath, 'utf8');
			const lines = content.split('\n').filter((line) => line.trim());
			const events: AuditEvent[] = lines.map((line) => JSON.parse(line));

			return events
				.filter((event) => {
					if (filter.clientId && event.clientId !== filter.clientId) return false;
					if (filter.userId && event.userId !== filter.userId) return false;
					if (filter.from && event.timestamp < filter.from) return false;
					if (filter.to && event.timestamp > filter.to) return false;
					if (filter.resource && event.resource !== filter.resource) return false;

					if (filter.eventType) {
						const types = Array.isArray(filter.eventType) ? filter.eventType : [filter.eventType];
						if (!types.includes(event.eventType)) return false;
					}

					if (filter.status) {
						const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
						if (!statuses.includes(event.status)) return false;
					}

					if (filter.minRiskScore && (event.riskScore || 0) < filter.minRiskScore) return false;

					return true;
				})
				.slice(filter.offset || 0, (filter.offset || 0) + (filter.limit || 100));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		if (this.flushInterval) {
			clearInterval(this.flushInterval);
		}

		if (this.buffer.length > 0) {
			await this.flush();
		}
	}

	private async flush(): Promise<void> {
		if (this.buffer.length === 0) return;

		await this.writeBatch([...this.buffer]);
		this.buffer = [];
	}

	private sanitizeEvent(event: AuditEvent): AuditEvent {
		const sanitized = { ...event };

		if (sanitized.code) {
			sanitized.code = this.sanitizeString(sanitized.code);
		}

		if (sanitized.input) {
			sanitized.input = this.sanitizeObject(sanitized.input);
		}
		if (sanitized.output) {
			sanitized.output = this.sanitizeObject(sanitized.output);
		}

		return sanitized;
	}

	private sanitizeString(str: string): string {
		const patterns = [
			/api[_-]?key/gi,
			/secret/gi,
			/token/gi,
			/password/gi,
			/bearer/gi,
			/authorization/gi,
		];

		for (const pattern of patterns) {
			str = str.replace(
				new RegExp(`(${pattern.source})\\s*[:=]\\s*['\"]?([^'\"\\s]+)`, 'gi'),
				'$1: [REDACTED]'
			);
		}

		return str;
	}

	private sanitizeObject(obj: unknown): unknown {
		if (typeof obj !== 'object' || obj === null) {
			return obj;
		}

		if (Array.isArray(obj)) {
			return obj.map((item) => this.sanitizeObject(item));
		}

		const sanitized: Record<string, unknown> = {};
		const secretPatterns = ['key', 'secret', 'token', 'password', 'bearer', 'auth'];

		for (const [key, value] of Object.entries(obj)) {
			const lowerKey = key.toLowerCase();

			if (secretPatterns.some((pattern) => lowerKey.includes(pattern))) {
				sanitized[key] = '[REDACTED]';
			} else if (typeof value === 'object') {
				sanitized[key] = this.sanitizeObject(value);
			} else {
				sanitized[key] = value;
			}
		}

		return sanitized;
	}
}
