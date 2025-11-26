/**
 * Log API Types
 */

export type LogLevel = 'none' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerConfig {
	level: LogLevel;
	pretty?: boolean;
	destination?: string;
	redact?: string[];
}

export interface Logger {
	info(message: string, data?: unknown): void;
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
	debug(message: string, data?: unknown): void;
	fatal(message: string, data?: unknown): void;
	child(bindings: Record<string, unknown>): Logger;
}
