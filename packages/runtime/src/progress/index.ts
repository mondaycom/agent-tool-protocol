/**
 * Progress API - Clean refactored version with decorators
 *
 * Benefits:
 * - No duplication between implementation and metadata
 * - Types auto-detected from TypeScript signatures
 */
import { RuntimeAPI, RuntimeMethod } from '../metadata/decorators.js';
import { log } from '../log/index.js';
import type { ProgressCallback } from './types.js';

export type { ProgressCallback } from './types.js';

/**
 * Global progress callback (set by executor)
 */
let progressCallback: ProgressCallback | null = null;

/**
 * Set the progress callback handler
 */
export function setProgressCallback(callback: ProgressCallback | null): void {
	progressCallback = callback;
}

/**
 * Progress Runtime API
 *
 * Allows reporting execution progress to clients
 */
@RuntimeAPI('progress', 'Progress API - Report execution progress to clients')
class ProgressAPI {
	/**
	 * Report progress with message and completion fraction
	 */
	@RuntimeMethod('Report progress with message and completion fraction', {
		message: { description: 'Progress message' },
		fraction: { description: 'Completion fraction (0-1)' },
	})
	report(message: string, fraction: number): void {
		if (progressCallback) {
			try {
				progressCallback(message, fraction);
			} catch (error) {
				log.error('Progress callback error', { error });
			}
		}
	}
}

export const progress = new ProgressAPI();
