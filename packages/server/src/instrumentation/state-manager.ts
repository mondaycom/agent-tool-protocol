/**
 * State Manager for Execution State Capture and Restoration
 */
import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';
import { Serializer } from './serializer.js';
import type { BranchDecision, ExecutionState, SerializedValue, StatementState } from './types.js';

export class StateManager {
	private state: ExecutionState;
	private resumeMode: boolean = false;
	private serializer: Serializer;
	private captureInterval: number;
	private statementCounter: number = 0;

	constructor(
		private executionId: string,
		private clientId: string,
		private cache: CacheProvider | undefined,
		private logger: ReturnType<typeof log.child>,
		options?: { captureInterval?: number }
	) {
		this.serializer = new Serializer();
		this.captureInterval = options?.captureInterval || 10;

		this.state = {
			executionId,
			clientId,
			currentStatementId: -1,
			statements: [],
			variables: [],
			controlFlow: [],
		};
	}

	/**
	 * Capture state at a statement boundary
	 * In resume mode, skip already-executed statements
	 */
	async capture(statementId: number, getVars: () => Record<string, unknown>): Promise<void> {
		this.logger.debug('State capture', { statementId, resumeMode: this.resumeMode });

		if (this.resumeMode) {
			const cached = this.findStatement(statementId);
			if (cached) {
				this.logger.debug('Skipping cached statement', { statementId });
				return;
			}
		}

		const vars = getVars();
		const serializedVars: Record<string, SerializedValue> = {};

		for (const [name, value] of Object.entries(vars)) {
			try {
				serializedVars[name] = this.serializer.serialize(value, vars);
			} catch (e) {
				this.logger.warn('Failed to serialize variable', { name, error: e });
			}
		}

		const statementState: StatementState = {
			id: statementId,
			executed: true,
			variables: serializedVars,
			timestamp: Date.now(),
		};

		this.state.statements.push([statementId, statementState]);
		this.state.currentStatementId = statementId;
		this.statementCounter++;

		if (this.cache && this.statementCounter % this.captureInterval === 0) {
			await this.persist();
		}
	}

	/**
	 * Wrap external calls with caching
	 */
	async call<T>(statementId: number, fn: () => T | Promise<T>): Promise<T> {
		if (this.resumeMode) {
			const cached = this.findStatement(statementId);
			if (cached && cached.result !== undefined) {
				this.logger.debug('Using cached call result', { statementId });
				return this.serializer.deserialize(cached.result) as T;
			}
		}

		this.logger.debug('Executing call', { statementId });
		const result = await fn();

		try {
			const serialized = this.serializer.serialize(result);
			const statement = this.findStatement(statementId);
			if (statement) {
				statement.result = serialized;
			}
		} catch (e) {
			this.logger.warn('Failed to serialize call result', { statementId });
		}

		if (this.cache) {
			await this.persist();
		}

		return result;
	}

	/**
	 * Check if a call result is cached (for use from isolate)
	 */
	getCached(statementId: number): unknown | null {
		if (this.resumeMode) {
			const cached = this.findStatement(statementId);
			if (cached && cached.result !== undefined) {
				return this.serializer.deserialize(cached.result);
			}
		}
		return null;
	}

	/**
	 * Store a call result (for use from isolate)
	 */
	async storeResult(statementId: number, result: unknown): Promise<void> {
		try {
			const serialized = this.serializer.serialize(result);
			let statement = this.findStatement(statementId);
			if (!statement) {
				statement = {
					id: statementId,
					executed: true,
					variables: {},
					timestamp: Date.now(),
				};
				this.state.statements.push([statementId, statement]);
			}
			statement.result = serialized;
			if (this.cache) {
				await this.persist();
			}
		} catch (e) {
			this.logger.warn('Failed to serialize and store call result', { statementId, error: e });
		}
	}

	/**
	 * Track control flow branches
	 */
	branch(statementId: number, condition: boolean): boolean {
		this.logger.debug('Branch decision', { statementId, condition });

		if (this.resumeMode) {
			const cached = this.state.controlFlow.find((b) => b.statementId === statementId);
			if (cached) {
				this.logger.debug('Using cached branch decision', {
					statementId,
					decision: cached.taken,
				});
				return cached.taken;
			}
		}

		const decision: BranchDecision = {
			statementId,
			taken: condition,
			timestamp: Date.now(),
		};
		this.state.controlFlow.push(decision);

		return condition;
	}

	/**
	 * Persist state to cache
	 */
	/**
	 * Persist current execution state to cache
	 */
	async persist(): Promise<void> {
		if (!this.cache) return;

		const key = this.getCacheKey();

		try {
			await this.cache.set(key, this.state, 3600);

			this.logger.debug('State persisted', {
				executionId: this.executionId,
				statements: this.state.statements.length,
			});
		} catch (e) {
			this.logger.error('Failed to persist state', { error: e });
		}
	}

	/**
	 * Load state for resume
	 */
	async loadForResume(executionId: string): Promise<boolean> {
		if (!this.cache) {
			this.logger.warn('Cannot load state: no cache provider');
			return false;
		}

		const key = `execution-state:${this.clientId}:${executionId}`;

		try {
			const persisted = await this.cache.get<ExecutionState>(key);

			if (!persisted) {
				this.logger.debug('No persisted state found (expected for new executions)', {
					executionId,
				});
				return false;
			}

			this.state = persisted;
			this.resumeMode = true;

			this.logger.info('State loaded for resume', {
				executionId,
				statements: this.state.statements.length,
				currentStatement: this.state.currentStatementId,
			});

			return true;
		} catch (e) {
			this.logger.error('Failed to load state', { error: e });
			return false;
		}
	}

	/**
	 * Cleanup state from cache
	 */
	async cleanup(): Promise<void> {
		if (!this.cache) return;

		const key = this.getCacheKey();

		try {
			await this.cache.delete(key);
			this.logger.debug('State cleaned up', { executionId: this.executionId });
		} catch (e) {
			this.logger.warn('Failed to cleanup state', { error: e });
		}
	}

	/**
	 * Get execution progress
	 */
	getProgress(): number {
		if (this.state.statements.length === 0) return 0;
		return (this.state.currentStatementId / this.state.statements.length) * 100;
	}

	/**
	 * Get statistics
	 */
	getStats(): { statementsExecuted: number; statementsCached: number } {
		return {
			statementsExecuted: this.state.statements.length,
			statementsCached: this.resumeMode ? this.state.statements.length : 0,
		};
	}

	private findStatement(id: number): StatementState | undefined {
		const entry = this.state.statements.find(([sid]) => sid === id);
		return entry ? entry[1] : undefined;
	}

	private getCacheKey(): string {
		return `execution-state:${this.clientId}:${this.executionId}`;
	}
}
