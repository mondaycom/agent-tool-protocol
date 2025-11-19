import { resetAllExecutionState, cleanupOldExecutionStates } from '@mondaydotcomorg/atp-runtime';

/**
 * Global test setup - runs before each test file
 *
 * This ensures that execution state is properly cleaned up between tests
 * to prevent test pollution and state leakage.
 */

beforeEach(() => {
	resetAllExecutionState();
	if (global.gc) {
		global.gc();
	}
});

afterEach(() => {
	resetAllExecutionState();
	cleanupOldExecutionStates(0);
	if (global.gc) {
		global.gc();
	}
});

if (typeof afterAll !== 'undefined') {
	afterAll(() => {
		resetAllExecutionState();
		cleanupOldExecutionStates(0);
		if (global.gc) {
			try {
				global.gc();
				global.gc();
			} catch (e) {
				// Ignore if GC not available
			}
		}
	});
}
