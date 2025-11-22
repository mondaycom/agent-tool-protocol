import ivm from 'isolated-vm';
import type { Logger } from '@mondaydotcomorg/atp-runtime';
import { isPauseError, runInExecutionContext } from '@mondaydotcomorg/atp-runtime';
import { isBatchPauseError } from '@mondaydotcomorg/atp-compiler';
import { PAUSE_EXECUTION_MARKER } from './constants.js';

export async function injectHostTimers(
	ivmContext: ivm.Context,
	jail: ivm.Reference<Record<string, unknown>>,
	executionLogger: Logger
): Promise<() => void> {
	executionLogger.debug('Injecting host timers');
	const activeTimers = new Map<number, NodeJS.Timeout>();

	const setTimeoutRef = new ivm.Reference((id: number, delay: number) => {
		const timer = setTimeout(() => {
			activeTimers.delete(id);
			try {
				const dispatch = ivmContext.global.getSync('__dispatch_timer');
				if (dispatch && (typeof dispatch === 'object' || typeof dispatch === 'function')) {
					if (typeof dispatch.applyIgnored === 'function') {
						dispatch.applyIgnored(undefined, [id]);
					} else if (typeof dispatch === 'function') {
						dispatch(id);
					} else {
						executionLogger.warn('dispatch.applyIgnored is missing', { type: typeof dispatch });
					}
				} else {
					executionLogger.warn('__dispatch_timer not found or invalid', { type: typeof dispatch });
				}
			} catch (error) {
				executionLogger.warn('Failed to dispatch timer callback', {
					id,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined
				});
			}
		}, delay);
		activeTimers.set(id, timer);
	});

	const clearTimeoutRef = new ivm.Reference((id: number) => {
		const timer = activeTimers.get(id);
		if (timer) {
			clearTimeout(timer);
			activeTimers.delete(id);
		}
	});

	await ivmContext.evalClosure(`
		globalThis.__host_setTimeout = $0;
		globalThis.__host_clearTimeout = $1;
		
		globalThis._activeTimers = new Map();
		globalThis._timerIdCounter = 1;

		globalThis.__dispatch_timer = function(id) {
			const cb = globalThis._activeTimers.get(id);
			if (cb) {
				globalThis._activeTimers.delete(id);
				try { cb(); } catch(e) { console.error('Timer callback error:', e); }
			}
		};

		globalThis.setTimeout = function(callback, delay) {
			const id = globalThis._timerIdCounter++;
			globalThis._activeTimers.set(id, callback);
			if (!globalThis.__host_setTimeout) {
				throw new Error('__host_setTimeout is missing');
			}
			globalThis.__host_setTimeout.applyIgnored(undefined, [id, delay]);
			return id;
		};

		globalThis.clearTimeout = function(id) {
			if (globalThis._activeTimers.has(id)) {
				globalThis._activeTimers.delete(id);
				globalThis.__host_clearTimeout.applyIgnored(undefined, [id]);
			}
		};
	`, [setTimeoutRef, clearTimeoutRef]);

	return () => {
		for (const timer of activeTimers.values()) {
			clearTimeout(timer);
		}
		activeTimers.clear();
	};
}

export async function injectSandbox(
	ivmContext: ivm.Context,
	jail: ivm.Reference<Record<string, unknown>>,
	sandbox: Record<string, unknown>,
	executionLogger: Logger,
	onPauseError: (error: unknown) => void,
	executionId?: string,
	provenanceMode?: string,
	hintMetadata?: Map<string, any>
): Promise<void> {
	const injectFunctions = async (obj: unknown, prefix: string): Promise<void> => {
		if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
			return;
		}

		for (const [key, value] of Object.entries(obj)) {
			if (typeof value === 'function') {
				const boundFunc = value.bind(obj);

				const isVoidFunction =
					prefix === 'atp_log' || prefix === 'atp_progress' || prefix === 'atp_output';

				if (isVoidFunction) {
					await jail.set(
						`__${prefix}_${key}`,
						new ivm.Reference((...args: unknown[]) => {
							try {
								boundFunc(...args);
							} catch (error) {
								executionLogger.error('Error in void function', { prefix, key, error });
							}
						})
					);
				} else {
					await jail.set(
						`__${prefix}_${key}`,
						new ivm.Reference(async (...args: unknown[]) => {
							try {
								const result = await boundFunc(...args);
								return new ivm.ExternalCopy(result).copyInto();
							} catch (error) {
								const err = error as Error;
								if (isPauseError(error) || err.message === PAUSE_EXECUTION_MARKER) {
									if (isPauseError(error)) {
										onPauseError(error);
									}
									throw new Error(PAUSE_EXECUTION_MARKER);
								}
								throw error;
							}
						})
					);
				}
			} else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				await injectFunctions(value, `${prefix}_${key}`);
			}
		}
	};

	const injectAPIFunctions = async (obj: unknown, pathPrefix: string): Promise<void> => {
		if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
			return;
		}

		for (const [key, value] of Object.entries(obj)) {
			const newPath = pathPrefix ? `${pathPrefix}_${key}` : key;

			if (typeof value === 'function') {
				const boundFunc = value.bind(obj);
				const safeName = newPath.replace(/-/g, '_').replace(/\//g, '_').replace(/\./g, '_');

				await jail.set(
					`__api_${safeName}`,
					new ivm.Reference(async (...args: unknown[]) => {
						try {
							const result = await boundFunc(...args);
							// In AST mode, wrap result with provenance ID
							if (isASTMode) {
								const provId = `tracked_${Date.now()}_${Math.random().toString(36).substring(7)}`;
								const wrapped = {
									__atp_value: result,
									__atp_prov: provId
								};
								return new ivm.ExternalCopy(wrapped).copyInto();
							}
							return new ivm.ExternalCopy(result).copyInto();
						} catch (error) {
							const err = error as Error;
							if (isPauseError(error) || err.message === PAUSE_EXECUTION_MARKER) {
								if (isPauseError(error)) {
									onPauseError(error);
								}
								throw new Error(PAUSE_EXECUTION_MARKER);
							}
							throw error;
						}
					})
				);
			} else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				await injectAPIFunctions(value, newPath);
			}
		}
	};

	const isASTMode = provenanceMode === 'ast';
	if (isASTMode) {
		if (hintMetadata && hintMetadata.size > 0) {
			const hintsArray = Array.from(hintMetadata.entries());
			await jail.set('__provenance_hints', new ivm.ExternalCopy(hintsArray).copyInto());
			const valueMap = (hintMetadata as any).__valueMap;
			if (valueMap && valueMap.size > 0) {
				const valueMapArray = Array.from(valueMap.entries());
				await jail.set('__provenance_hint_values', new ivm.ExternalCopy(valueMapArray).copyInto());
			}
		}
		const { AST_TRACKING_RUNTIME } = await import('./ast-tracking-runtime.js');
		await ivmContext.eval(AST_TRACKING_RUNTIME);
		executionLogger.info('AST tracking runtime injected into isolate');
	}

	const hasASTTracking = isASTMode;

	for (const [namespace, value] of Object.entries(sandbox)) {
		if (
			hasASTTracking &&
			(namespace.startsWith('__track') ||
				namespace.startsWith('__get_provenance') ||
				namespace.startsWith('__mark_tainted'))
		) {
			continue;
		}

		if (namespace === '__runtime' && typeof value === 'object' && value !== null) {
			for (const [key, fn] of Object.entries(value)) {
				if (typeof fn === 'function') {
					await jail.set(
						`__runtime_${key}_impl`,
						new ivm.Reference(async (...args: unknown[]) => {
							try {
								const execute = async () => {
									const result = await fn(...args);
									return new ivm.ExternalCopy(result).copyInto();
								};

								if (executionId) {
									return await runInExecutionContext(executionId, execute);
								} else {
									return await execute();
								}
							} catch (error) {
								const err = error as Error;
								if (isBatchPauseError(error)) {
									onPauseError(error);
									throw new Error(PAUSE_EXECUTION_MARKER);
								}
								if (isPauseError(error) || err.message === PAUSE_EXECUTION_MARKER) {
									if (isPauseError(error)) {
										onPauseError(error);
									}
									throw new Error(PAUSE_EXECUTION_MARKER);
								}
								throw error;
							}
						})
					);
				}
			}
		} else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			if (namespace === 'api') {
				await injectAPIFunctions(value, '');
			} else {
				await injectFunctions(value, namespace);
			}
		}
	}
}

export async function setupRuntimeNamespace(
	ivmContext: ivm.Context,
	sandbox: Record<string, unknown>
): Promise<void> {
	const runtimeObject = sandbox.__runtime as Record<string, unknown>;
	if (!runtimeObject || typeof runtimeObject !== 'object') {
		return;
	}

	const runtimeKeys = Object.keys(runtimeObject).filter(
		(k) => typeof runtimeObject[k] === 'function'
	);
	if (runtimeKeys.length === 0) {
		return;
	}

	let runtimeSetup = 'globalThis.__runtime = {\n';
	runtimeSetup += runtimeKeys
		.map(
			(key) =>
				`\t${key}: async (...args) => {\n\t\treturn await __runtime_${key}_impl.apply(undefined, args, { arguments: { copy: true }, result: { promise: true } });\n\t}`
		)
		.join(',\n');
	runtimeSetup += '\n};';

	await ivmContext.eval(runtimeSetup);
}

export async function setupAPINamespace(
	ivmContext: ivm.Context,
	sandbox: Record<string, unknown>,
	provenanceMode?: string
): Promise<void> {
	const apiObject = sandbox.api as Record<string, unknown>;
	if (!apiObject || typeof apiObject !== 'object') {
		return;
	}

	const apiGroupNames = Object.keys(apiObject);
	if (apiGroupNames.length === 0) {
		return;
	}

	const isASTMode = provenanceMode === 'ast';
	let apiSetup = 'globalThis.api = {};';

	function setupNestedAPI(
		obj: Record<string, unknown>,
		pathPrefix: string,
		accessPath: string
	): void {
		for (const [key, value] of Object.entries(obj)) {
			const newPath = pathPrefix ? `${pathPrefix}_${key}` : key;
			const safeKey = JSON.stringify(key);
			const newAccessPath = `${accessPath}[${safeKey}]`;

			if (typeof value === 'function') {
				const safeName = newPath.replace(/-/g, '_').replace(/\//g, '_').replace(/\./g, '_');

				if (isASTMode) {
					const toolNameEscaped = newPath.replace(/'/g, "\\'");
					apiSetup += `
${newAccessPath} = async function(...args) {
	// In AST mode, recursively wrap arguments to preserve tainted primitive provenance
	function wrapTaintedValues(obj, visited = new WeakSet()) {
		if (obj === null || obj === undefined) return obj;
		
		// If this is already a wrapped tainted value, don't wrap it again!
		if (typeof obj === 'object' && '__tainted_value' in obj && '__prov_meta' in obj) {
			return obj; // Return as-is, already wrapped
		}
		
		// Check if this value itself has provenance (primitive or object)
		if (typeof globalThis.__check_provenance === 'function') {
			const prov = globalThis.__check_provenance(obj);
			if (prov && (typeof obj === 'string' || typeof obj === 'number')) {
				// Wrap tainted primitive
				return { __tainted_value: obj, __prov_meta: prov };
			}
		}
		
		// For objects/arrays, recursively wrap their contents
		if (typeof obj === 'object') {
			if (visited.has(obj)) return obj; // Avoid circular refs
			visited.add(obj);
			
			if (Array.isArray(obj)) {
				return obj.map(item => wrapTaintedValues(item, visited));
			} else {
				const wrapped = {};
				for (const [key, val] of Object.entries(obj)) {
					wrapped[key] = wrapTaintedValues(val, visited);
				}
				return wrapped;
			}
		}
		
		return obj;
	}
	
	const wrappedArgs = args.map(arg => wrapTaintedValues(arg));
	const rawResult = await __api_${safeName}.apply(undefined, wrappedArgs, { arguments: { copy: true }, result: { promise: true } });
	
	let result = rawResult;
	let provId = null;

	// Check for wrapped result
	if (rawResult && typeof rawResult === 'object' && '__atp_value' in rawResult && '__atp_prov' in rawResult) {
		result = rawResult.__atp_value;
		provId = rawResult.__atp_prov;
	} else if (rawResult && typeof rawResult === 'object' && '__prov_id__' in rawResult) {
		// Fallback for legacy/object tracking
		provId = rawResult.__prov_id__;
	}

	if (typeof globalThis.__track === 'function') {
		// If we have a specific provenance ID from the host, use it
		if (provId) {
			// Manually register the metadata for this ID if needed, or just track it
			// The host doesn't send the metadata here, but __track expects to generate it or link it
			// We need to tell __track to associate this value with this ID
			
			// If it's an object, we can attach the ID
			if (result && typeof result === 'object') {
				try {
					Object.defineProperty(result, '__prov_id__', {
						value: provId,
						writable: false,
						enumerable: false,
						configurable: true
					});
				} catch(e) {}
			}
			
			// Register metadata for this ID
			if (globalThis.__astTracker && globalThis.__astTracker.metadata) {
				globalThis.__astTracker.metadata.set(provId, {
					id: provId,
					source: { type: 'tool', tool: '${toolNameEscaped}', operation: 'read', timestamp: Date.now() },
					deps: []
				});
				
				// If it's a primitive, we need to map it
				if (typeof result === 'string' || typeof result === 'number') {
					const primitiveKey = provId + ':value:' + String(result);
					globalThis.__astTracker.metadata.set(primitiveKey, globalThis.__astTracker.metadata.get(provId));
					
					// Also taint it by value for immediate detection
					const taintedKey = 'tainted:' + String(result);
					globalThis.__astTracker.metadata.set(taintedKey, globalThis.__astTracker.metadata.get(provId));
				}
			}
		}
		
		return globalThis.__track(result, { type: 'tool', tool: '${toolNameEscaped}', operation: 'read' }, []);
	}
	return result;
};`;
				} else {
					apiSetup += `
${newAccessPath} = async function(...args) {
	return await __api_${safeName}.apply(undefined, args, { arguments: { copy: true }, result: { promise: true } });
};`;
				}
			} else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				apiSetup += `\n${newAccessPath} = {};`;
				setupNestedAPI(value as Record<string, unknown>, newPath, newAccessPath);
			}
		}
	}

	setupNestedAPI(apiObject, '', 'globalThis.api');
	await ivmContext.eval(apiSetup);
}
