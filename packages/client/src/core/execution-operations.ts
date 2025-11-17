import type { ExecutionResult, ExecutionConfig } from '@mondaydotcomorg/atp-protocol';
import { ExecutionStatus, CallbackType } from '@mondaydotcomorg/atp-protocol';
import type { ClientSession } from './session.js';
import type { ServiceProviders } from './service-providers';
import { ClientCallbackError } from '../errors.js';
import { ProvenanceTokenRegistry } from './provenance-registry.js';

export class ExecutionOperations {
	private session: ClientSession;
	private serviceProviders: ServiceProviders;
	private tokenRegistry: ProvenanceTokenRegistry;
	private lastExecutionConfig: Partial<ExecutionConfig> | null = null;

	constructor(session: ClientSession, serviceProviders: ServiceProviders) {
		this.session = session;
		this.serviceProviders = serviceProviders;
		this.tokenRegistry = new ProvenanceTokenRegistry();
	}

	/**
	 * Executes code on the server with real-time progress updates via SSE.
	 */
	async executeStream(
		code: string,
		config?: Partial<ExecutionConfig>,
		onProgress?: (message: string, fraction: number) => void
	): Promise<ExecutionResult> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/execute/stream`;
		const body = JSON.stringify({ code, config });
		const headers = await this.session.prepareHeaders('POST', url, body);

		return new Promise((resolve, reject) => {
			const fetchImpl = typeof fetch !== 'undefined' ? fetch : require('undici').fetch;

			fetchImpl(url, {
				method: 'POST',
				headers,
				body,
			})
				.then(async (response: Response) => {
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}: ${response.statusText}`);
					}

					const reader = response.body?.getReader();
					if (!reader) {
						throw new Error('Response body is not readable');
					}

					const decoder = new TextDecoder();
					let buffer = '';
					let result: ExecutionResult | null = null;

					while (true) {
						const { done, value } = await reader.read();

						if (done) break;

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() || '';

						for (let i = 0; i < lines.length; i++) {
							const line = lines[i];

							if (line && line.startsWith('event:')) {
								const event = line.substring(6).trim();

								for (let j = i + 1; j < lines.length; j++) {
									const dataLine = lines[j];
									if (dataLine && dataLine.startsWith('data:')) {
										const dataStr = dataLine.substring(5).trim();
										if (dataStr) {
											try {
												const data = JSON.parse(dataStr);

												if (event === 'progress' && onProgress) {
													onProgress(data.message, data.fraction);
												} else if (event === 'result') {
													result = data as ExecutionResult;
												} else if (event === 'error') {
													reject(new Error(data.message));
													return;
												}
											} catch (e) {
												console.error('Failed to parse SSE data:', dataStr);
											}
										}
										break;
									}
								}
							}
						}
					}

					if (result) {
						resolve(result);
					} else {
						reject(new Error('No result received from server'));
					}
				})
				.catch(reject);
		});
	}

	/**
	 * Executes code on the server in a sandboxed environment.
	 */
	async execute(code: string, config?: Partial<ExecutionConfig>): Promise<ExecutionResult> {
		await this.session.ensureInitialized();

		const hints = this.tokenRegistry.getRecentTokens(1000);

		const detectedClientServices = {
			hasLLM: !!this.serviceProviders.getLLM(),
			hasApproval: !!this.serviceProviders.getApproval(),
			hasEmbedding: !!this.serviceProviders.getEmbedding(),
			hasTools: this.serviceProviders.hasTools(),
		};
		
		const executionConfig = {
			...config,
			clientServices: {
				...detectedClientServices,
				...(config?.clientServices || {}),
			},
			provenanceHints: hints.length > 0 ? hints : undefined,
		};

		this.lastExecutionConfig = executionConfig;

		const url = `${this.session.getBaseUrl()}/api/execute`;
		const body = JSON.stringify({ code, config: executionConfig });
		const headers = await this.session.prepareHeaders('POST', url, body);

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		this.session.updateToken(response);

		if (!response.ok) {
			const error = (await response.json()) as { error: string };
			throw new Error(`Execution failed: ${error.error || response.statusText}`);
		}

		const result = (await response.json()) as ExecutionResult;

		if (result.provenanceTokens && result.provenanceTokens.length > 0) {
			for (const { token } of result.provenanceTokens) {
				this.tokenRegistry.add(token);
			}
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallbacks) {
			return await this.handleBatchCallbacksAndResume(result);
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallback) {
			return await this.handlePauseAndResume(result);
		}

		return result;
	}

	/**
	 * Handles batch callbacks by executing them in parallel and resuming.
	 */
	private async handleBatchCallbacksAndResume(
		pausedResult: ExecutionResult
	): Promise<ExecutionResult> {
		if (!pausedResult.needsCallbacks || pausedResult.needsCallbacks.length === 0) {
			throw new Error('No batch callback requests in paused execution');
		}

		const missingServiceIds = new Set(
			pausedResult.needsCallbacks
				.filter((cb) => !this.serviceProviders.hasServiceForCallback(cb.type))
				.map((cb) => cb.id)
		);

		if (missingServiceIds.size > 0) {
			const missingServices = pausedResult.needsCallbacks.filter((cb) => missingServiceIds.has(cb.id));
			const explicitlyRequestedMissing = missingServices.filter((cb) =>
				this.wasServiceExplicitlyRequested(cb.type)
			);
			const unexpectedMissing = missingServices.filter((cb) => 
				!this.wasServiceExplicitlyRequested(cb.type)
			);
			
			if (explicitlyRequestedMissing.length > 0) {
				return pausedResult;
			}
			
			const errorMessage = `Missing service providers for callback types: ${unexpectedMissing.map(cb => cb.type).join(', ')}`;
			console.error(`Auto-handling batch paused execution without service providers: ${errorMessage}`, {
				executionId: pausedResult.executionId,
				missingServices: unexpectedMissing.map(cb => ({ type: cb.type, operation: cb.operation, id: cb.id })),
			});
			
			const existingCallbacks = pausedResult.needsCallbacks.filter(
				(cb) => !missingServiceIds.has(cb.id)
			);

			if (existingCallbacks.length > 0) {
				try {
					const existingResults = await Promise.all(
						existingCallbacks.map(async (cb) => {
							const callbackResult = await this.serviceProviders.handleCallback(cb.type, {
								...cb.payload,
								operation: cb.operation,
							});
							return { id: cb.id, result: callbackResult };
						})
					);
					
					const allResults = pausedResult.needsCallbacks.map((cb) => {
						if (missingServiceIds.has(cb.id)) {
							return {
								id: cb.id,
								result: {
									__error: true,
									message: `${cb.type} service not provided by client`,
								},
							};
						}
						return existingResults.find(r => r.id === cb.id)!;
					});
					
					return await this.resumeWithBatchResults(pausedResult.executionId, allResults);
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					console.error(`Error handling existing services in batch: ${errorMessage}`, {
						executionId: pausedResult.executionId,
					});
					const allErrorResults = pausedResult.needsCallbacks.map((cb) => ({
						id: cb.id,
						result: {
							__error: true,
							message: missingServiceIds.has(cb.id) 
								? `${cb.type} service not provided by client`
								: errorMessage,
						},
					}));
					return await this.resumeWithBatchResults(pausedResult.executionId, allErrorResults);
				}
			} else {
				const allErrorResults = pausedResult.needsCallbacks.map((cb) => ({
					id: cb.id,
					result: {
						__error: true,
						message: `${cb.type} service not provided by client`,
					},
				}));
				return await this.resumeWithBatchResults(pausedResult.executionId, allErrorResults);
			}
		}

		try {
			const batchResults = await Promise.all(
				pausedResult.needsCallbacks.map(async (cb) => {
					const callbackResult = await this.serviceProviders.handleCallback(cb.type, {
						...cb.payload,
						operation: cb.operation,
					});
					return { id: cb.id, result: callbackResult };
				})
			);

			return await this.resumeWithBatchResults(pausedResult.executionId, batchResults);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`Error handling batch callbacks: ${errorMessage}`, {
				executionId: pausedResult.executionId,
				callbackCount: pausedResult.needsCallbacks.length,
			});
			
			const allErrorResults = pausedResult.needsCallbacks.map((cb) => ({
				id: cb.id,
				result: {
					__error: true,
					message: errorMessage,
				},
			}));
			return await this.resumeWithBatchResults(pausedResult.executionId, allErrorResults);
		}
	}

	/**
	 * Handles a paused execution by processing the callback and resuming.
	 */
	private async handlePauseAndResume(pausedResult: ExecutionResult): Promise<ExecutionResult> {
		if (!pausedResult.needsCallback) {
			throw new Error('No callback request in paused execution');
		}

		if (!this.serviceProviders.hasServiceForCallback(pausedResult.needsCallback.type)) {
			const wasExplicitlyRequested = this.wasServiceExplicitlyRequested(pausedResult.needsCallback.type);
			
			if (wasExplicitlyRequested) {
				return pausedResult;
			}
			
			const errorMessage = `${pausedResult.needsCallback.type} service not provided by client`;
			console.error(`Auto-handling paused execution without service provider: ${errorMessage}`, {
				executionId: pausedResult.executionId,
				callbackType: pausedResult.needsCallback.type,
				operation: pausedResult.needsCallback.operation,
			});
			
			return await this.resume(pausedResult.executionId, {
				__error: true,
				message: errorMessage,
			});
		}

		try {
			const callbackResult = await this.serviceProviders.handleCallback(
				pausedResult.needsCallback.type,
				{
					...pausedResult.needsCallback.payload,
					operation: pausedResult.needsCallback.operation,
					executionId: pausedResult.executionId,
				}
			);

			return await this.resume(pausedResult.executionId, callbackResult);
		} catch (error) {
			if (error instanceof ClientCallbackError) {
				throw error;
			}
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`Error handling callback: ${errorMessage}`, {
				executionId: pausedResult.executionId,
				callbackType: pausedResult.needsCallback.type,
				operation: pausedResult.needsCallback.operation,
			});
			return await this.resume(pausedResult.executionId, {
				__error: true,
				message: errorMessage,
			});
		}
	}

	/**
	 * Check if a service was explicitly requested in clientServices config
	 */
	private wasServiceExplicitlyRequested(callbackType: CallbackType): boolean {
		if (!this.lastExecutionConfig?.clientServices) {
			return false;
		}
		
		switch (callbackType) {
			case CallbackType.LLM:
				return this.lastExecutionConfig.clientServices.hasLLM;
			case CallbackType.APPROVAL:
				return this.lastExecutionConfig.clientServices.hasApproval;
			case CallbackType.EMBEDDING:
				return this.lastExecutionConfig.clientServices.hasEmbedding;
			case CallbackType.TOOL:
				return this.lastExecutionConfig.clientServices.hasTools;
			default:
				return false;
		}
	}

	/**
	 * Resumes a paused execution with a callback result.
	 */
	async resume(executionId: string, callbackResult: unknown): Promise<ExecutionResult> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/resume/${executionId}`;
		const body = JSON.stringify({ result: callbackResult });
		const headers = await this.session.prepareHeaders('POST', url, body);

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		this.session.updateToken(response);

		if (!response.ok) {
			const error = (await response.json()) as { error: string };
			throw new Error(`Resume failed: ${error.error || response.statusText}`);
		}

		const result = (await response.json()) as ExecutionResult;

		if (result.provenanceTokens && result.provenanceTokens.length > 0) {
			for (const { token } of result.provenanceTokens) {
				this.tokenRegistry.add(token);
			}
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallbacks) {
			return await this.handleBatchCallbacksAndResume(result);
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallback) {
			return await this.handlePauseAndResume(result);
		}

		return result;
	}

	/**
	 * Resumes a paused execution with batch callback results.
	 */
	private async resumeWithBatchResults(
		executionId: string,
		batchResults: Array<{ id: string; result: unknown }>
	): Promise<ExecutionResult> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/resume/${executionId}`;
		const body = JSON.stringify({ results: batchResults });
		const headers = await this.session.prepareHeaders('POST', url, body);

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		this.session.updateToken(response);

		if (!response.ok) {
			const error = (await response.json()) as { error: string };
			throw new Error(`Batch resume failed: ${error.error || response.statusText}`);
		}

		const result = (await response.json()) as ExecutionResult;

		if (result.provenanceTokens && result.provenanceTokens.length > 0) {
			for (const { token } of result.provenanceTokens) {
				this.tokenRegistry.add(token);
			}
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallbacks) {
			return await this.handleBatchCallbacksAndResume(result);
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallback) {
			return await this.handlePauseAndResume(result);
		}

		return result;
	}
}
