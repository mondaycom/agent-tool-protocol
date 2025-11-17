/**
 * Default Detection Plugin
 * Wraps the existing AsyncIterationDetector
 */

import type * as t from '@babel/types';
import type { DetectionPlugin } from '../plugin-api.js';
import type { CompilerConfig, AsyncPattern, DetectionResult } from '../../types.js';
import { AsyncIterationDetector } from '../../transformer/detector.js';

export class DefaultDetectionPlugin implements DetectionPlugin {
	name = 'atp-default-detector';
	version = '1.0.0';
	priority = 100;
	patterns: AsyncPattern[] = [
		'for-of-await',
		'while-await',
		'map-async',
		'forEach-async',
		'filter-async',
		'reduce-async',
		'find-async',
		'some-async',
		'every-async',
		'flatMap-async',
		'promise-all',
		'promise-allSettled',
	];

	private detector: AsyncIterationDetector;

	constructor() {
		this.detector = new AsyncIterationDetector();
	}

	async detect(code: string, ast: t.File): Promise<DetectionResult> {
		// Use existing detector
		return this.detector.detect(code);
	}
}

