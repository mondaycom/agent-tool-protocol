import type {
	ExecutionConfig,
	APIGroupConfig,
	ClientToolDefinition,
	ToolMetadata,
} from '@mondaydotcomorg/atp-protocol';
import {
	ToolOperationType,
	ToolSensitivityLevel,
	ProvenanceMode,
	CallbackType,
	ToolOperation,
} from '@mondaydotcomorg/atp-protocol';
import {
	llm,
	cache,
	log,
	approval,
	embedding,
	setCurrentExecutionId,
	clearCurrentExecutionId,
	setVectorStoreExecutionId,
	clearVectorStoreExecutionId,
	pauseForCallback,
	nextSequenceNumber,
	getCachedResult,
	isReplayMode,
	storeAPICallResult,
	getAPIResultFromCache,
} from '@mondaydotcomorg/atp-runtime';
import type { RuntimeContext } from './types.js';
import {
	createProvenanceProxy,
	getProvenance,
	SecurityPolicyEngine,
	ProvenanceSource,
	registerProvenanceMetadata,
} from '@mondaydotcomorg/atp-provenance';
import { ReaderPermissions } from '@mondaydotcomorg/atp-server';
import { getHintMap, reattachProvenanceFromHints } from '../utils/provenance-reattachment.js';
import { createASTProvenanceChecker } from './ast-provenance-bridge.js';

export class SandboxBuilder {
	private policyEngine: SecurityPolicyEngine | null = null;

	constructor(private apiGroups: APIGroupConfig[]) {}

	createSandbox(
		context: RuntimeContext,
		config: ExecutionConfig,
		logger: ReturnType<typeof log.child>,
		executionId: string,
		policyEngine?: SecurityPolicyEngine,
		clientTools?: ClientToolDefinition[]
	): Record<string, unknown> {
		this.policyEngine = policyEngine || null;
		const clientId = context.clientId || 'default';

		const sandbox: Record<string, unknown> = {
			module: { exports: {} },
			exports: {},
			require: () => {
				throw new Error('require() is not allowed in sandbox');
			},

			atp: {
				approval: {
					request: async (message: string, approvalContext?: Record<string, unknown>) => {
						context.approvalCallCount++;
						logger.debug('Approval request from sandbox', { message });
						setCurrentExecutionId(executionId);
						try {
							return await approval.request(message, approvalContext);
						} finally {
							clearCurrentExecutionId();
						}
					},
				},
				llm: {
					call: async (options: {
						prompt: string;
						context?: Record<string, unknown>;
						model?: string;
						temperature?: number;
						systemPrompt?: string;
					}) => {
						if (!config.allowLLMCalls) {
							throw new Error('LLM calls are not allowed in this execution');
						}
						if (++context.llmCallCount > config.maxLLMCalls) {
							throw new Error(`Exceeded max LLM calls: ${config.maxLLMCalls}`);
						}
						logger.debug('LLM call from sandbox', {
							promptLength: options.prompt.length,
							model: options.model,
						});

						if (config.customLLMHandler) {
							return await config.customLLMHandler(options.prompt, options);
						}

						setCurrentExecutionId(executionId);
						try {
							return await llm.call(options);
						} finally {
							clearCurrentExecutionId();
						}
					},
					extract: async (options: {
						prompt: string;
						schema: unknown;
						context?: Record<string, unknown>;
					}) => {
						if (!config.allowLLMCalls) {
							throw new Error('LLM calls are not allowed in this execution');
						}
						if (++context.llmCallCount > config.maxLLMCalls) {
							throw new Error(`Exceeded max LLM calls: ${config.maxLLMCalls}`);
						}
						logger.debug('LLM extract from sandbox');
						setCurrentExecutionId(executionId);
						try {
							return await llm.extract(options);
						} finally {
							clearCurrentExecutionId();
						}
					},
					classify: async (options: {
						text: string;
						categories: string[];
						context?: Record<string, unknown>;
					}) => {
						if (!config.allowLLMCalls) {
							throw new Error('LLM calls are not allowed in this execution');
						}
						if (++context.llmCallCount > config.maxLLMCalls) {
							throw new Error(`Exceeded max LLM calls: ${config.maxLLMCalls}`);
						}
						logger.debug('LLM classify from sandbox');
						setCurrentExecutionId(executionId);
						try {
							return await llm.classify(options);
						} finally {
							clearCurrentExecutionId();
						}
					},
				},
				cache: {
					get: async (key: string) => {
						const scopedKey = `client:${clientId}:cache:${key}`;
						setCurrentExecutionId(executionId);
						try {
							return await cache.get(scopedKey);
						} finally {
							clearCurrentExecutionId();
						}
					},
					set: async (key: string, value: unknown, ttl?: number) => {
						const scopedKey = `client:${clientId}:cache:${key}`;
						setCurrentExecutionId(executionId);
						try {
							return await cache.set(scopedKey, value, ttl);
						} finally {
							clearCurrentExecutionId();
						}
					},
					delete: async (key: string) => {
						const scopedKey = `client:${clientId}:cache:${key}`;
						setCurrentExecutionId(executionId);
						try {
							return await cache.delete(scopedKey);
						} finally {
							clearCurrentExecutionId();
						}
					},
					has: async (key: string) => {
						const scopedKey = `client:${clientId}:cache:${key}`;
						setCurrentExecutionId(executionId);
						try {
							return await cache.has(scopedKey);
						} finally {
							clearCurrentExecutionId();
						}
					},
				},
				embedding: {
					embed: async (text: string, options?: Record<string, unknown>) => {
						logger.debug('Embedding request from sandbox', { textLength: text.length });
						setCurrentExecutionId(executionId);
						setVectorStoreExecutionId(executionId);
						try {
							return await embedding.embed(text, options);
						} finally {
							clearCurrentExecutionId();
							clearVectorStoreExecutionId();
						}
					},
					search: async (query: string, options?: Record<string, unknown>) => {
						logger.debug('Embedding search from sandbox', { query });
						setCurrentExecutionId(executionId);
						setVectorStoreExecutionId(executionId);
						try {
							return await embedding.search(query, options);
						} finally {
							clearCurrentExecutionId();
							clearVectorStoreExecutionId();
						}
					},
				},
				progress: {
					report: (message: string, fraction: number) => {
						logger.debug('Progress report from sandbox', { message, fraction });
						if (config.progressCallback) {
							config.progressCallback(message, fraction);
						}
					},
				},
			},

			api: this.createAPIFunctionsWithClientTools(logger, executionId, config, clientTools),

			console: {
				log: (...args: unknown[]) => {
					const message = args.join(' ');
					logger.debug(`[Sandbox console] ${message}`);
					context.logs.push(`LOG: ${message}`);
				},
				error: (...args: unknown[]) => {
					const message = args.join(' ');
					logger.error(`[Sandbox console] ${message}`);
					context.logs.push(`ERROR: ${message}`);
				},
				warn: (...args: unknown[]) => {
					const message = args.join(' ');
					logger.warn(`[Sandbox console] ${message}`);
					context.logs.push(`WARN: ${message}`);
				},
			},

			JSON: JSON,
			Math: Math,
			Date: Date,
			Array: Array,
			Object: Object,
			String: String,
			Number: Number,
			Boolean: Boolean,
			Promise: Promise,
			setTimeout: setTimeout,
			setInterval: setInterval,
			clearTimeout: clearTimeout,
			clearInterval: clearInterval,
		};

		if (
			config.provenanceMode === ProvenanceMode.PROXY ||
			config.provenanceMode === ProvenanceMode.AST
		) {
			sandbox.__getProvenance = getProvenance;
		}

		return sandbox;
	}

	private createAPIFunctions(
		logger: ReturnType<typeof log.child>,
		executionId: string,
		config: ExecutionConfig
	): Record<string, unknown> {
		const api: Record<string, unknown> = {};

		for (const group of this.apiGroups) {
			if (group.functions) {
				const groupObj = this.getOrCreateNestedGroup(api, group.name);

				for (const func of group.functions) {
					const handler = func.handler;
					const metadata = func.metadata;

					groupObj[func.name] = async (input: unknown) => {
						logger.info(`API function called: ${group.name}.${func.name}`, {
							inputType: typeof input,
							hasMetadata: !!metadata,
							provenanceMode: config.provenanceMode || ProvenanceMode.NONE,
							inputKeys: input && typeof input === 'object' ? Object.keys(input) : [],
							inputPreview: JSON.stringify(input)?.substring(0, 200) || 'undefined',
						});

						const operationName = `${group.name}.${func.name}`;
					try {
						isReplayMode();
					} catch (contextError) {
						setCurrentExecutionId(executionId);
					}

				try {
					const cacheKey = `${operationName}:${JSON.stringify(input)}`;
					const operationCached = getAPIResultFromCache(cacheKey);
					if (operationCached !== undefined) {
						if (operationCached && typeof operationCached === 'object' && (operationCached as any).__error) {
							throw new Error((operationCached as any).message);
						}
						return operationCached;
					}
				} catch (cacheError) {
					// Continue without cache
				}

						// In AST mode, recursively unwrap tainted primitives and register their provenance
						if (
							config.provenanceMode === ProvenanceMode.AST &&
							input &&
							typeof input === 'object'
						) {
							logger.info('Checking for tainted values to unwrap', {
								tool: func.name,
								inputKeys: Object.keys(input),
							});

							function unwrapTaintedValues(obj: any, visited = new WeakSet<object>()): any {
								if (obj === null || obj === undefined) return obj;

								// Check if this is a wrapped tainted primitive
								if (typeof obj === 'object' && '__tainted_value' in obj && '__prov_meta' in obj) {
									const taintedVal = obj.__tainted_value;
									const provMeta = obj.__prov_meta;

									logger.info('FOUND wrapped tainted value!', {
										taintedValType: typeof taintedVal,
										taintedValIsString: typeof taintedVal === 'string',
										taintedValIsNumber: typeof taintedVal === 'number',
										taintedValIsObject: typeof taintedVal === 'object',
										valuePreview:
											typeof taintedVal === 'string' || typeof taintedVal === 'number'
												? String(taintedVal).substring(0, 30)
												: '[OBJECT: ' + Object.keys(taintedVal || {}).join(',') + ']',
										hasProvMeta: !!provMeta,
									});

									// Register the provenance so host-side checks can find it
									if (provMeta && provMeta.source) {
										registerProvenanceMetadata(
											`tainted:${String(taintedVal)}`,
											{
												id: `tainted:${String(taintedVal)}`,
												source: provMeta.source,
												readers: provMeta.readers || { type: 'public' },
												dependencies: provMeta.deps || provMeta.dependencies || [],
											},
											executionId
										);
										logger.info('Unwrapped and registered tainted primitive', {
											tool: func.name,
											valuePreview: String(taintedVal).substring(0, 30),
											source: provMeta.source?.type,
											executionId: executionId,
										});
									}

									// Recursively unwrap in case taintedVal contains more wrapped values
									return unwrapTaintedValues(taintedVal, visited);
								}

								// Recursively unwrap objects/arrays
								if (typeof obj === 'object') {
									if (visited.has(obj)) return obj;
									visited.add(obj);

									if (Array.isArray(obj)) {
										return obj.map((item) => unwrapTaintedValues(item, visited));
									} else {
										const unwrapped: Record<string, unknown> = {};
										for (const [key, value] of Object.entries(obj)) {
											unwrapped[key] = unwrapTaintedValues(value, visited);
										}
										return unwrapped;
									}
								}

								return obj;
							}

							input = unwrapTaintedValues(input);
							logger.info('After unwrapping', {
								tool: func.name,
								inputPreview: JSON.stringify(input).substring(0, 200),
							});
						}

						// Re-attach provenance from hints before policy checks
						const hintMap = getHintMap(executionId);
						if (hintMap && hintMap.size > 0 && input && typeof input === 'object') {
							try {
								reattachProvenanceFromHints(input as Record<string, unknown>, hintMap);
								logger.debug('Provenance re-attached from hints', {
									tool: func.name,
									group: group.name,
									hintsAvailable: hintMap.size,
								});
							} catch (error) {
								logger.warn('Failed to re-attach provenance from hints', { error });
							}
						}

						if (
							this.policyEngine &&
							config.provenanceMode &&
							config.provenanceMode !== ProvenanceMode.NONE
						) {
							logger.debug('Checking security policies', {
								tool: func.name,
								group: group.name,
								hasPolicyEngine: !!this.policyEngine,
								provenanceMode: config.provenanceMode,
							});

							try {
								await this.policyEngine.checkTool(
									func.name,
									group.name,
									input as Record<string, unknown>
								);
								logger.debug('Security policies passed', { tool: func.name, group: group.name });
							} catch (error) {
								logger.error('Security policy denied tool execution', {
									tool: func.name,
									group: group.name,
									error: error instanceof Error ? error.message : String(error),
								});
								throw error;
							}
						}

						const isDestructive = metadata?.operationType === ToolOperationType.DESTRUCTIVE;
						const isSensitive = metadata?.sensitivityLevel === ToolSensitivityLevel.SENSITIVE;
						const needsApproval = metadata?.requiresApproval || isDestructive || isSensitive;

						if (needsApproval) {
							let operationDescription = 'operation';
							if (isDestructive) operationDescription = 'destructive operation';
							else if (isSensitive) operationDescription = 'sensitive operation';

							const approvalMessage = `Approve ${operationDescription}: ${func.name}`;

							const approvalResult = await approval.request(approvalMessage, {
								tool: func.name,
								group: group.name,
								params: input,
								metadata: metadata,
							});

							if (!approvalResult || !approvalResult.approved) {
								throw new Error(`Operation ${func.name} denied by user`);
							}

							logger.info(`Tool approved by user: ${group.name}.${func.name}`, {
								operationType: metadata?.operationType,
								sensitivityLevel: metadata?.sensitivityLevel,
							});
						}

					const result = await handler(input);

					try {
						storeAPICallResult({
							type: 'api',
							operation: operationName,
							payload: input,
							result: result,
							timestamp: Date.now(),
							sequenceNumber: -1,
						});
					} catch (cacheError) {
						logger.debug(`Failed to store result in callback history for ${operationName}`, {
							error: cacheError instanceof Error ? cacheError.message : String(cacheError),
						});
						// Continue without caching
					}

						if (config.provenanceMode === ProvenanceMode.PROXY) {
							let readers: ReaderPermissions = { type: 'public' };

							if (
								metadata?.sensitivityLevel === ToolSensitivityLevel.SENSITIVE ||
								metadata?.operationType === ToolOperationType.DESTRUCTIVE
							) {
								const inputEmail =
									(input as any)?.email || (input as any)?.user || (input as any)?.userId;
								if (inputEmail && typeof inputEmail === 'string') {
									readers = {
										type: 'restricted',
										readers: [inputEmail],
									};
								} else {
									readers = {
										type: 'restricted',
										readers: [`tool:${func.name}`],
									};
								}
							}

							return createProvenanceProxy(
								result,
								{
									type: ProvenanceSource.TOOL,
									toolName: func.name,
									apiGroup: group.name,
									timestamp: Date.now(),
								},
								readers
							);
						} else if (config.provenanceMode === ProvenanceMode.AST) {
							let readers: ReaderPermissions = { type: 'public' };

							if (
								metadata?.sensitivityLevel === ToolSensitivityLevel.SENSITIVE ||
								metadata?.operationType === ToolOperationType.DESTRUCTIVE
							) {
								const inputEmail =
									(input as any)?.email || (input as any)?.user || (input as any)?.userId;
								if (inputEmail && typeof inputEmail === 'string') {
									readers = {
										type: 'restricted',
										readers: [inputEmail],
									};
								} else {
									readers = {
										type: 'restricted',
										readers: [`tool:${func.name}`],
									};
								}
							}

							return createProvenanceProxy(
								result,
								{
									type: ProvenanceSource.TOOL,
									toolName: func.name,
									apiGroup: group.name,
									timestamp: Date.now(),
								},
								readers
							);
						}

						return result;
					};
				}
			}
		}

		return api;
	}

	/**
	 * Creates API functions combining both server tools and client tools
	 */
	private createAPIFunctionsWithClientTools(
		logger: ReturnType<typeof log.child>,
		executionId: string,
		config: ExecutionConfig,
		clientTools?: ClientToolDefinition[]
	): Record<string, unknown> {
		const api = this.createAPIFunctions(logger, executionId, config);

		if (clientTools && clientTools.length > 0) {
			const clientToolFunctions = this.createClientToolFunctions(
				clientTools,
				logger,
				executionId,
				config
			);

			for (const [namespace, functions] of Object.entries(clientToolFunctions)) {
				if (api[namespace]) {
					Object.assign(api[namespace], functions);
				} else {
					api[namespace] = functions;
				}
			}
		}

		return api;
	}

	/**
	 * Creates API functions for client-provided tools that trigger pause/resume
	 */
	private createClientToolFunctions(
		clientTools: ClientToolDefinition[],
		logger: ReturnType<typeof log.child>,
		executionId: string,
		config: ExecutionConfig
	): Record<string, Record<string, unknown>> {
		const api: Record<string, Record<string, unknown>> = {};

		for (const tool of clientTools) {
			const namespace = tool.namespace || 'client';

			if (!api[namespace]) {
				api[namespace] = {};
			}

			const toolName = tool.name;
			const metadata = tool.metadata;
			const provenanceMode = config.provenanceMode || ProvenanceMode.NONE;
			const policyEngine = this.policyEngine;

			api[namespace][toolName] = async (input: unknown) => {
				let currentSequence: number;
				try {
					currentSequence = nextSequenceNumber();
				} catch (seqError) {
					setCurrentExecutionId(executionId);
					currentSequence = nextSequenceNumber();
				}

				const cachedResult = getCachedResult(currentSequence);
				if (cachedResult !== undefined) {
					if (
						cachedResult &&
						typeof cachedResult === 'object' &&
						(cachedResult as any).__error
					) {
						throw new Error((cachedResult as any).message);
					}

					return cachedResult;
				}

				const hintMap = getHintMap(executionId);
				if (hintMap && hintMap.size > 0 && input && typeof input === 'object') {
					try {
						reattachProvenanceFromHints(input as Record<string, unknown>, hintMap);
					} catch (error) {
						// Silent fail - re-attachment is best-effort
					}
				}

				if (policyEngine && provenanceMode !== ProvenanceMode.NONE) {
					await policyEngine.checkTool(toolName, namespace, input as Record<string, unknown>);
				}

				if (metadata) {
					const isDestructive = metadata.operationType === ToolOperationType.DESTRUCTIVE;
					const isSensitive = metadata.sensitivityLevel === ToolSensitivityLevel.SENSITIVE;
					const needsApproval = metadata.requiresApproval || isDestructive || isSensitive;

					if (needsApproval) {
						const operationDescription = isDestructive
							? 'destructive operation'
							: isSensitive
								? 'sensitive operation'
								: 'operation';
						const approvalMessage = `Approve client tool ${operationDescription}: ${toolName}`;

						const approvalResult = await approval.request(approvalMessage, {
							tool: toolName,
							namespace,
							params: input,
							metadata: metadata,
							isClientTool: true,
						});

						if (!approvalResult || !approvalResult.approved) {
							throw new Error(`Client tool ${toolName} denied by user`);
						}
					}
				}

				pauseForCallback(CallbackType.TOOL, ToolOperation.CALL, {
					toolName,
					namespace,
					input,
					sequenceNumber: currentSequence,
				});

				throw new Error('Tool execution should have paused');
			};
		}

		return api;
	}

	/**
	 * Get or create nested group object from hierarchical path.
	 * Supports hierarchical group names like "github/readOnly/repos"
	 * Creates nested structure: api.github.readOnly.repos
	 * @param api - Root API object
	 * @param groupName - Group name (may contain / for hierarchy)
	 * @returns The deepest nested object for the group
	 */
	private getOrCreateNestedGroup(
		api: Record<string, unknown>,
		groupName: string
	): Record<string, unknown> {
		if (!groupName.includes('/')) {
			if (!api[groupName]) {
				api[groupName] = {};
			}
			return api[groupName] as Record<string, unknown>;
		}

		const parts = groupName.split('/');
		let current = api;

		for (const part of parts) {
			if (!current[part]) {
				current[part] = {};
			}
			current = current[part] as Record<string, unknown>;
		}

		return current;
	}
}
