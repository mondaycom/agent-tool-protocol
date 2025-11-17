import { resetAllExecutionState } from '@mondaydotcomorg/atp-runtime';

/**
 * Global test setup - runs before each test file
 * 
 * This ensures that execution state is properly cleaned up between tests
 * to prevent test pollution and state leakage.
 */

beforeEach(() => {
	resetAllExecutionState();
});

afterEach(() => {
	resetAllExecutionState();
});

