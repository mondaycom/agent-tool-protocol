import pino from 'pino';
import type { LogLevel, LoggerConfig, Logger } from './types.js';

export type { LogLevel, LoggerConfig, Logger } from './types.js';

let logger: pino.Logger | null = null;

/**
 * Initializes the logger with configuration
 */
export function initializeLogger(config?: LoggerConfig): void {
	const pinoLevel = config?.level === 'none' ? 'silent' : (config?.level ?? 'info');
	const options: pino.LoggerOptions = {
		level: pinoLevel,
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level: (label) => {
				return { level: label };
			},
		},
		redact: {
			paths: config?.redact ?? ['apiKey', 'password', '*.apiKey', '*.password', 'authorization'],
			censor: '[REDACTED]',
		},
	};

	if (config?.pretty) {
		logger = pino({
			...options,
			transport: {
				target: 'pino-pretty',
				options: {
					colorize: true,
					translateTime: 'SYS:standard',
					ignore: 'pid,hostname',
				},
			},
		});
	} else if (config?.destination && config.destination !== 'stdout') {
		logger = pino(options, pino.destination(config.destination));
	} else {
		logger = pino(options);
	}
}

/**
 * Gets or initializes the logger
 */
function getLogger(): pino.Logger {
	if (!logger) {
		initializeLogger({ level: 'info', pretty: false });
	}
	return logger!;
}

export const log: Logger = {
	/**
	 * Logs an informational message
	 */
	info(message: string, data?: unknown): void {
		const l = getLogger();
		if (data) {
			l.info(data, message);
		} else {
			l.info(message);
		}
	},

	/**
	 * Logs a warning message
	 */
	warn(message: string, data?: unknown): void {
		const l = getLogger();
		if (data) {
			l.warn(data, message);
		} else {
			l.warn(message);
		}
	},

	/**
	 * Logs an error message
	 */
	error(message: string, data?: unknown): void {
		const l = getLogger();
		if (data) {
			l.error(data, message);
		} else {
			l.error(message);
		}
	},

	/**
	 * Logs a debug message
	 */
	debug(message: string, data?: unknown): void {
		const l = getLogger();
		if (data) {
			l.debug(data, message);
		} else {
			l.debug(message);
		}
	},

	/**
	 * Logs a fatal error message
	 */
	fatal(message: string, data?: unknown): void {
		const l = getLogger();
		if (data) {
			l.fatal(data, message);
		} else {
			l.fatal(message);
		}
	},

	/**
	 * Creates a child logger with additional context
	 */
	child(bindings: Record<string, unknown>): typeof log {
		const childLogger = getLogger().child(bindings);
		return {
			info: (message: string, data?: unknown) => {
				if (data) {
					childLogger.info(data, message);
				} else {
					childLogger.info(message);
				}
			},
			warn: (message: string, data?: unknown) => {
				if (data) {
					childLogger.warn(data, message);
				} else {
					childLogger.warn(message);
				}
			},
			error: (message: string, data?: unknown) => {
				if (data) {
					childLogger.error(data, message);
				} else {
					childLogger.error(message);
				}
			},
			debug: (message: string, data?: unknown) => {
				if (data) {
					childLogger.debug(data, message);
				} else {
					childLogger.debug(message);
				}
			},
			fatal: (message: string, data?: unknown) => {
				if (data) {
					childLogger.fatal(data, message);
				} else {
					childLogger.fatal(message);
				}
			},
			child: log.child,
		};
	},
};

/**
 * Shuts down the logger (for cleanup in tests)
 */
export function shutdownLogger(): void {
	logger = null;
}
