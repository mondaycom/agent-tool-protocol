import type {
	APIGroupConfig,
	CustomFunctionDef,
	AuthProvider,
	AuthConfig,
	BearerAuthConfig,
	BasicAuthConfig,
	APIKeyAuthConfig,
} from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

/**
 * Path item object that can contain HTTP methods and path-level fields
 */
interface OpenAPIPathItem {
	parameters?: Array<OpenAPIParameterWithRef>;
	servers?: Array<{ url: string; description?: string }>;
	summary?: string;
	description?: string;
	[method: string]: OpenAPIOperation | Array<OpenAPIParameterWithRef> | Array<{ url: string; description?: string }> | string | undefined;
}

/**
 * Base HTTP API specification (common to both OpenAPI and Swagger)
 */
interface BaseAPISpec {
	info: {
		title: string;
		version: string;
		description?: string;
	};
	paths: Record<string, OpenAPIPathItem>;
	security?: Array<Record<string, string[]>>;
}

/**
 * OpenAPI 3.0+ specification structure
 */
interface OpenAPISpec extends BaseAPISpec {
	openapi: string;
	servers?: Array<{ url: string; description?: string }>;
	components?: {
		schemas?: Record<string, OpenAPISchema>;
		securitySchemes?: Record<string, OpenAPISecurityScheme>;
	};
}

/**
 * Swagger 2.0 specification structure
 */
interface Swagger2Spec extends BaseAPISpec {
	swagger: string;
	host?: string;
	basePath?: string;
	schemes?: Array<'http' | 'https' | 'ws' | 'wss'>;
	consumes?: string[];
	produces?: string[];
	definitions?: Record<string, OpenAPISchema>;
	securityDefinitions?: Record<string, OpenAPISecurityScheme>;
}

/**
 * Union type for all supported API specification formats
 */
type APISpec = OpenAPISpec | Swagger2Spec;

interface OpenAPIOperation {
	operationId?: string;
	summary?: string;
	description?: string;
	tags?: string[];
	deprecated?: boolean;
	parameters?: Array<OpenAPIParameter>;
	requestBody?: OpenAPIRequestBody;
	responses?: Record<string, OpenAPIResponse>;
	security?: Array<Record<string, string[]>>;
	'x-destructive'?: boolean;
	'x-requires-approval'?: boolean;
	'x-risk-level'?: 'low' | 'medium' | 'high' | 'critical';
	'x-confirm-prompt'?: string;
	[key: string]: unknown;
}

interface OpenAPIParameter {
	name: string;
	in: 'query' | 'header' | 'path' | 'cookie';
	required?: boolean;
	schema?: OpenAPISchema;
	description?: string;
}

type OpenAPIParameterWithRef = OpenAPIParameter | (OpenAPIParameter & { $ref: string });

interface OpenAPIRequestBody {
	required?: boolean;
	content?: Record<string, { schema?: OpenAPISchema }>;
}

interface OpenAPIResponse {
	description?: string;
	content?: Record<string, { schema?: OpenAPISchema }>;
}

interface OpenAPISchema {
	type?: string;
	properties?: Record<string, OpenAPISchema>;
	items?: OpenAPISchema;
	required?: string[];
	enum?: string[];
	$ref?: string;
	description?: string;
	[key: string]: unknown;
}

interface OpenAPISecurityScheme {
	type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
	description?: string;
	name?: string;
	in?: 'query' | 'header' | 'cookie';
	scheme?: string;
	bearerFormat?: string;
	flows?: Record<string, unknown>;
}

/**
 * Options for loading OpenAPI spec
 */
export interface LoadOpenAPIOptions {
	/** API group name */
	name?: string;

	/** Filter operations */
	filter?: {
		/** Include only these tags */
		tags?: string[];
		/** Include only paths matching these patterns */
		paths?: string[];
		/** Exclude paths matching these patterns */
		exclude?: string[];
		/** Include only these HTTP methods */
		methods?: string[];
		/** Custom filter function */
		operation?: (op: OpenAPIOperation, path: string, method: string) => boolean;
	};

	/** Override descriptions for better LLM understanding */
	descriptions?: Record<string, string>;

	/** Annotation mapping */
	annotations?: {
		/** Map OpenAPI extensions to annotations */
		fromExtensions?: Record<string, string>;
		/** Global annotations for all operations */
		global?: Record<string, unknown>;
		/** Per-operation annotations */
		operations?: Record<string, Record<string, unknown>>;
	};

	/** Auth provider (optional, uses server's if not provided) */
	authProvider?: AuthProvider;

	/** Base URL override (if different from spec servers) */
	baseURL?: string;

	/**
	 * Dynamic header provider for per-request authentication (e.g., per-user OAuth).
	 * Similar to GraphQL's headerProvider. Called before each API request.
	 * @param params - The request parameters
	 * @param context - Optional context from contextProvider
	 * @returns Headers to add to the request
	 */
	headerProvider?: (
		params: Record<string, unknown> | undefined,
		context?: Record<string, unknown>
	) => Promise<Record<string, string>> | Record<string, string>;

	/**
	 * Context provider to extract context from execution environment.
	 * Similar to GraphQL's contextProvider. Called once per request.
	 * @param executionContext - The execution context from ATP
	 * @returns Context object passed to headerProvider
	 */
	contextProvider?: (
		executionContext?: Record<string, unknown>
	) => Promise<Record<string, unknown>> | Record<string, unknown>;

	/**
	 * Request transformer to modify the request before it's sent.
	 * Useful for APIs that require non-JSON content types (e.g., form-urlencoded).
	 * @param request - The request details (url, method, headers, body)
	 * @returns Modified request details
	 */
	requestTransformer?: (request: {
		url: string;
		method: string;
		headers: Record<string, string>;
		body: unknown;
	}) =>
		| Promise<{
				url?: string;
				method?: string;
				headers?: Record<string, string>;
				body?: string | undefined;
		  }>
		| {
				url?: string;
				method?: string;
				headers?: Record<string, string>;
				body?: string | undefined;
		  };

	/**
	 * Custom fetch function for full control over the HTTP transport layer.
	 * Use this when the target API requires custom TLS certificates (mTLS, custom CA),
	 * a proxy, or any other transport-level configuration that headers alone cannot provide.
	 *
	 * The function receives the URL and standard RequestInit on every request,
	 * making it inherently dynamic — you can route to different agents based on the URL.
	 *
	 * Applied to both spec loading and runtime API calls.
	 *
	 * @example
	 * ```typescript
	 * import { Agent } from 'undici';
	 *
	 * const mtlsAgent = new Agent({
	 *   connect: {
	 *     ca: fs.readFileSync('/certs/ca.pem'),
	 *     cert: fs.readFileSync('/certs/client.pem'),
	 *     key: fs.readFileSync('/certs/client-key.pem'),
	 *   },
	 * });
	 *
	 * await server.loadOpenAPI('https://partner-api.example.com/spec.json', {
	 *   fetcher: (url, init) => fetch(url, { ...init, dispatcher: mtlsAgent }),
	 * });
	 * ```
	 */
	fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Type guard to check if spec is OpenAPI 3.0+
 */
function isOpenAPI3(spec: APISpec): spec is OpenAPISpec {
	return 'openapi' in spec;
}

/**
 * Type guard to check if spec is Swagger 2.0
 */
function isSwagger2(spec: APISpec): spec is Swagger2Spec {
	return 'swagger' in spec;
}

/**
 * Load OpenAPI specification and convert to ATP API group
 */
export async function loadOpenAPI(
	source: string,
	options: LoadOpenAPIOptions = {}
): Promise<APIGroupConfig> {
	const spec = await loadSpec(source, options.fetcher);

	const name = options.name || spec.info.title.toLowerCase().replace(/\s+/g, '-');

	let baseURL = options.baseURL;
	if (!baseURL) {
		if (isOpenAPI3(spec) && spec.servers && spec.servers[0]) {
			baseURL = spec.servers[0].url;
		} else if (isSwagger2(spec) && spec.host) {
			const scheme = spec.schemes?.[0] || 'https';
			const host = spec.host;
			const basePath = spec.basePath || '';
			baseURL = `${scheme}://${host}${basePath}`;
		} else {
			baseURL = '';
		}
	}

	// Detect auth first so we can pass it to handlers
	const auth = detectAuth(spec, options.authProvider);

	const functions: CustomFunctionDef[] = [];

	for (const [path, pathItem] of Object.entries(spec.paths)) {
		// Extract path-level parameters (always an array)
		const pathParameters = pathItem.parameters || [];

		for (const [method, operation] of Object.entries(pathItem)) {
			if (['parameters', 'servers', 'summary', 'description'].includes(method)) {
				continue;
			}

			if (!shouldIncludeOperation(operation, path, method, options.filter)) {
				continue;
			}

			const func = convertOperation(
				path,
				method,
				operation as OpenAPIOperation,
				spec,
				baseURL,
				options,
				pathParameters,
				auth
			);

			if (func) {
				functions.push(func);
			}
		}
	}

	return {
		name,
		type: 'openapi',
		functions,
		auth,
	};
}

/**
 * Load OpenAPI spec from file or URL
 */
async function loadSpec(
	source: string,
	fetcher?: (url: string, init: RequestInit) => Promise<Response>
): Promise<APISpec> {
	let content: string;
	let isYaml = false;

	if (source.startsWith('http://') || source.startsWith('https://')) {
		const fetchFn = fetcher || fetch;
		const response = await fetchFn(source, { method: 'GET' });
		if (!response.ok) {
			throw new Error(`Failed to load OpenAPI spec from ${source}: ${response.statusText}`);
		}
		content = await response.text();
		const contentType = response.headers.get('content-type');
		isYaml =
			contentType?.includes('yaml') ||
			contentType?.includes('yml') ||
			source.endsWith('.yaml') ||
			source.endsWith('.yml');
	} else {
		content = await readFile(source, 'utf-8');
		isYaml = source.endsWith('.yaml') || source.endsWith('.yml');
	}

	try {
		if (isYaml) {
			return yaml.load(content) as OpenAPISpec;
		} else {
			try {
				return JSON.parse(content);
			} catch {
				return yaml.load(content) as OpenAPISpec;
			}
		}
	} catch (error) {
		throw new Error(`Failed to parse OpenAPI spec: ${(error as Error).message}`);
	}
}

/**
 * Check if operation should be included based on filters
 */
function shouldIncludeOperation(
	operation: unknown,
	path: string,
	method: string,
	filter?: LoadOpenAPIOptions['filter']
): boolean {
	// Skip if not an operation object
	if (
		typeof operation !== 'object' ||
		operation === null ||
		!('operationId' in operation || 'summary' in operation || 'description' in operation || 'responses' in operation)
	) {
		return false;
	}

	const op = operation as OpenAPIOperation;
	if (!filter) return true;

	if (filter.tags && filter.tags.length > 0) {
		if (!op.tags || !op.tags.some((t) => filter.tags!.includes(t))) {
			return false;
		}
	}

	if (filter.paths && filter.paths.length > 0) {
		if (!filter.paths.some((pattern) => matchPathPattern(path, pattern))) {
			return false;
		}
	}

	if (filter.exclude && filter.exclude.length > 0) {
		if (filter.exclude.some((pattern) => matchPathPattern(path, pattern))) {
			return false;
		}
	}

	if (filter.methods && filter.methods.length > 0) {
		if (!filter.methods.includes(method.toUpperCase())) {
			return false;
		}
	}

	if (op.deprecated) {
		return false;
	}

	if (filter.operation) {
		return filter.operation(op, path, method);
	}

	return true;
}

/**
 * Match path against pattern (supports wildcards)
 */
function matchPathPattern(path: string, pattern: string): boolean {
	const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

	return new RegExp(`^${regexPattern}$`).test(path);
}

function resolveReference<TRef = OpenAPISchema | OpenAPIParameter>(ref: string, spec: APISpec): TRef | null {
	const refPath = ref.split('/').slice(1);
	let resolved: unknown = spec;
	for (const part of refPath) {
		resolved = (resolved as Record<string, unknown>)?.[part];
	}
	return resolved as TRef;
}

/**
 * Merge path-level and operation-level parameters.
 * Operation-level parameters take precedence when there's a conflict (same name + in).
 */
function mergeParameters(
	pathParameters: Array<OpenAPIParameterWithRef>,
	operationParameters: Array<OpenAPIParameterWithRef>,
	spec: APISpec
): Array<OpenAPIParameter> {
	const paramMap = new Map<string, OpenAPIParameter>();

	// Add path-level parameters first
	for (let param of pathParameters) {
		param = resolveParamReferenceIfNeeded(param, spec);
		paramMap.set(`${param.in}:${param.name}`, param);
	}

	// Add operation-level parameters (overriding path-level ones)
	for (let param of operationParameters) {
		param = resolveParamReferenceIfNeeded(param, spec);
		paramMap.set(`${param.in}:${param.name}`, param);
	}

	return Array.from(paramMap.values());
}

/**
 * Convert OpenAPI operation to ATP function
 */
function convertOperation(
	path: string,
	method: string,
	operation: OpenAPIOperation,
	spec: APISpec,
	baseURL: string,
	options: LoadOpenAPIOptions,
	pathParameters: Array<OpenAPIParameterWithRef>,
	auth?: AuthConfig
): CustomFunctionDef | null {
	const operationName = operation.operationId || [method, path].join('_');
	const functionName = operationName.
		replace(/[^a-zA-Z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');

	const operationKey = `${method.toUpperCase()} ${path}`;
	const description =
		options.descriptions?.[operationKey] ||
		operation.summary ||
		operation.description ||
		`${method.toUpperCase()} ${path}`;

	// Merge path-level and operation-level parameters
	operation.parameters = mergeParameters(pathParameters, operation.parameters || [], spec);

	const inputSchema = buildInputSchema(operation, spec) as any;
	const outputSchema = buildOutputSchema(operation, spec) as any;

	const annotations = extractAnnotations(operation, operationKey, options.annotations);

	const handler = async (
		params: unknown,
		handlerContext?: {
			metadata?: unknown;
			requestContext?: Record<string, unknown>;
			emit?: unknown;
		}
	) => {
		const input = (params as Record<string, any>) || {};
		let requestPath = path;
		const queryParams: Record<string, string> = {};
		let body: any = undefined;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		let context: Record<string, unknown> | undefined;
		if (options.contextProvider) {
			context = await options.contextProvider(handlerContext?.requestContext);
		}

		if (options.headerProvider) {
			const dynamicHeaders = await options.headerProvider(input, context);
			Object.assign(headers, dynamicHeaders);
			log.debug('Added headers from headerProvider', { keys: Object.keys(dynamicHeaders) });
		}

		if (auth && !headers['Authorization']) {
			if (auth.scheme === 'bearer' && auth.envVar) {
				let token: string | null = null;
				if (options.authProvider) {
					token = await options.authProvider.getCredential(auth.envVar);
					log.debug(`Got token from authProvider for ${auth.envVar}`, {
						found: !!token,
						preview: token ? token.substring(0, 20) + '...' : undefined,
					});
				}
				if (!token) {
					token = process.env[auth.envVar] || null;
					log.debug(`Got token from process.env[${auth.envVar}]`, {
						found: !!token,
						preview: token ? token.substring(0, 20) + '...' : undefined,
					});
				}

				if (token) {
					headers['Authorization'] = `Bearer ${token}`;
				} else {
					log.warn(`${auth.envVar} not found! Set it in authProvider or environment.`);
				}
			} else if (auth.scheme === 'basic') {
				let username: string | null = null;
				let password: string | null = null;

				if (options.authProvider && auth.usernameEnvVar && auth.passwordEnvVar) {
					username = await options.authProvider.getCredential(auth.usernameEnvVar);
					password = await options.authProvider.getCredential(auth.passwordEnvVar);
				}
				if (!username && auth.usernameEnvVar) {
					username = process.env[auth.usernameEnvVar] || null;
				}
				if (!password && auth.passwordEnvVar) {
					password = process.env[auth.passwordEnvVar] || null;
				}

				if (username && password) {
					const credentials = Buffer.from(`${username}:${password}`).toString('base64');
					headers['Authorization'] = `Basic ${credentials}`;
				}
			} else if (auth.scheme === 'apiKey') {
				let apiKey: string | null = null;
				const apiKeyEnvVar = auth.envVar || 'API_KEY';
				if (options.authProvider) {
					apiKey = await options.authProvider.getCredential(apiKeyEnvVar);
				}
				if (!apiKey) {
					apiKey = process.env[apiKeyEnvVar] || null;
				}

				if (apiKey) {
					if (auth.in === 'header') {
						headers[auth.name] = apiKey;
					} else if (auth.in === 'query') {
						queryParams[auth.name] = apiKey;
					}
				}
			}
		}

		// Use merged parameters (includes both path-level and operation-level)
		if (operation.parameters && operation.parameters.length > 0) {
			for (let param of operation.parameters) {
				param = resolveParamReferenceIfNeeded(param, spec);

				if (param.in === 'path' && input[param.name]) {
					requestPath = requestPath.replace(
						`{${param.name}}`,
						encodeURIComponent(String(input[param.name]))
					);
				} else if (param.in === 'query' && input[param.name] !== undefined) {
					queryParams[param.name] = String(input[param.name]);
				} else if (param.in === 'header' && input[param.name]) {
					headers[param.name] = String(input[param.name]);
				}
			}
		}

		if (operation.requestBody && ['post', 'put', 'patch'].includes(method.toLowerCase())) {
			const bodyParams: Record<string, any> = {};
			if (operation.parameters && operation.parameters.length > 0) {
				const paramNames = operation.parameters.map((p) => p.name);
				for (const key in input) {
					if (!paramNames.includes(key)) {
						bodyParams[key] = input[key];
					}
				}
			} else {
				Object.assign(bodyParams, input);
			}
			if (Object.keys(bodyParams).length > 0) {
				body = bodyParams;
			}
		}

		if (!baseURL) {
			throw new Error(
				`No baseURL configured for OpenAPI spec. Check that the spec has a 'servers' section with a valid URL.`
			);
		}

		const baseUrlObj = new URL(baseURL);
		const basePath = baseUrlObj.pathname.replace(/\/$/, '');
		const fullPath = basePath + requestPath;
		const url = new URL(fullPath, baseUrlObj.origin);

		for (const [key, value] of Object.entries(queryParams)) {
			url.searchParams.append(key, value);
		}

		try {
			let finalUrl = url.toString();
			let finalMethod = method.toUpperCase();
			let finalHeaders = { ...headers };
			let finalBody: string | undefined = body ? JSON.stringify(body) : undefined;

			if (options.requestTransformer) {
				const transformed = await options.requestTransformer({
					url: finalUrl,
					method: finalMethod,
					headers: finalHeaders,
					body,
				});

				if (transformed.url) finalUrl = transformed.url;
				if (transformed.method) finalMethod = transformed.method;
				if (transformed.headers) finalHeaders = transformed.headers;
				if (transformed.body !== undefined) finalBody = transformed.body;
			}

			const fetchFn = options.fetcher || fetch;
			const response = await fetchFn(finalUrl, {
				method: finalMethod,
				headers: finalHeaders,
				body: finalBody,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP ${response.status}: ${errorText}`);
			}

			if (response.status === 204) {
				return { success: true };
			}

			const contentType = response.headers.get('content-type');
			if (contentType?.includes('application/json')) {
				const text = await response.text();
				if (!text || text.trim() === '') {
					return { success: true };
				}
				return JSON.parse(text);
			} else {
				return await response.text();
			}
		} catch (error: any) {
			throw new Error(`Failed to execute ${method.toUpperCase()} ${path}: ${error.message}`);
		}
	};

	return {
		name: functionName,
		description,
		inputSchema,
		outputSchema,
		handler,
		keywords: operation.tags || [],
	};
}

function resolveParamReferenceIfNeeded(param: OpenAPIParameterWithRef, spec: OpenAPISpec | Swagger2Spec) {
	if ('$ref' in param) {
		const resolved = resolveReference<OpenAPIParameter>(param.$ref as string, spec);
		if (resolved) {
			param = resolved;
		}
	}
	return param;
}

/**
 * Build input JSON schema from parameters and requestBody
 */
function buildInputSchema(operation: OpenAPIOperation, spec: APISpec): unknown {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	if (operation.parameters) {
		for (let param of operation.parameters) {
			param = resolveParamReferenceIfNeeded(param, spec);

			if (param.schema) {
				const paramSchema = resolveSchema(param.schema, spec);
				properties[param.name] =
					typeof paramSchema === 'object' && paramSchema !== null
						? { ...paramSchema, description: param.description || (paramSchema as any).description }
						: paramSchema;
			} else {
				properties[param.name] = { type: 'string', description: param.description };
			}
			if (param.required) {
				required.push(param.name);
			}
		}
	}

	if (operation.requestBody?.content?.['application/json']?.schema) {
		const bodySchema = resolveSchema(
			operation.requestBody.content['application/json'].schema,
			spec
		);

		if (typeof bodySchema === 'object' && bodySchema !== null) {
			if ('allOf' in bodySchema) {
				if (Object.keys(properties).length > 0) {
					return {
						type: 'object',
						properties,
						required: required.length > 0 ? required : undefined,
						allOf: (bodySchema as any).allOf,
					};
				}
				return bodySchema;
			}

			if ('additionalProperties' in bodySchema && !('properties' in bodySchema)) {
				if (Object.keys(properties).length > 0) {
					return {
						type: 'object',
						properties,
						required: required.length > 0 ? required : undefined,
						additionalProperties: (bodySchema as any).additionalProperties,
					};
				}
				return bodySchema;
			}

			if ('properties' in bodySchema) {
				Object.assign(properties, (bodySchema as any).properties);
				if ('required' in bodySchema && Array.isArray((bodySchema as any).required)) {
					required.push(...(bodySchema as any).required);
				}
			}
		}
	}

	return {
		type: 'object',
		properties,
		required: required.length > 0 ? required : undefined,
	};
}

/**
 * Build output JSON schema from responses
 */
function buildOutputSchema(operation: OpenAPIOperation, spec: APISpec): unknown | undefined {
	const successResponse =
		operation.responses?.['200'] ||
		operation.responses?.['201'] ||
		operation.responses?.['default'];

	if (!successResponse?.content?.['application/json']?.schema) {
		return undefined;
	}

	return resolveSchema(successResponse.content['application/json'].schema, spec, new Set());
}

/**
 * Resolve schema references ($ref) with circular reference detection.
 * Preserves all JSON Schema fields.
 */
function resolveSchema(
	schema: OpenAPISchema,
	spec: APISpec,
	visited: Set<string> = new Set()
): unknown {
	if (schema.$ref) {
		if (visited.has(schema.$ref)) {
			return { type: 'object', description: 'Circular reference: ' + schema.$ref };
		}

		const resolved = resolveReference<OpenAPISchema>(schema.$ref, spec);
		if (resolved) {
			visited.add(schema.$ref);
			const result = resolveSchema(resolved as OpenAPISchema, spec, visited);
			visited.delete(schema.$ref);
			return result;
		}
	}

	if (schema.allOf) {
		const result: Record<string, unknown> = {
			allOf: (schema.allOf as OpenAPISchema[]).map((s) => resolveSchema(s, spec, visited)),
		};
		if (schema.description) result.description = schema.description;
		return result;
	}

	const jsonSchema: Record<string, unknown> = {};

	if (schema.type) {
		jsonSchema.type = schema.type;
	} else if (!schema.oneOf && !schema.anyOf) {
		jsonSchema.type = 'object';
	}

	if (schema.properties) {
		const properties: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(schema.properties)) {
			properties[key] = resolveSchema(value, spec, visited);
		}
		jsonSchema.properties = properties;
	}

	if (schema.items) {
		jsonSchema.items = resolveSchema(schema.items, spec, visited);
	}

	if (schema.oneOf) {
		jsonSchema.oneOf = (schema.oneOf as OpenAPISchema[]).map((s) =>
			resolveSchema(s, spec, visited)
		);
	}

	if (schema.anyOf) {
		jsonSchema.anyOf = (schema.anyOf as OpenAPISchema[]).map((s) =>
			resolveSchema(s, spec, visited)
		);
	}

	if (schema.additionalProperties !== undefined) {
		jsonSchema.additionalProperties =
			typeof schema.additionalProperties === 'object'
				? resolveSchema(schema.additionalProperties as OpenAPISchema, spec, visited)
				: schema.additionalProperties;
	}

	const directCopyFields = [
		'required',
		'enum',
		'description',
		'format',
		'nullable',
		'default',
		'minimum',
		'maximum',
		'exclusiveMinimum',
		'exclusiveMaximum',
		'multipleOf',
		'minLength',
		'maxLength',
		'pattern',
		'minItems',
		'maxItems',
		'uniqueItems',
		'readOnly',
		'writeOnly',
		'example',
		'deprecated',
	] as const;

	for (const field of directCopyFields) {
		if (schema[field] !== undefined) {
			jsonSchema[field] = schema[field];
		}
	}

	return jsonSchema;
}

/**
 * Extract annotations from OpenAPI extensions
 */
function extractAnnotations(
	operation: OpenAPIOperation,
	operationKey: string,
	annotationOptions?: LoadOpenAPIOptions['annotations']
): Record<string, unknown> {
	const annotations: Record<string, unknown> = {};

	if (annotationOptions?.global) {
		Object.assign(annotations, annotationOptions.global);
	}

	if (annotationOptions?.operations?.[operationKey]) {
		Object.assign(annotations, annotationOptions.operations[operationKey]);
	}

	if (annotationOptions?.fromExtensions) {
		for (const [extensionKey, annotationKey] of Object.entries(annotationOptions.fromExtensions)) {
			if (extensionKey in operation) {
				annotations[annotationKey] = operation[extensionKey];
			}
		}
	} else {
		if (operation['x-destructive']) {
			annotations.destructive = operation['x-destructive'];
		}
		if (operation['x-requires-approval']) {
			annotations.requiresApproval = operation['x-requires-approval'];
		}
		if (operation['x-risk-level']) {
			annotations.risk = operation['x-risk-level'];
		}
		if (operation['x-confirm-prompt']) {
			annotations.confirmPrompt = operation['x-confirm-prompt'];
		}
	}

	return annotations;
}

/**
 * Detect authentication from OpenAPI securitySchemes or Swagger securityDefinitions
 */
function detectAuth(spec: APISpec, authProvider?: AuthProvider): AuthConfig | undefined {
	let schemeName: string | undefined;

	// Try to get scheme from security requirements
	if (spec.security && spec.security.length > 0) {
		const securityReq = spec.security[0];
		if (securityReq) {
			schemeName = Object.keys(securityReq)[0];
		}
	}

	const securitySchemes = isOpenAPI3(spec)
		? spec.components?.securitySchemes
		: isSwagger2(spec)
			? spec.securityDefinitions
			: undefined;

	if (!schemeName && securitySchemes) {
		const schemes = Object.keys(securitySchemes);
		if (schemes.length > 0) {
			schemeName = schemes[0];
			log.debug(`No security requirements found, using first securityScheme: ${schemeName}`);
		}
	}

	if (!schemeName || !securitySchemes) {
		return undefined;
	}

	const scheme = securitySchemes[schemeName];
	if (!scheme) {
		return undefined;
	}

	// Get API name for environment variable prefix
	const apiName = spec.info.title.toUpperCase().replace(/[^A-Z0-9]/g, '_');

	switch (scheme.type) {
		case 'http':
			if (scheme.scheme === 'bearer') {
				const authConfig: BearerAuthConfig = {
					scheme: 'bearer',
					envVar: `${apiName}_TOKEN`,
				};
				log.debug(`Detected Bearer token auth`, { envVar: authConfig.envVar });
				return authConfig;
			} else if (scheme.scheme === 'basic') {
				const authConfig: BasicAuthConfig = {
					scheme: 'basic',
					usernameEnvVar: `${apiName}_USERNAME`,
					passwordEnvVar: `${apiName}_PASSWORD`,
				};
				log.debug(`Detected Basic auth`, {
					usernameEnvVar: authConfig.usernameEnvVar,
					passwordEnvVar: authConfig.passwordEnvVar,
				});
				return authConfig;
			}
			break;
		case 'apiKey': {
			const authConfig: APIKeyAuthConfig = {
				scheme: 'apiKey',
				in: scheme.in === 'query' ? 'query' : 'header',
				name: scheme.name || 'X-API-Key',
				envVar: `${apiName}_API_KEY`,
			};
			return authConfig;
		}
	}
	return undefined;
}
