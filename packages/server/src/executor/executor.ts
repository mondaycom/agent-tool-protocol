import ivm from 'isolated-vm';
import type {
	APIGroupConfig,
	ClientToolDefinition,
	ExecutionConfig,
	ExecutionResult,
} from '@mondaydotcomorg/atp-protocol';
import { ExecutionStatus, ProvenanceMode } from '@mondaydotcomorg/atp-protocol';
import {
	clearVectorStoreExecutionId,
	initializeApproval,
	initializeVectorStore,
	log,
	runInExecutionContext,
	setPauseForClient,
	setProgressCallback,
	setReplayMode,
	setVectorStoreExecutionId,
} from '@mondaydotcomorg/atp-runtime';
import { nanoid } from 'nanoid';
import type { CallbackRecord } from '../execution-state/index.js';
import type { ClientSessionManager } from '../client-sessions.js';
import { BOOTSTRAP_CODE } from './bootstrap-generated.js';
import type { ExecutorConfig, RuntimeContext } from './types.js';
import { SandboxBuilder } from './sandbox-builder.js';
import { CodeInstrumentor, StateManager } from '../instrumentation/index.js';
import { ATP_COMPILER_ENABLED } from './constants.js';
import { getCompilerRuntime, transformCodeWithCompiler } from './compiler-config.js';
import { setupResumeExecution } from './resume-handler.js';
import {
	injectSandbox,
	injectTimerPolyfills,
	setupAPINamespace,
	setupRuntimeNamespace,
} from './sandbox-injector.js';
import { handleExecutionError } from './execution-error-handler.js';
import {
	captureProvenanceSnapshot,
	cleanupProvenanceForExecution,
	clearProvenanceExecutionId,
	createTrackingRuntime,
	instrumentCode as astInstrumentCode,
	registerProvenanceMetadata,
	SecurityPolicyEngine,
	setProvenanceExecutionId,
} from '@mondaydotcomorg/atp-provenance';
import {
	createASTProvenanceChecker,
	registerIsolateContext,
	unregisterIsolateContext,
} from './ast-provenance-bridge.js';
import { instrumentLiteralsFromHints } from '../utils/hint-based-instrumentation.js';
import { getHintMap } from '../utils/provenance-reattachment.js';

export class SandboxExecutor {
	private config: ExecutorConfig;
	private sandboxBuilder: SandboxBuilder;
	private approvalHandler?: (request: any) => Promise<any>;
	private sessionManager?: ClientSessionManager;

	constructor(
		config: ExecutorConfig,
		apiGroups: APIGroupConfig[] = [],
		approvalHandler?: (request: any) => Promise<any>,
		sessionManager?: ClientSessionManager
	) {
		this.config = config;
		this.sandboxBuilder = new SandboxBuilder(apiGroups);
		this.approvalHandler = approvalHandler;
		this.sessionManager = sessionManager;
	}

	async execute(
		code: string,
		config: ExecutionConfig,
		clientId?: string,
		resumeData?: {
			callbackHistory: CallbackRecord[];
			newCallbackResult: unknown;
			executionId?: string;
		}
	): Promise<ExecutionResult> {
		const executionId = resumeData?.executionId || nanoid();

		return runInExecutionContext(executionId, async () => {
			return await this.executeInContext(
				executionId,
				clientId || 'anonymous',
				code,
				config,
				resumeData
			);
		});
	}

	private async executeInContext(
		executionId: string,
		clientId: string,
		code: string,
		config: ExecutionConfig,
		resumeData?: {
			callbackHistory: CallbackRecord[];
			newCallbackResult: unknown;
		}
	): Promise<ExecutionResult & { transformedCode?: string }> {
		const context: RuntimeContext = {
			llmCallCount: 0,
			approvalCallCount: 0,
			logs: [],
			startTime: Date.now(),
			maxLLMCalls: config.maxLLMCalls,
			executionId,
			clientId,
		};

		setVectorStoreExecutionId(executionId);
		initializeVectorStore(executionId);

		const executionLogger = log.child({ executionId, clientId });

		if (config.provenanceMode && config.provenanceMode !== ProvenanceMode.NONE) {
			setProvenanceExecutionId(executionId);
			executionLogger.debug('Provenance execution tracking initialized', { executionId });
		}

		if (this.approvalHandler) {
			initializeApproval(async (request: { message: any }) => {
				executionLogger.debug('Approval requested', { message: request.message });
				return await this.approvalHandler!(request);
			});
			executionLogger.debug('Approval handler initialized');
		}

		let stateManager: StateManager | null = null;
		if (this.config.cacheProvider) {
			stateManager = new StateManager(
				executionId,
				clientId,
				this.config.cacheProvider,
				executionLogger
			);

			if (resumeData) {
				const loaded = await stateManager.loadForResume(executionId);
				if (loaded) {
					executionLogger.info('State loaded for resume', {
						executionId,
						statementsRestored: stateManager.getStats().statementsExecuted,
					});
				}
			}
		}

		if (config.progressCallback) {
			setProgressCallback(config.progressCallback);
		}

		const callbackHistory: CallbackRecord[] = [];

		if (resumeData) {
			setupResumeExecution(resumeData, callbackHistory, executionLogger);
		}

		if (
			config.clientServices &&
			(config.clientServices.hasLLM ||
				config.clientServices.hasApproval ||
				config.clientServices.hasEmbedding ||
				config.clientServices.hasTools)
		) {
			setPauseForClient(true);
			executionLogger.debug('Client services detected, pause mode enabled', {
				hasLLM: config.clientServices.hasLLM,
				hasApproval: config.clientServices.hasApproval,
				hasEmbedding: config.clientServices.hasEmbedding,
				hasTools: config.clientServices.hasTools,
			});
		}

		const isolate = new ivm.Isolate({
			memoryLimit: Math.floor(config.maxMemory / (1024 * 1024)),
		});

		const memoryBefore = process.memoryUsage().heapUsed;

		let pauseError: unknown = null;
		const onPauseError = (error: unknown) => {
			pauseError = error;
		};

		let codeToExecute = code;
		let alreadyTransformed = false;

		try {
			const ivmContext = await isolate.createContext();
			const jail = ivmContext.global;

			await jail.set('global', jail.derefInto());

			await injectTimerPolyfills(ivmContext);

			let result: unknown = null;

			const provenanceMode = config.provenanceMode || ProvenanceMode.NONE;
			let policyEngine: SecurityPolicyEngine | undefined;
			let astTracker: ReturnType<typeof createTrackingRuntime> | undefined;

			if (
				provenanceMode !== ProvenanceMode.NONE &&
				config.securityPolicies &&
				config.securityPolicies.length > 0
			) {
				policyEngine = new SecurityPolicyEngine(config.securityPolicies, executionLogger);

				if (this.approvalHandler) {
					policyEngine.setApprovalCallback(
						async (message: string, context: Record<string, unknown>) => {
							executionLogger.debug('Policy engine requesting approval', { message, context });
							const response = await this.approvalHandler!({ message, context });
							return response.approved === true;
						}
					);
					executionLogger.debug('Approval callback connected to policy engine');
				}

				executionLogger.info('Security policy engine initialized', {
					provenanceMode,
					policies: config.securityPolicies.map((p) => p.name),
					hasApprovalCallback: !!this.approvalHandler,
				});
			}

			if (provenanceMode === ProvenanceMode.AST) {
				registerIsolateContext(executionId, ivmContext);
				executionLogger.info('Registered isolate context for AST provenance bridge', {
					executionId,
				});

				if (policyEngine) {
					const astChecker = createASTProvenanceChecker(executionId);
					policyEngine.setGetProvenance(astChecker);
					executionLogger.info('Set AST provenance checker for policy engine', { executionId });
				}
			}

			if (provenanceMode === ProvenanceMode.AST) {
				astTracker = createTrackingRuntime();
				executionLogger.debug('AST provenance tracker initialized');
			}

			let clientTools: ClientToolDefinition[] = [];
			if (this.sessionManager && clientId && clientId !== 'anonymous') {
				try {
					const session = await this.sessionManager.getSession(clientId);
					if (session?.tools && session.tools.length > 0) {
						clientTools = session.tools;
					}
				} catch (error) {}
			}

			const sandbox = this.sandboxBuilder.createSandbox(
				context,
				config,
				executionLogger,
				executionId,
				policyEngine,
				clientTools
			);

			if (astTracker) {
				Object.assign(sandbox, astTracker.runtime);
				executionLogger.debug('AST tracking runtime injected into sandbox', {
					runtimeFunctions: Object.keys(astTracker.runtime),
				});
			}

			if (stateManager) {
				sandbox.__state = {
					capture: async (statementId: number, getVars: () => Record<string, unknown>) => {
						return await stateManager.capture(statementId, getVars);
					},
					call: async (statementId: number, fn: () => unknown) => {
						return await stateManager.call(statementId, fn);
					},
					branch: (statementId: number, condition: boolean) => {
						return stateManager.branch(statementId, condition);
					},
				};
			}

			if (ATP_COMPILER_ENABLED) {
				sandbox.__runtime = getCompilerRuntime();
			}

			let hintMetadata: Map<string, any> | undefined;
			if (provenanceMode === ProvenanceMode.AST) {
				hintMetadata = getHintMap(executionId);

				if (hintMetadata && hintMetadata.size > 0) {
					for (const [digest, metadata] of hintMetadata.entries()) {
						executionLogger.info('Registering hint by digest', {
							digest: digest.substring(0, 20),
							hasSource: !!metadata?.source,
							sourceType: metadata?.source?.type,
							metadataKeys: metadata ? Object.keys(metadata) : [],
						});
						registerProvenanceMetadata(digest, metadata, executionId);
					}
					executionLogger.info('Registered hint metadata in host registry', {
						hintCount: hintMetadata.size,
					});
				}
			}

			await injectSandbox(
				ivmContext,
				jail,
				sandbox,
				executionLogger,
				onPauseError,
				executionId,
				provenanceMode,
				hintMetadata
			);

			await ivmContext.eval(BOOTSTRAP_CODE);

			await setupAPINamespace(ivmContext, sandbox, provenanceMode);

			if (ATP_COMPILER_ENABLED) {
				await setupRuntimeNamespace(ivmContext, sandbox);
			}

			let useCompiler = false;
			let astInstrumented = false;

			const isResume = resumeData !== undefined;
			const isAlreadyWrapped = code.trim().startsWith('(async function');
			alreadyTransformed = isAlreadyWrapped;

			if (isAlreadyWrapped && provenanceMode === ProvenanceMode.AST) {
				astInstrumented = true;
				executionLogger.info('Code already AST-instrumented (from previous execution)', {
					codeLength: code.length,
					isResume,
				});
			}

			executionLogger.info('Instrumentation decision', {
				provenanceMode,
				useCompiler,
				alreadyTransformed,
				isResume,
				resumeDataPresent: !!resumeData,
				astCondition: provenanceMode === ProvenanceMode.AST && !useCompiler && !alreadyTransformed,
				codeLength: code.length,
				codePreview: code.substring(0, 100),
			});

			if (provenanceMode === ProvenanceMode.AST && !useCompiler && !alreadyTransformed) {
				try {
					const instrumentResult = astInstrumentCode(code);
					codeToExecute = instrumentResult.code;
					astInstrumented = true;
					executionLogger.info('Code instrumented for provenance tracking (AST mode)', {
						trackingCalls: instrumentResult.metadata.trackingCalls,
						instrumentedCodeStart: codeToExecute.substring(0, 150),
						instrumentedCodeEnd: codeToExecute.substring(codeToExecute.length - 150),
					});

					if (hintMetadata && hintMetadata.size > 0) {
						const hintInstrumented = instrumentLiteralsFromHints(codeToExecute, hintMetadata);
						if (hintInstrumented.taintedCount > 0) {
							codeToExecute = hintInstrumented.code;
							executionLogger.info('Applied hint instrumentation to AST code', {
								taintedCount: hintInstrumented.taintedCount,
								hintsAvailable: hintMetadata.size,
								finalCodeStart: codeToExecute.substring(0, 200),
								finalCodeEnd: codeToExecute.substring(codeToExecute.length - 200),
							});
						}
					}
				} catch (error) {
					executionLogger.warn(
						'Failed to instrument code for provenance, executing without tracking',
						{
							error: error instanceof Error ? error.message : String(error),
							codeLength: code.length,
							codeStart: code.substring(0, 100),
							codeEnd: code.substring(code.length - 100),
						}
					);
				}
			}

			if (
				ATP_COMPILER_ENABLED &&
				this.config.cacheProvider &&
				!astInstrumented &&
				!alreadyTransformed
			) {
				const compilerResult = await transformCodeWithCompiler(
					code,
					executionId,
					this.config.cacheProvider,
					executionLogger
				);
				codeToExecute = compilerResult.code;
				useCompiler = compilerResult.useCompiler;
			} else if (alreadyTransformed) {
				codeToExecute = code;
				useCompiler = true;
				executionLogger.debug('Using already-transformed code on resume');
			}

			if (!useCompiler && !astInstrumented && stateManager) {
				try {
					const instrumentor = new CodeInstrumentor();
					const instrumented = instrumentor.instrument(code);
					codeToExecute = instrumented.code;
					executionLogger.debug('Code instrumented for state capture', {
						statements: instrumented.metadata.statements.length,
						variables: instrumented.metadata.variables.size,
						functions: instrumented.metadata.functions.length,
					});
				} catch (error) {
					executionLogger.warn('Failed to instrument code, executing without state capture', {
						error:
							error instanceof Error
								? {
										message: error.message,
										stack: error.stack,
										name: error.name,
									}
								: String(error),
					});
				}
			}

			const wrappedCode = astInstrumented
				? `${codeToExecute}()`
				: `
		(async function() {
			${codeToExecute}
		})();
	`;

			executionLogger.debug('Final wrapped code', {
				astInstrumented,
				codeLength: wrappedCode.length,
				codeStart: wrappedCode.substring(0, 200),
				codeEnd: wrappedCode.substring(wrappedCode.length - 100),
			});

			const script = await isolate.compileScript(wrappedCode);
			result = await script.run(ivmContext, { timeout: config.timeout, promise: true, copy: true });

			if (pauseError) {
				throw pauseError;
			}

			const memoryAfter = process.memoryUsage().heapUsed;
			const memoryUsed = Math.max(0, memoryAfter - memoryBefore);

			if (stateManager) {
				await stateManager.persist();
				executionLogger.info('Final state persisted', {
					executionId,
					statements: stateManager.getStats().statementsExecuted,
				});
			}

			if (provenanceMode === ProvenanceMode.AST && ivmContext) {
				try {
					const trackTest = await ivmContext.eval(
						`
						(function() {
							if (typeof globalThis.__track !== 'function') {
								return { error: '__track not found', type: typeof globalThis.__track };
							}
							try {
								const testObj = { test: 'value' };
								const tracked = globalThis.__track(testObj, { type: 'tool', tool: 'test' }, []);
								const metadata = globalThis.__get_all_metadata ? globalThis.__get_all_metadata() : [];
								return { success: true, metadataCount: metadata.length, tracked: !!tracked };
							} catch (e) {
								return { error: String(e) };
							}
						})()
					`,
						{ copy: true }
					);
					executionLogger.info('Track function test', trackTest);

					const metadataArray = await ivmContext.eval(
						'globalThis.__get_all_metadata ? globalThis.__get_all_metadata() : []',
						{ copy: true }
					);
					executionLogger.info('Extracted AST metadata from isolate', {
						entries: Array.isArray(metadataArray) ? metadataArray.length : 0,
					});

					if (Array.isArray(metadataArray) && metadataArray.length > 0) {
						for (const [id, metadata] of metadataArray) {
							executionLogger.info('Registering metadata', {
								id,
								idType: typeof id,
								hasMetadata: !!metadata,
								metadataKeys: metadata ? Object.keys(metadata) : [],
							});
							registerProvenanceMetadata(id, metadata, executionId);
						}

						executionLogger.info('Linked AST metadata to host registry', {
							count: metadataArray.length,
						});
					}
				} catch (error) {
					executionLogger.warn('Failed to extract AST metadata from isolate', {
						error: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					});
				}
			}

			ivmContext.release();
			isolate.dispose();

			const stats: any = {
				duration: Date.now() - context.startTime,
				memoryUsed,
				llmCallsCount: context.llmCallCount,
				approvalCallsCount: context.approvalCallCount,
			};

			if (stateManager) {
				const captureStats = stateManager.getStats();
				stats.statementsExecuted = captureStats.statementsExecuted;
				stats.statementsCached = captureStats.statementsCached;
			}

			let provenanceSnapshot: unknown;
			if (provenanceMode !== ProvenanceMode.NONE) {
				try {
					provenanceSnapshot = captureProvenanceSnapshot(executionId);
					executionLogger.debug('Provenance snapshot captured', {
						registrySize: (provenanceSnapshot as any)?.registry?.length || 0,
						primitivesSize: (provenanceSnapshot as any)?.primitives?.length || 0,
					});
				} catch (error) {
					executionLogger.warn('Failed to capture provenance snapshot', { error });
				}
			}

			return {
				executionId,
				status: ExecutionStatus.COMPLETED,
				result,
				stats,
				transformedCode: codeToExecute !== code || alreadyTransformed ? codeToExecute : undefined,
				provenanceSnapshot,
			};
		} catch (error) {
			if (stateManager) {
				try {
					await stateManager.persist();
					executionLogger.debug('State persisted after error for potential resume');
				} catch (persistError) {
					executionLogger.error('Failed to persist state after error', { persistError });
				}
			}

			return handleExecutionError(
				error,
				pauseError,
				context,
				executionId,
				callbackHistory,
				memoryBefore,
				executionLogger,
				isolate,
				codeToExecute !== code || alreadyTransformed ? codeToExecute : undefined
			);
		} finally {
			this.cleanup(executionId, config.provenanceMode);
		}
	}

	private cleanProvenanceIds(value: unknown): unknown {
		if (value === null || value === undefined) {
			return value;
		}

		if (typeof value !== 'object') {
			return value;
		}

		if (Array.isArray(value)) {
			return value.map((item) => this.cleanProvenanceIds(item));
		}

		const cleaned: Record<string, unknown> = {};
		const allKeys = Object.getOwnPropertyNames(value);
		for (const key of allKeys) {
			if (key !== '__prov_id__') {
				cleaned[key] = this.cleanProvenanceIds((value as Record<string, unknown>)[key]);
			}
		}
		return cleaned;
	}

	private cleanup(executionId?: string, provenanceMode?: string): void {
		try {
			setPauseForClient(false);
		} catch (e) {}
		try {
			setReplayMode(undefined);
		} catch (e) {}

		if (executionId && provenanceMode === ProvenanceMode.AST) {
			try {
				unregisterIsolateContext(executionId);
			} catch (e) {}
		}

		if (executionId && provenanceMode && provenanceMode !== ProvenanceMode.NONE) {
			try {
				cleanupProvenanceForExecution(executionId);
				clearProvenanceExecutionId();
			} catch (e) {}
		}
		setProgressCallback(null);

		clearVectorStoreExecutionId();
	}
}
