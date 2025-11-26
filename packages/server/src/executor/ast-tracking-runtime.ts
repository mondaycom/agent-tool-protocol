/**
 * AST Provenance Tracking Runtime for isolated-vm
 * This code is injected into the isolate and runs INSIDE the sandbox
 * It must be plain JavaScript with no imports
 * 
 * This runtime provides comprehensive taint tracking by:
 * 1. Deep-tainting all primitives from tool results
 * 2. Intercepting native methods with re-entry protection
 * 3. Supporting cross-execution tracking via hints
 */
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

// Re-entry guard to prevent infinite recursion in wrapped methods
let __inTrackingCall = false;

const __astTracker = {
	metadata: new Map(),
	nextId: 0,
	hints: new Map(globalThis.__provenance_hints || []),
	hintValues: new Map(globalThis.__provenance_hint_values || []),
	// Track tainted objects via WeakMap for O(1) lookup
	taintedObjects: new WeakMap(),
	
	computeDigest(value) {
		if (__inTrackingCall) return null;
		try {
			__inTrackingCall = true;
			const str = JSON.stringify(value);
			__inTrackingCall = false;
			return sha256(str);
		} catch (e) {
			__inTrackingCall = false;
			return null;
		}
	},
	
	getId(value) {
		if (typeof value === 'object' && value !== null) {
			if (!value.__prov_id__) {
				const id = 'tracked_' + Date.now() + '_' + (Math.random().toString(36).substring(2, 8));
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
	
	// Register a primitive value as tainted
	registerTaintedPrimitive(value, metadata) {
		// Accept any non-empty string or any valid number (including 0)
		const isValidString = typeof value === 'string' && value !== '';
		const isValidNumber = typeof value === 'number' && !Number.isNaN(value);
		
		if (isValidString || isValidNumber) {
			const taintedKey = 'tainted:' + String(value);
			this.metadata.set(taintedKey, {
				...metadata,
				readers: metadata.readers || { type: 'restricted', readers: [] },
				dependencies: metadata.dependencies || metadata.deps || []
			});
		}
	},
	
	// Deep taint an object - register all nested primitives
	deepTaintObject(obj, metadata, visited = new WeakSet()) {
		if (!obj || typeof obj !== 'object') return;
		if (visited.has(obj)) return;
		visited.add(obj);
		
		// Mark object in WeakMap for fast lookup
		this.taintedObjects.set(obj, metadata);
		
		// Set __prov_id__ and register in metadata
		const id = this.getId(obj);
		this.metadata.set(id, metadata);
		
		// Register all primitive properties
		const keys = Object.keys(obj);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const value = obj[key];
			
			if (typeof value === 'string' || typeof value === 'number') {
				this.registerTaintedPrimitive(value, metadata);
				// Also store by object:key:value for additional lookup
				const primitiveKey = id + ':' + key + ':' + String(value);
				this.metadata.set(primitiveKey, metadata);
			} else if (Array.isArray(value)) {
				// Taint array and its elements
				this.deepTaintObject(value, metadata, visited);
				for (let j = 0; j < value.length; j++) {
					const elem = value[j];
					if (typeof elem === 'string' || typeof elem === 'number') {
						this.registerTaintedPrimitive(elem, metadata);
					} else if (typeof elem === 'object' && elem !== null) {
						this.deepTaintObject(elem, metadata, visited);
					}
				}
			} else if (typeof value === 'object' && value !== null) {
				this.deepTaintObject(value, metadata, visited);
			}
		}
	},
	
	track(value, source, deps) {
		try {
			const id = this.getId(value);
			const metadata = { 
				id, 
				source, 
				deps: deps || [],
				readers: source.readers || { type: 'restricted', readers: ['tool:' + (source.tool || source.operation || 'unknown')] },
				dependencies: []
			};
			this.metadata.set(id, metadata);
			
			// Deep taint all nested primitives
			if (value && typeof value === 'object') {
				this.deepTaintObject(value, metadata);
			}
			
			return value;
		} catch (error) {
			return value;
		}
	},
	
	trackBinary(left, right, operator) {
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
		
		// Propagate taint from operands to result
		const leftMeta = this.checkProvenance(left);
		const rightMeta = this.checkProvenance(right);
		const toolMetadata = leftMeta || rightMeta;
		
		if (toolMetadata && (typeof result === 'string' || typeof result === 'number')) {
			this.registerTaintedPrimitive(result, toolMetadata);
		}
		
		return result;
	},
	
	trackAssign(name, value) {
		return value;
	},
	
	async trackMethod(object, method, args) {
		// Wrap tainted primitives in arguments before calling API methods
		const self = this;
		function wrapTaintedInArgs(val, visited = new WeakSet()) {
			if (val === null || val === undefined) return val;
			
			const prov = self.checkProvenance(val);
			if (prov && (typeof val === 'string' || typeof val === 'number')) {
				return { __tainted_value: val, __prov_meta: prov };
			}
			
			if (typeof val === 'object') {
				if (visited.has(val)) return val;
				visited.add(val);
				
				if (Array.isArray(val)) {
					return val.map(item => wrapTaintedInArgs(item, visited));
				} else {
					const wrapped = {};
					const keys = Object.keys(val);
					for (let i = 0; i < keys.length; i++) {
						wrapped[keys[i]] = wrapTaintedInArgs(val[keys[i]], visited);
					}
					return wrapped;
				}
			}
			
			return val;
		}
		
		const wrappedArgs = args.map(arg => wrapTaintedInArgs(arg));
		
		if (typeof object === 'object' && object !== null && method in object) {
			const result = await object[method](...wrappedArgs);
			
			if (result && typeof result === 'object') {
				const id = this.getId(result);
				
				let authorizedReaders = [];
				for (const arg of args) {
					if (arg && typeof arg === 'object') {
						const value = arg.email || arg.user || arg.userId;
						if (typeof value === 'string' && value.length > 0) {
							authorizedReaders.push(value);
							break;
						}
					}
				}
				
				if (authorizedReaders.length === 0) {
					authorizedReaders = ['tool:' + method];
				}
				
				const metadata = { 
					id, 
					source: { type: 'tool', operation: method, toolName: method, timestamp: Date.now() },
					readers: { type: 'restricted', readers: authorizedReaders },
					deps: [],
					dependencies: []
				};
				this.metadata.set(id, metadata);
				this.deepTaintObject(result, metadata);
			}
			
			return result;
		}
		return undefined;
	},
	
	trackTemplate(expressions, quasis) {
		let result = '';
		let toolMetadata = null;
		
		for (let i = 0; i < quasis.length; i++) {
			result += quasis[i] || '';
			if (i < expressions.length) {
				const expr = expressions[i];
				result += String(expr);
				
				if (!toolMetadata) {
					toolMetadata = this.checkProvenance(expr);
				}
			}
		}
		
		if (toolMetadata) {
			this.registerTaintedPrimitive(result, toolMetadata);
		}
		
		return result;
	},
	
	// Propagate taint from source to result for native method calls
	propagateTaint(source, args, result) {
		if (__inTrackingCall) return result;
		
		__inTrackingCall = true;
		try {
			// Check if source or any arg is tainted
			let metadata = this.checkProvenanceInternal(source);
			
			if (!metadata && args) {
				for (let i = 0; i < args.length; i++) {
					metadata = this.checkProvenanceInternal(args[i]);
					if (metadata) break;
				}
			}
			
			// Propagate taint to result
			if (metadata) {
				if (typeof result === 'string' || typeof result === 'number') {
					this.registerTaintedPrimitive(result, metadata);
				} else if (Array.isArray(result)) {
					this.deepTaintObject(result, metadata);
				} else if (typeof result === 'object' && result !== null) {
					this.deepTaintObject(result, metadata);
				}
			}
		} finally {
			__inTrackingCall = false;
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
	
	// Internal provenance check (no re-entry guard - caller must set it)
	checkProvenanceInternal(value) {
		if (value === null || value === undefined) return null;
		
		// Fast path: check WeakMap for objects
		if (typeof value === 'object' && this.taintedObjects.has(value)) {
			return this.taintedObjects.get(value);
		}
		
		// Check object __prov_id__
		if (typeof value === 'object' && value.__prov_id__) {
			const meta = this.metadata.get(value.__prov_id__);
			if (meta && meta.source && meta.source.type === 'tool') {
				return meta;
			}
		}
		
		// Check primitive taint
		if (typeof value === 'string' || typeof value === 'number') {
			const taintedKey = 'tainted:' + String(value);
			const taintedMeta = this.metadata.get(taintedKey);
			if (taintedMeta && taintedMeta.source && taintedMeta.source.type === 'tool') {
				return taintedMeta;
			}
			
			// Check primitive map (object:key:value format)
			for (const [key, meta] of this.metadata.entries()) {
				// Skip non-string keys (could be Symbols)
				if (typeof key !== 'string') continue;
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
			
			// Check hints (cross-execution)
			const digest = this.computeDigest(value);
			if (digest) {
				const hintMeta = this.hints.get(digest);
				if (hintMeta && hintMeta.source && hintMeta.source.type === 'tool') {
					return hintMeta;
				}
			}
			
			// Check substring containment in hint values
			if (typeof value === 'string' && this.hintValues && this.hintValues.size > 0) {
				for (const [hintValue, meta] of this.hintValues.entries()) {
					if (value.includes(hintValue) && meta.source && meta.source.type === 'tool') {
						return meta;
					}
				}
			}
		}
		
		// Recursively check object properties
		if (typeof value === 'object') {
			const keys = Object.keys(value);
			for (let i = 0; i < keys.length; i++) {
				const nestedMeta = this.checkProvenanceInternal(value[keys[i]]);
				if (nestedMeta) return nestedMeta;
			}
		}
		
		return null;
	},
	
	// Public provenance check with re-entry guard
	checkProvenance(value) {
		if (__inTrackingCall) return null;
		
		__inTrackingCall = true;
		try {
			return this.checkProvenanceInternal(value);
		} finally {
			__inTrackingCall = false;
		}
	}
};

// ============================================================================
// NATIVE METHOD INTERCEPTION
// We store originals and wrap methods with taint propagation
// ============================================================================

const __originals = {
	String_toUpperCase: String.prototype.toUpperCase,
	String_toLowerCase: String.prototype.toLowerCase,
	String_slice: String.prototype.slice,
	String_substring: String.prototype.substring,
	String_substr: String.prototype.substr,
	String_trim: String.prototype.trim,
	String_trimStart: String.prototype.trimStart,
	String_trimEnd: String.prototype.trimEnd,
	String_replace: String.prototype.replace,
	String_replaceAll: String.prototype.replaceAll,
	String_split: String.prototype.split,
	String_charAt: String.prototype.charAt,
	String_concat: String.prototype.concat,
	String_padStart: String.prototype.padStart,
	String_padEnd: String.prototype.padEnd,
	String_repeat: String.prototype.repeat,
	String_normalize: String.prototype.normalize,
	
	Array_map: Array.prototype.map,
	Array_filter: Array.prototype.filter,
	Array_reduce: Array.prototype.reduce,
	Array_reduceRight: Array.prototype.reduceRight,
	Array_join: Array.prototype.join,
	Array_slice: Array.prototype.slice,
	Array_concat: Array.prototype.concat,
	Array_flat: Array.prototype.flat,
	Array_flatMap: Array.prototype.flatMap,
	Array_find: Array.prototype.find,
	Array_every: Array.prototype.every,
	Array_some: Array.prototype.some,
	
	Number_toFixed: Number.prototype.toFixed,
	Number_toPrecision: Number.prototype.toPrecision,
	Number_toExponential: Number.prototype.toExponential,
	
	JSON_stringify: JSON.stringify,
	JSON_parse: JSON.parse,
	
	String_ctor: String,
	Number_ctor: Number,
	parseInt_fn: parseInt,
	parseFloat_fn: parseFloat,
};

// String method wrappers - use this.valueOf() to get primitive for provenance check
String.prototype.toUpperCase = function() {
	const result = __originals.String_toUpperCase.call(this);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.toLowerCase = function() {
	const result = __originals.String_toLowerCase.call(this);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.slice = function(start, end) {
	const result = __originals.String_slice.call(this, start, end);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.substring = function(start, end) {
	const result = __originals.String_substring.call(this, start, end);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.substr = function(start, length) {
	const result = __originals.String_substr.call(this, start, length);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.trim = function() {
	const result = __originals.String_trim.call(this);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.trimStart = function() {
	const result = __originals.String_trimStart.call(this);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.trimEnd = function() {
	const result = __originals.String_trimEnd.call(this);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.replace = function(searchValue, replaceValue) {
	const result = __originals.String_replace.call(this, searchValue, replaceValue);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.replaceAll = function(searchValue, replaceValue) {
	const result = __originals.String_replaceAll.call(this, searchValue, replaceValue);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.split = function(separator, limit) {
	const result = __originals.String_split.call(this, separator, limit);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.charAt = function(index) {
	const result = __originals.String_charAt.call(this, index);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.concat = function(...args) {
	const result = __originals.String_concat.apply(this, args);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, args, result);
};

String.prototype.padStart = function(targetLength, padString) {
	const result = __originals.String_padStart.call(this, targetLength, padString);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.padEnd = function(targetLength, padString) {
	const result = __originals.String_padEnd.call(this, targetLength, padString);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.repeat = function(count) {
	const result = __originals.String_repeat.call(this, count);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

String.prototype.normalize = function(form) {
	const result = __originals.String_normalize.call(this, form);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

// Array method wrappers
Array.prototype.map = function(callback, thisArg) {
	const result = __originals.Array_map.call(this, callback, thisArg);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.filter = function(callback, thisArg) {
	const result = __originals.Array_filter.call(this, callback, thisArg);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.reduce = function(callback, initialValue) {
	const result = arguments.length > 1 
		? __originals.Array_reduce.call(this, callback, initialValue)
		: __originals.Array_reduce.call(this, callback);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.reduceRight = function(callback, initialValue) {
	const result = arguments.length > 1
		? __originals.Array_reduceRight.call(this, callback, initialValue)
		: __originals.Array_reduceRight.call(this, callback);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.join = function(separator) {
	const result = __originals.Array_join.call(this, separator);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.slice = function(start, end) {
	const result = __originals.Array_slice.call(this, start, end);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.concat = function(...args) {
	const result = __originals.Array_concat.apply(this, args);
	return __astTracker.propagateTaint(this, args, result);
};

Array.prototype.flat = function(depth) {
	const result = __originals.Array_flat.call(this, depth);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.flatMap = function(callback, thisArg) {
	const result = __originals.Array_flatMap.call(this, callback, thisArg);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.find = function(callback, thisArg) {
	const result = __originals.Array_find.call(this, callback, thisArg);
	return __astTracker.propagateTaint(this, [], result);
};

Array.prototype.every = function(callback, thisArg) {
	return __originals.Array_every.call(this, callback, thisArg);
};

Array.prototype.some = function(callback, thisArg) {
	return __originals.Array_some.call(this, callback, thisArg);
};

// Number method wrappers - use this.valueOf() to get primitive for provenance check
Number.prototype.toFixed = function(digits) {
	const result = __originals.Number_toFixed.call(this, digits);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

Number.prototype.toPrecision = function(precision) {
	const result = __originals.Number_toPrecision.call(this, precision);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

Number.prototype.toExponential = function(fractionDigits) {
	const result = __originals.Number_toExponential.call(this, fractionDigits);
	const primitiveThis = typeof this === 'object' ? this.valueOf() : this;
	return __astTracker.propagateTaint(primitiveThis, [], result);
};

// JSON wrappers
JSON.stringify = function(value, replacer, space) {
	const result = __originals.JSON_stringify(value, replacer, space);
	return __astTracker.propagateTaint(value, [], result);
};

JSON.parse = function(text, reviver) {
	const result = __originals.JSON_parse(text, reviver);
	// If input was tainted, taint the parsed object
	if (!__inTrackingCall) {
		__inTrackingCall = true;
		try {
			const inputMeta = __astTracker.checkProvenanceInternal(text);
			if (inputMeta && result && typeof result === 'object') {
				__astTracker.deepTaintObject(result, inputMeta);
			}
		} finally {
			__inTrackingCall = false;
		}
	}
	return result;
};

// Global function wrappers
const __OrigString = __originals.String_ctor;
globalThis.String = function(value) {
	if (new.target) {
		return new __OrigString(value);
	}
	const result = __OrigString(value);
	return __astTracker.propagateTaint(value, [], result);
};
Object.setPrototypeOf(globalThis.String, __OrigString);
globalThis.String.prototype = __OrigString.prototype;
globalThis.String.fromCharCode = __OrigString.fromCharCode;
globalThis.String.fromCodePoint = __OrigString.fromCodePoint;
globalThis.String.raw = __OrigString.raw;

const __OrigNumber = __originals.Number_ctor;
globalThis.Number = function(value) {
	if (new.target) {
		return new __OrigNumber(value);
	}
	const result = __OrigNumber(value);
	return __astTracker.propagateTaint(value, [], result);
};
Object.setPrototypeOf(globalThis.Number, __OrigNumber);
globalThis.Number.prototype = __OrigNumber.prototype;
globalThis.Number.isNaN = __OrigNumber.isNaN;
globalThis.Number.isFinite = __OrigNumber.isFinite;
globalThis.Number.isInteger = __OrigNumber.isInteger;
globalThis.Number.isSafeInteger = __OrigNumber.isSafeInteger;
globalThis.Number.parseFloat = __OrigNumber.parseFloat;
globalThis.Number.parseInt = __OrigNumber.parseInt;
globalThis.Number.MAX_VALUE = __OrigNumber.MAX_VALUE;
globalThis.Number.MIN_VALUE = __OrigNumber.MIN_VALUE;
globalThis.Number.NaN = __OrigNumber.NaN;
globalThis.Number.NEGATIVE_INFINITY = __OrigNumber.NEGATIVE_INFINITY;
globalThis.Number.POSITIVE_INFINITY = __OrigNumber.POSITIVE_INFINITY;
globalThis.Number.MAX_SAFE_INTEGER = __OrigNumber.MAX_SAFE_INTEGER;
globalThis.Number.MIN_SAFE_INTEGER = __OrigNumber.MIN_SAFE_INTEGER;
globalThis.Number.EPSILON = __OrigNumber.EPSILON;

globalThis.parseInt = function(string, radix) {
	const result = __originals.parseInt_fn(string, radix);
	return __astTracker.propagateTaint(string, [], result);
};

globalThis.parseFloat = function(string) {
	const result = __originals.parseFloat_fn(string);
	return __astTracker.propagateTaint(string, [], result);
};

// ============================================================================
// GLOBAL TRACKING FUNCTIONS
// ============================================================================

globalThis.__track = (v, s, d) => __astTracker.track(v, s, d);
globalThis.__track_binary = (l, r, o) => __astTracker.trackBinary(l, r, o);
globalThis.__track_assign = (n, v) => __astTracker.trackAssign(n, v);
globalThis.__track_method = (o, m, a) => __astTracker.trackMethod(o, m, a);
globalThis.__track_template = (e, q) => __astTracker.trackTemplate(e, q);
globalThis.__get_provenance = (v) => __astTracker.getMetadata(v);
globalThis.__get_all_metadata = () => __astTracker.getAllMetadata();
globalThis.__check_provenance = (v) => __astTracker.checkProvenance(v);

globalThis.__mark_tainted = (value) => {
	if (__inTrackingCall) return value;
	__inTrackingCall = true;
	try {
		const digest = __astTracker.computeDigest(value);
		if (digest) {
			const hintMeta = __astTracker.hints.get(digest);
			if (hintMeta) {
				__astTracker.registerTaintedPrimitive(value, hintMeta);
				return value;
			}
		}
		
		if (typeof value === 'string' && __astTracker.hintValues && __astTracker.hintValues.size > 0) {
			for (const [hintValue, metadata] of __astTracker.hintValues.entries()) {
				if (value.includes(hintValue)) {
					__astTracker.registerTaintedPrimitive(value, metadata);
					return value;
				}
			}
		}
	} finally {
		__inTrackingCall = false;
	}
	return value;
};
`;
