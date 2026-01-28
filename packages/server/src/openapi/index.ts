import type {
	APIGroupConfig,
	CustomFunctionDef,
	ToolOperationType,
} from '@mondaydotcomorg/atp-protocol';
import type {
	AuthConfig,
	APIKeyAuthConfig,
	BearerAuthConfig,
	BasicAuthConfig,
	OAuth2AuthConfig,
} from '@mondaydotcomorg/atp-protocol';
import { readFile } from 'node:fs/promises';

interface OpenAPISpec {
	openapi: string;
	info: {
		title: string;
		version: string;
		description?: string;
	};
	paths: Record<string, Record<string, OpenAPIOperation> & { parameters?: OpenAPIParameter[] }>;
	servers?: Array<{ url: string; description?: string }>;
	components?: {
		schemas?: Record<string, unknown>;
		securitySchemes?: Record<string, OpenAPISecurityScheme>;
	};
	security?: Array<Record<string, string[]>>;
}

interface OpenAPIParameter {
	name: string;
	in: string;
	required?: boolean;
	schema?: { type?: string; description?: string };
	description?: string;
}

interface OpenAPISecurityScheme {
	type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
	description?: string;
	name?: string;
	in?: 'query' | 'header' | 'cookie';
	scheme?: string;
	bearerFormat?: string;
	flows?: {
		clientCredentials?: {
			tokenUrl: string;
			refreshUrl?: string;
			scopes?: Record<string, string>;
		};
		authorizationCode?: {
			authorizationUrl: string;
			tokenUrl: string;
			refreshUrl?: string;
			scopes?: Record<string, string>;
		};
		implicit?: {
			authorizationUrl: string;
			scopes?: Record<string, string>;
		};
		password?: {
			tokenUrl: string;
			refreshUrl?: string;
			scopes?: Record<string, string>;
		};
	};
}

interface OpenAPIOperation {
	summary?: string;
	description?: string;
	operationId?: string;
	parameters?: OpenAPIParameter[];
	requestBody?: {
		content?: {
			'application/json'?: {
				schema?: unknown;
			};
		};
	};
	responses?: Record<string, unknown>;
	/** Per-operation security requirements */
	security?: Array<Record<string, string[]>>;
}

/**
 * OpenAPIConverter converts OpenAPI specifications to Agent Tool Protocol API groups.
 */
export class OpenAPIConverter {
	/**
	 * Converts an OpenAPI specification to an API group configuration.
	 * @param spec - OpenAPI specification object
	 * @param httpClient - Function to execute HTTP requests (optional)
	 * @param authEnvVarPrefix - Prefix for environment variables (e.g., 'GITHUB' -> 'GITHUB_API_KEY')
	 * @returns APIGroupConfig object
	 */
	static fromSpec(
		spec: OpenAPISpec,
		httpClient?: (method: string, path: string, params?: unknown) => Promise<unknown>,
		authEnvVarPrefix?: string
	): APIGroupConfig {
		const functions: CustomFunctionDef[] = [];

		const baseUrl = spec.servers?.[0]?.url || '';

		const globalSecurity = spec.security;

		for (const [path, methods] of Object.entries(spec.paths)) {
			// Extract path-level parameters (apply to all operations under this path)
			const pathParameters = Array.isArray(methods.parameters) ? methods.parameters : [];

			for (const [method, operation] of Object.entries(methods)) {
				// Skip non-operation keys
				if (['parameters', 'servers', 'summary', 'description'].includes(method)) {
					continue;
				}

				const func = this.convertOperation(path, method, operation as OpenAPIOperation, pathParameters, httpClient, globalSecurity);
				if (func) {
					functions.push(func);
				}
			}
		}

		const auth = this.parseAuthentication(spec, authEnvVarPrefix);

		return {
			name: this.sanitizeName(spec.info.title),
			type: 'openapi',
			spec,
			functions,
			url: baseUrl,
			auth,
		};
	}

	/**
	 * Converts an OpenAPI operation to a function definition.
	 */
	private static convertOperation(
		path: string,
		method: string,
		operation: OpenAPIOperation,
		pathParameters: OpenAPIParameter[],
		httpClient?: (method: string, path: string, params?: unknown) => Promise<unknown>,
		globalSecurity?: Array<Record<string, string[]>>
	): CustomFunctionDef | null {
		const functionName = operation.operationId || this.generateFunctionName(method, path);
		const description =
			operation.summary || operation.description || `${method.toUpperCase()} ${path}`;

		// Extract path parameters from path template (e.g., /users/{id} -> id)
		const pathParamNames = this.extractPathParameters(path);

		// Merge path-level parameters with operation-level parameters
		// Operation-level parameters override path-level ones with the same name
		const allParameters = this.mergeParameters(pathParameters, operation.parameters || [], pathParamNames);

		const inputSchema = this.buildInputSchema(allParameters, operation);

		const requiredScopes = this.extractRequiredScopes(operation.security || globalSecurity);

		const operationType = this.inferOperationType(method);

		const handler = httpClient
			? async (input: unknown) => {
					return await httpClient(method, path, input);
				}
			: async (input: unknown) => {
					throw new Error(`No HTTP client configured for ${functionName}`);
				};

		return {
			name: functionName,
			description,
			inputSchema,
			handler,
			metadata: {
				operationType,
				...(requiredScopes.length > 0 && { requiredScopes }),
			},
		};
	}

	/**
	 * Extracts parameter names from path template (e.g., /users/{id}/posts/{postId} -> ['id', 'postId'])
	 */
	private static extractPathParameters(path: string): string[] {
		const matches = path.matchAll(/\{([^}]+)\}/g);
		return Array.from(matches, (match) => match[1]).filter((name): name is string => name !== undefined);
	}

	/**
	 * Merges path-level and operation-level parameters.
	 * Operation-level parameters override path-level ones with the same name.
	 * Also ensures path parameters from the template are included.
	 */
	private static mergeParameters(
		pathParameters: OpenAPIParameter[],
		operationParameters: OpenAPIParameter[],
		pathParamNames: string[]
	): OpenAPIParameter[] {
		const merged = new Map<string, OpenAPIParameter>();

		// First, add path-level parameters
		for (const param of pathParameters) {
			merged.set(param.name, param);
		}

		// Then, add/override with operation-level parameters
		for (const param of operationParameters) {
			merged.set(param.name, param);
		}

		// Finally, ensure all path template parameters are included
		// If a path parameter exists in the template but not in parameters, create a default one
		for (const paramName of pathParamNames) {
			if (!merged.has(paramName)) {
				merged.set(paramName, {
					name: paramName,
					in: 'path',
					required: true,
					schema: { type: 'string' },
				});
			}
		}

		return Array.from(merged.values());
	}

	/**
	 * Builds JSON schema from OpenAPI operation parameters and request body.
	 */
	private static buildInputSchema(
		parameters: OpenAPIParameter[],
		operation: OpenAPIOperation
	): {
		type: string;
		properties: Record<string, unknown>;
		required?: string[];
	} {
		const properties: Record<string, unknown> = {};
		const required: string[] = [];

		// Process all parameters (path-level + operation-level + extracted from path template)
		for (const param of parameters) {
			properties[param.name] = {
				type: param.schema?.type || 'string',
				description: param.description || param.schema?.description,
			};
			// Path parameters are always required
			if (param.required || param.in === 'path') {
				required.push(param.name);
			}
		}

		if (operation.requestBody?.content?.['application/json']?.schema) {
			const bodySchema = operation.requestBody.content['application/json'].schema as {
				properties?: Record<string, unknown>;
				required?: string[];
			};
			if (bodySchema.properties) {
				Object.assign(properties, bodySchema.properties);
			}
			if (bodySchema.required) {
				required.push(...bodySchema.required);
			}
		}

		return {
			type: 'object',
			properties,
			...(required.length > 0 && { required }),
		};
	}

	/**
	 * Generates a function name from HTTP method and path.
	 */
	private static generateFunctionName(method: string, path: string): string {
		const cleanPath = path
			.replace(/^[^a-zA-Z0-9_]+/, '')
			.replace(/\{([^}]+)\}/g, 'By_$1')
			.replace(/[^a-zA-Z0-9_]/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_|_$/g, '');

		return `${method}_${cleanPath}`;
	}

	/**
	 * Sanitizes a name for use as an API group name.
	 */
	private static sanitizeName(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_|_$/g, '');
	}

	/**
	 * Extracts required OAuth scopes from security requirements
	 */
	private static extractRequiredScopes(security?: Array<Record<string, string[]>>): string[] {
		if (!security || security.length === 0) {
			return [];
		}

		const allScopes = new Set<string>();
		for (const secReq of security) {
			for (const scopes of Object.values(secReq)) {
				scopes.forEach((scope) => allScopes.add(scope));
			}
		}

		return Array.from(allScopes);
	}

	/**
	 * Infers operation type from HTTP method
	 */
	private static inferOperationType(method: string): ToolOperationType {
		const m = method.toLowerCase();
		if (m === 'get' || m === 'head' || m === 'options') {
			return 'read' as ToolOperationType;
		}
		if (m === 'delete') {
			return 'destructive' as ToolOperationType;
		}
		return 'write' as ToolOperationType;
	}

	/**
	 * Parses authentication from OpenAPI security schemes
	 */
	private static parseAuthentication(
		spec: OpenAPISpec,
		envVarPrefix?: string
	): AuthConfig | undefined {
		if (!spec.security || spec.security.length === 0) {
			return undefined;
		}

		const securityReq = spec.security[0];
		if (!securityReq) {
			return undefined;
		}
		const schemeName = Object.keys(securityReq)[0];

		if (!schemeName || !spec.components?.securitySchemes) {
			return undefined;
		}

		const scheme = spec.components.securitySchemes[schemeName];
		if (!scheme) {
			return undefined;
		}

		const envPrefix = envVarPrefix || this.sanitizeName(spec.info.title).toUpperCase();

		switch (scheme.type) {
			case 'apiKey':
				return {
					scheme: 'apiKey',
					in: scheme.in === 'query' ? 'query' : 'header',
					name: scheme.name || 'X-API-Key',
					envVar: `${envPrefix}_API_KEY`,
				} as APIKeyAuthConfig;

			case 'http':
				if (scheme.scheme === 'bearer') {
					return {
						scheme: 'bearer',
						bearerFormat: scheme.bearerFormat,
						envVar: `${envPrefix}_TOKEN`,
					} as BearerAuthConfig;
				} else if (scheme.scheme === 'basic') {
					return {
						scheme: 'basic',
						usernameEnvVar: `${envPrefix}_USERNAME`,
						passwordEnvVar: `${envPrefix}_PASSWORD`,
					} as BasicAuthConfig;
				}
				break;

			case 'oauth2':
				if (scheme.flows?.clientCredentials) {
					return {
						scheme: 'oauth2',
						flow: 'clientCredentials',
						tokenUrl: scheme.flows.clientCredentials.tokenUrl,
						clientIdEnvVar: `${envPrefix}_CLIENT_ID`,
						clientSecretEnvVar: `${envPrefix}_CLIENT_SECRET`,
						scopes: scheme.flows.clientCredentials.scopes
							? Object.keys(scheme.flows.clientCredentials.scopes)
							: undefined,
					} as OAuth2AuthConfig;
				}
				return {
					scheme: 'bearer',
					envVar: `${envPrefix}_TOKEN`,
				} as BearerAuthConfig;
		}

		return undefined;
	}

	/**
	 * Loads OpenAPI spec from a URL.
	 * @param url - URL to fetch OpenAPI spec from
	 * @param httpClient - Optional HTTP client function
	 * @param authEnvVarPrefix - Prefix for environment variables
	 * @returns APIGroupConfig object
	 */
	static async fromURL(
		url: string,
		httpClient?: (method: string, path: string, params?: unknown) => Promise<unknown>,
		authEnvVarPrefix?: string
	): Promise<APIGroupConfig> {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch OpenAPI spec from ${url}: ${response.statusText}`);
		}
		const spec = (await response.json()) as OpenAPISpec;
		return this.fromSpec(spec, httpClient, authEnvVarPrefix);
	}

	/**
	 * Loads OpenAPI spec from a file path.
	 * @param filePath - Path to OpenAPI spec file
	 * @param httpClient - Optional HTTP client function
	 * @param authEnvVarPrefix - Prefix for environment variables
	 * @returns APIGroupConfig object
	 */
	static async fromFile(
		filePath: string,
		httpClient?: (method: string, path: string, params?: unknown) => Promise<unknown>,
		authEnvVarPrefix?: string
	): Promise<APIGroupConfig> {
		const content = await readFile(filePath, 'utf-8');
		const spec = JSON.parse(content) as OpenAPISpec;
		return this.fromSpec(spec, httpClient, authEnvVarPrefix);
	}
}
