/**
 * AST Provenance Tracking Runtime for isolated-vm
 * This code is injected into the isolate and runs INSIDE the sandbox
 * It must be plain JavaScript with no imports
 */
// TODO: need to create atp.internal with internal functions like has to reduce complexity
export const AST_TRACKING_RUNTIME = `
// Pure JavaScript SHA-256 implementation for digest computation
function sha256(str) {
	function rightRotate(value, amount) {
		return (value >>> amount) | (value << (32 - amount));
	}
	
	const mathPow = Math.pow;
	const maxWord = mathPow(2, 32);
	const lengthProperty = 'length';
	let i, j;
	let result = '';
	
	const words = [];
	const asciiBitLength = str[lengthProperty] * 8;
	
	let hash = sha256.h = sha256.h || [];
	const k = sha256.k = sha256.k || [];
	let primeCounter = k[lengthProperty];
	
	const isComposite = {};
	for (let candidate = 2; primeCounter < 64; candidate++) {
		if (!isComposite[candidate]) {
			for (i = 0; i < 313; i += candidate) {
				isComposite[i] = candidate;
			}
			hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
			k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
		}
	}
	
	str += '\\x80';
	while (str[lengthProperty] % 64 - 56) str += '\\x00';
	for (i = 0; i < str[lengthProperty]; i++) {
		j = str.charCodeAt(i);
		if (j >> 8) return;
		words[i >> 2] |= j << ((3 - i) % 4) * 8;
	}
	words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
	words[words[lengthProperty]] = (asciiBitLength);
	
	for (j = 0; j < words[lengthProperty];) {
		const w = words.slice(j, j += 16);
		const oldHash = hash;
		hash = hash.slice(0, 8);
		
		for (i = 0; i < 64; i++) {
			const w15 = w[i - 15], w2 = w[i - 2];
			
			const a = hash[0], e = hash[4];
			const temp1 = hash[7]
				+ (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
				+ ((e & hash[5]) ^ ((~e) & hash[6]))
				+ k[i]
				+ (w[i] = (i < 16) ? w[i] : (
						w[i - 16]
						+ (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
						+ w[i - 7]
						+ (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
					) | 0
				);
			const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
				+ ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
			
			hash = [(temp1 + temp2) | 0].concat(hash);
			hash[4] = (hash[4] + temp1) | 0;
		}
		
		for (i = 0; i < 8; i++) {
			hash[i] = (hash[i] + oldHash[i]) | 0;
		}
	}
	
	for (i = 0; i < 8; i++) {
		for (j = 3; j + 1; j--) {
			const b = (hash[i] >> (j * 8)) & 255;
			result += ((b < 16) ? 0 : '') + b.toString(16);
		}
	}
	
	// Convert hex to base64url
	const hex = result;
	const bytes = [];
	for (let i = 0; i < hex.length; i += 2) {
		bytes.push(parseInt(hex.substring(i, i + 2), 16));
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	const base64 = btoa(binary);
	return base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
}

const __astTracker = {
	metadata: new Map(),
	nextId: 0,
	hints: new Map(globalThis.__provenance_hints || []),
	hintValues: new Map(globalThis.__provenance_hint_values || []),
	
	// SHA-256 digest computation to match server-side
	computeDigest(value) {
		try {
			const str = JSON.stringify(value);
			return sha256(str);
		} catch (e) {
			return null;
		}
	},
	
	getId(value) {
		if (typeof value === 'object' && value !== null) {
			if (!value.__prov_id__) {
				const id = 'tracked_' + this.nextId++;
				try {
					Object.defineProperty(value, '__prov_id__', {
						value: id,
						writable: false,
						enumerable: false,
						configurable: true
					});
				} catch (e) {
					return 'temp_' + Date.now() + '_' + Math.random();
				}
				return id;
			}
			return value.__prov_id__;
		}
		return 'primitive_' + Date.now() + '_' + Math.random();
	},
	
	track(value, source, deps) {
		try {
			const id = this.getId(value);
			this.metadata.set(id, { id, source, deps: deps || [] });
			console.log('[__track] Stored metadata:', id, 'source:', source.type, 'metadataSize:', this.metadata.size);
			return value;
		} catch (error) {
			console.error('[__track] Error:', error);
			return value;
		}
	},
	
	trackBinary(left, right, operator) {
		// Perform the actual operation
		let result;
		switch (operator) {
			case '+': result = left + right; break;
			case '-': result = left - right; break;
			case '*': result = left * right; break;
			case '/': result = left / right; break;
			case '%': result = left % right; break;
			case '==': result = left == right; break;
			case '===': result = left === right; break;
			case '!=': result = left != right; break;
			case '!==': result = left !== right; break;
			case '<': result = left < right; break;
			case '>': result = left > right; break;
			case '<=': result = left <= right; break;
			case '>=': result = left >= right; break;
			case '&&': result = left && right; break;
			case '||': result = left || right; break;
			default: result = left;
		}
		
		// Check if either operand has provenance
		let hasToolSource = false;
		let toolMetadata = null;
		
		// Helper to check primitive provenance
		const checkPrimitive = (value) => {
			if (typeof value !== 'string' && typeof value !== 'number') {
				return null;
			}
			
			// Check tainted key first
			const taintedKey = 'tainted:' + String(value);
			const taintedMeta = this.metadata.get(taintedKey);
			if (taintedMeta && taintedMeta.source && taintedMeta.source.type === 'tool') {
				return taintedMeta;
			}
			
			// Check hint-based tracking
			const digest = this.computeDigest(value);
			const hintMeta = this.hints.get(digest);
			if (hintMeta && hintMeta.source && hintMeta.source.type === 'tool') {
				return hintMeta;
			}
			
			// Check primitive map (id:key:value format)
			for (const [key, meta] of this.metadata.entries()) {
				if (!key.startsWith('tainted:') && key.includes(':')) {
					const parts = key.split(':');
					if (parts.length >= 3) {
						const primitiveValue = parts.slice(2).join(':');
						if (primitiveValue === String(value) && meta.source && meta.source.type === 'tool') {
							return meta;
						}
					}
				}
			}
			
			return null;
		};
		
		// Check left operand
		if (typeof left === 'object' && left && left.__prov_id__) {
			const leftMeta = this.metadata.get(left.__prov_id__);
			if (leftMeta && leftMeta.source && leftMeta.source.type === 'tool') {
				hasToolSource = true;
				toolMetadata = leftMeta;
			}
		} else {
			const primMeta = checkPrimitive(left);
			if (primMeta) {
				hasToolSource = true;
				toolMetadata = primMeta;
			}
		}
		
		// Check right operand
		if (!hasToolSource) {
			if (typeof right === 'object' && right && right.__prov_id__) {
				const rightMeta = this.metadata.get(right.__prov_id__);
				if (rightMeta && rightMeta.source && rightMeta.source.type === 'tool') {
					hasToolSource = true;
					toolMetadata = rightMeta;
				}
			} else {
				const primMeta = checkPrimitive(right);
				if (primMeta) {
					hasToolSource = true;
					toolMetadata = primMeta;
				}
			}
		}
		
		// If result is a string and has tool-sourced operand, mark it as tainted
		if (hasToolSource && toolMetadata && (typeof result === 'string' || typeof result === 'number')) {
			const taintedKey = 'tainted:' + String(result);
			// Ensure metadata has all required fields, preserving readers from source
			const fullMetadata = {
				...toolMetadata,
				readers: toolMetadata.readers || { type: 'restricted', readers: [] },
				dependencies: toolMetadata.dependencies || toolMetadata.deps || []
			};
			this.metadata.set(taintedKey, fullMetadata);
		}
		
		return result;
	},
	
	trackAssign(name, value) {
		return value;
	},
	
	async trackMethod(object, method, args) {
		// Recursively wrap tainted primitives in arguments before calling the method
		function wrapTaintedInArgs(val, visited = new WeakSet()) {
			if (val === null || val === undefined) return val;
			
			// Check if this value has provenance
			const prov = this.checkProvenance(val);
			if (prov && (typeof val === 'string' || typeof val === 'number')) {
				// Wrap tainted primitive
				return { __tainted_value: val, __prov_meta: prov };
			}
			
			// Recursively process objects/arrays
			if (typeof val === 'object') {
				if (visited.has(val)) return val;
				visited.add(val);
				
				if (Array.isArray(val)) {
					return val.map(item => wrapTaintedInArgs.call(this, item, visited));
				} else {
					const wrapped = {};
					for (const [key, v] of Object.entries(val)) {
						wrapped[key] = wrapTaintedInArgs.call(this, v, visited);
					}
					return wrapped;
				}
			}
			
			return val;
		}
		
		// Wrap arguments
		const wrappedArgs = args.map(arg => wrapTaintedInArgs.call(this, arg));
		
		// Call the method with wrapped arguments
		if (typeof object === 'object' && object !== null && method in object) {
			const result = await object[method](...wrappedArgs);
			
			// Track the result
			if (result && typeof result === 'object') {
				const id = this.getId(result);
				
				// Extract authorized readers from common param patterns (email, userId, username, user)
				// Match server-side logic in sandbox-builder.ts (lines 459-470)
				let authorizedReaders = [];
				for (const arg of args) {
					if (arg && typeof arg === 'object') {
						// Check for user identifier fields (email, user, userId only - no generic 'id')
						const value = arg.email || arg.user || arg.userId;
						if (typeof value === 'string' && value.length > 0) {
							authorizedReaders.push(value);
							break; // Only take first identifier
						}
					}
				}
				
				// If no email found, use tool-scoped authorization (matches server logic line 467-470)
				if (authorizedReaders.length === 0) {
					authorizedReaders = ['tool:' + method];
				}
				
				// Tool data should be restricted by default to prevent exfiltration
				const metadata = { 
					id, 
					source: { 
						type: 'tool', 
						operation: method, 
						toolName: method, 
						timestamp: Date.now() 
					},
					readers: { type: 'restricted', readers: authorizedReaders },
					deps: [this.getId(object), ...args.map(a => this.getId(a))],
					dependencies: []
				};
				this.metadata.set(id, metadata);
				
						// Track primitive properties for token emission
						for (const key in result) {
							if (Object.prototype.hasOwnProperty.call(result, key)) {
								const value = result[key];
								if (typeof value === 'string' || typeof value === 'number') {
									// Check if this primitive matches any hints
									const digest = this.computeDigest(value);
									const hintMeta = this.hints.get(digest);
									
									const primitiveKey = id + ':' + key + ':' + String(value);
									// Use hint metadata if available, otherwise use result metadata
									this.metadata.set(primitiveKey, hintMeta || metadata);
									
									// Also store by digest for cross-execution matching
									if (hintMeta) {
										const taintedKey = 'tainted:' + String(value);
										this.metadata.set(taintedKey, hintMeta);
									}
								}
							}
						}
			}
			
			return result;
		}
		return undefined;
	},
	
	trackTemplate(expressions, quasis) {
		let result = '';
		let hasToolSource = false;
		let toolMetadata = null;
		
		// Helper to check primitive provenance
		const checkPrimitive = (value) => {
			if (typeof value !== 'string' && typeof value !== 'number') {
				return null;
			}
			
			// Check tainted key first
			const taintedKey = 'tainted:' + String(value);
			const taintedMeta = this.metadata.get(taintedKey);
			if (taintedMeta && taintedMeta.source && taintedMeta.source.type === 'tool') {
				return taintedMeta;
			}
			
			// Check hint-based tracking
			const digest = this.computeDigest(value);
			const hintMeta = this.hints.get(digest);
			if (hintMeta && hintMeta.source && hintMeta.source.type === 'tool') {
				return hintMeta;
			}
			
			// Check primitive map (id:key:value format)
			for (const [key, meta] of this.metadata.entries()) {
				if (!key.startsWith('tainted:') && key.includes(':')) {
					const parts = key.split(':');
					if (parts.length >= 3) {
						const primitiveValue = parts.slice(2).join(':');
						if (primitiveValue === String(value) && meta.source && meta.source.type === 'tool') {
							return meta;
						}
					}
				}
			}
			
			return null;
		};
		
		for (let i = 0; i < quasis.length; i++) {
			result += quasis[i] || '';
			if (i < expressions.length) {
				const expr = expressions[i];
				result += String(expr);
				
				// Check if expression has provenance
				if (!hasToolSource) {
					// Check object provenance
					if (typeof expr === 'object' && expr && expr.__prov_id__) {
						const exprMeta = this.metadata.get(expr.__prov_id__);
						if (exprMeta && exprMeta.source && exprMeta.source.type === 'tool') {
							hasToolSource = true;
							toolMetadata = exprMeta;
						}
					} else {
						const primMeta = checkPrimitive(expr);
						if (primMeta) {
							hasToolSource = true;
							toolMetadata = primMeta;
						}
					}
				}
			}
		}
		
		// If template contains tool-sourced data, mark result as tainted
		if (hasToolSource && toolMetadata) {
			const taintedKey = 'tainted:' + result;
			// Ensure metadata has all required fields, preserving readers from source
			const fullMetadata = {
				...toolMetadata,
				readers: toolMetadata.readers || { type: 'restricted', readers: [] },
				dependencies: toolMetadata.dependencies || toolMetadata.deps || []
			};
			this.metadata.set(taintedKey, fullMetadata);
		}
		
		return result;
	},
	
	getMetadata(value) {
		const id = typeof value === 'object' && value && value.__prov_id__;
		return id ? this.metadata.get(id) : null;
	},
	
	getAllMetadata() {
		return Array.from(this.metadata.entries());
	},
	
	// Check if a value or any nested value has tool-sourced provenance
	checkProvenance(value) {
		if (value === null || value === undefined) {
			return null;
		}
		
		// Check if it's an object with __prov_id__
		if (typeof value === 'object' && value.__prov_id__) {
			const meta = this.metadata.get(value.__prov_id__);
			if (meta && meta.source && meta.source.type === 'tool') {
				return meta;
			}
		}
		
		// Check if it's a primitive with tainted metadata
		if (typeof value === 'string' || typeof value === 'number') {
			const taintedKey = 'tainted:' + String(value);
			const taintedMeta = this.metadata.get(taintedKey);
			if (taintedMeta && taintedMeta.source && taintedMeta.source.type === 'tool') {
				return taintedMeta;
			}
			
			// Check primitive map
			for (const [key, meta] of this.metadata.entries()) {
				if (!key.startsWith('tainted:') && key.includes(':')) {
					const parts = key.split(':');
					if (parts.length >= 3) {
						const primitiveValue = parts.slice(2).join(':');
						if (primitiveValue === String(value) && meta.source && meta.source.type === 'tool') {
							return meta;
						}
					}
				}
			}
			
			// Check hints
			const digest = this.computeDigest(value);
			const hintMeta = this.hints.get(digest);
			if (hintMeta && hintMeta.source && hintMeta.source.type === 'tool') {
				return hintMeta;
			}
		}
		
		// For objects/arrays, recursively check all values
		if (typeof value === 'object') {
			for (const key in value) {
				if (Object.prototype.hasOwnProperty.call(value, key)) {
					const nestedMeta = this.checkProvenance(value[key]);
					if (nestedMeta) {
						return nestedMeta;
					}
				}
			}
		}
		
		return null;
	}
};

// Expose tracking functions globally
globalThis.__track = (v, s, d) => __astTracker.track(v, s, d);
globalThis.__track_binary = (l, r, o) => __astTracker.trackBinary(l, r, o);
globalThis.__track_assign = (n, v) => __astTracker.trackAssign(n, v);
globalThis.__track_method = (o, m, a) => __astTracker.trackMethod(o, m, a);
globalThis.__track_template = (e, q) => __astTracker.trackTemplate(e, q);
globalThis.__get_provenance = (v) => __astTracker.getMetadata(v);
globalThis.__get_all_metadata = () => __astTracker.getAllMetadata();
globalThis.__check_provenance = (v) => __astTracker.checkProvenance(v);

// Mark a string literal as tainted (for cross-execution tracking)
globalThis.__mark_tainted = (value) => {
	// Check if this value matches a hint by exact digest
	const digest = __astTracker.computeDigest(value);
	const hintMeta = __astTracker.hints.get(digest);
	if (hintMeta) {
		const taintedKey = 'tainted:' + String(value);
		__astTracker.metadata.set(taintedKey, hintMeta);
		return value;
	}
	
	// ALSO check if this value CONTAINS any hint values (substring match)
	// This enables cross-execution tracking for template literals/concatenation
	if (typeof value === 'string' && __astTracker.hintValues && __astTracker.hintValues.size > 0) {
		for (const [hintValue, metadata] of __astTracker.hintValues.entries()) {
			if (value.includes(hintValue)) {
				const taintedKey = 'tainted:' + String(value);
				// Ensure metadata has all required fields, use restricted readers for tool data
				const fullMetadata = {
					...metadata,
					readers: metadata.readers || { type: 'restricted', readers: [] },
					dependencies: metadata.dependencies || metadata.deps || []
				};
				__astTracker.metadata.set(taintedKey, fullMetadata);
				return value;
			}
		}
	}
	
	return value;
};
`;
