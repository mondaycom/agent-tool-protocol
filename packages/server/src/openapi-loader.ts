import type {
	APIGroupConfig,
	CustomFunctionDef,
	AuthProvider,
	AuthConfig,
	BearerAuthConfig,
	BasicAuthConfig,
	APIKeyAuthConfig,
} from '@mondaydotcomorg/atp-protocol';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

/**
 * Base HTTP API specification (common to both OpenAPI and Swagger)
 */
interface BaseAPISpec {
	info: {
		title: string;
		version: string;
		description?: string;
	};
	paths: Record<string, Record<string, OpenAPIOperation>>;
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
	const spec = await loadSpec(source);

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

	for (const [path, methods] of Object.entries(spec.paths)) {
		for (const [method, operation] of Object.entries(methods)) {
			if (['parameters', 'servers', 'summary', 'description'].includes(method)) {
				continue;
			}

			if (!shouldIncludeOperation(operation, path, method, options.filter)) {
				continue;
			}

			const func = convertOperation(path, method, operation, spec, baseURL, options, auth);

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
async function loadSpec(source: string): Promise<APISpec> {
	let content: string;
	let isYaml = false;

	if (source.startsWith('http://') || source.startsWith('https://')) {
		const response = await fetch(source);
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
	operation: OpenAPIOperation,
	path: string,
	method: string,
	filter?: LoadOpenAPIOptions['filter']
): boolean {
	if (!filter) return true;

	if (filter.tags && filter.tags.length > 0) {
		if (!operation.tags || !operation.tags.some((t) => filter.tags!.includes(t))) {
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

	if (operation.deprecated) {
		return false;
	}

	if (filter.operation) {
		return filter.operation(operation, path, method);
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
	auth?: AuthConfig
): CustomFunctionDef | null {
	const functionName = operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

	const operationKey = `${method.toUpperCase()} ${path}`;
	const description =
		options.descriptions?.[operationKey] ||
		operation.summary ||
		operation.description ||
		`${method.toUpperCase()} ${path}`;

	const inputSchema = buildInputSchema(operation, spec) as any;
	const outputSchema = buildOutputSchema(operation, spec) as any;

	const annotations = extractAnnotations(operation, operationKey, options.annotations);

	const handler = async (params: unknown) => {
		// Build the actual HTTP request
		const input = (params as Record<string, any>) || {};
		let requestPath = path;
		const queryParams: Record<string, string> = {};
		let body: any = undefined;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		// Add authentication
		if (auth) {
			if (auth.scheme === 'bearer' && auth.envVar) {
				// Try authProvider first, fallback to process.env
				let token: string | null = null;
				if (options.authProvider) {
					token = await options.authProvider.getCredential(auth.envVar);
					console.log(
						`[AUTH DEBUG] Got token from authProvider for ${auth.envVar}: ${token ? 'YES (' + token.substring(0, 20) + '...)' : 'NO'}`
					);
				}
				if (!token) {
					token = process.env[auth.envVar] || null;
					console.log(
						`[AUTH DEBUG] Got token from process.env[${auth.envVar}]: ${token ? 'YES (' + token.substring(0, 20) + '...)' : 'NO'}`
					);
				}

				if (token) {
					headers['Authorization'] = `Bearer ${token}`;
				} else {
					console.warn(
						`[AUTH WARNING] ${auth.envVar} not found! Set it in authProvider or environment.`
					);
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

		// Replace path parameters
		if (operation.parameters) {
			for (const param of operation.parameters) {
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

		// Add request body if present
		if (operation.requestBody && ['post', 'put', 'patch'].includes(method.toLowerCase())) {
			// Collect body properties
			const bodyParams: Record<string, any> = {};
			if (operation.parameters) {
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

		// Build URL with query params
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

		// Make the HTTP request
		try {
			const response = await fetch(url.toString(), {
				method: method.toUpperCase(),
				headers,
				body: body ? JSON.stringify(body) : undefined,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`HTTP ${response.status}: ${errorText}`);
			}

			// Handle 204 No Content
			if (response.status === 204) {
				return { success: true };
			}

			const contentType = response.headers.get('content-type');
			if (contentType?.includes('application/json')) {
				const text = await response.text();
				// Handle empty response body
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

/**
 * Build input JSON schema from parameters and requestBody
 */
function buildInputSchema(operation: OpenAPIOperation, spec: APISpec): unknown {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	if (operation.parameters) {
		for (const param of operation.parameters) {
			if (param.schema) {
				properties[param.name] = resolveSchema(param.schema, spec);
				if (param.required) {
					required.push(param.name);
				}
			}
		}
	}

	if (operation.requestBody?.content?.['application/json']?.schema) {
		const bodySchema = resolveSchema(
			operation.requestBody.content['application/json'].schema,
			spec
		);

		if (typeof bodySchema === 'object' && bodySchema !== null && 'properties' in bodySchema) {
			Object.assign(properties, (bodySchema as any).properties);
			if ('required' in bodySchema && Array.isArray((bodySchema as any).required)) {
				required.push(...(bodySchema as any).required);
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
 * Resolve schema references ($ref) with circular reference detection
 */
function resolveSchema(
	schema: OpenAPISchema,
	spec: APISpec,
	visited: Set<string> = new Set()
): unknown {
	if (schema.$ref) {
		// Check for circular reference
		if (visited.has(schema.$ref)) {
			// Return a placeholder for circular references
			return { type: 'object', description: 'Circular reference: ' + schema.$ref };
		}

		const refPath = schema.$ref.split('/').slice(1);
		let resolved: unknown = spec;

		for (const part of refPath) {
			resolved = (resolved as Record<string, unknown>)?.[part];
		}

		if (resolved) {
			visited.add(schema.$ref);
			const result = resolveSchema(resolved as OpenAPISchema, spec, visited);
			visited.delete(schema.$ref);
			return result;
		}
	}

	const jsonSchema: Record<string, unknown> = { type: schema.type || 'object' };

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

	if (schema.required) {
		jsonSchema.required = schema.required;
	}

	if (schema.enum) {
		jsonSchema.enum = schema.enum;
	}

	if (schema.description) {
		jsonSchema.description = schema.description;
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
			console.log(
				`[AUTH] No security requirements found, using first securityScheme: ${schemeName}`
			);
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
				console.log(`[AUTH] Detected Bearer token auth: envVar=${authConfig.envVar}`);
				return authConfig;
			} else if (scheme.scheme === 'basic') {
				const authConfig: BasicAuthConfig = {
					scheme: 'basic',
					usernameEnvVar: `${apiName}_USERNAME`,
					passwordEnvVar: `${apiName}_PASSWORD`,
				};
				console.log(
					`[AUTH] Detected Basic auth: username=${authConfig.usernameEnvVar}, password=${authConfig.passwordEnvVar}`
				);
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
