import {
	buildClientSchema,
	buildSchema,
	getIntrospectionQuery,
	print,
	type GraphQLSchema,
	type GraphQLField,
	type GraphQLInputType,
	type GraphQLOutputType,
	isScalarType,
	isObjectType,
	isListType,
	isNonNullType,
	isEnumType,
	isInputObjectType,
	isInterfaceType,
	type GraphQLArgument,
	IntrospectionQuery,
} from 'graphql';
import type { APIGroupConfig, CustomFunctionDef, JSONSchema } from '@mondaydotcomorg/atp-protocol';
import fs from 'node:fs/promises';

export interface LoadGraphQLOptions {
	name?: string;
	url?: string;
	headers?: Record<string, string>;
	depthLimit?: number;
	queryDepthLimit?: number;
}

/**
 * Load GraphQL specification and convert to ATP API group
 */
export async function loadGraphQL(
	source: string,
	options: LoadGraphQLOptions = {}
): Promise<APIGroupConfig> {
	const schema = await loadSchema(source, options);
	const name = options.name || 'graphql';
	const functions: CustomFunctionDef[] = [];
	const url = options.url || source;

	const queryType = schema.getQueryType();
	if (queryType) {
		const fields = queryType.getFields();
		for (const [fieldName, field] of Object.entries(fields)) {
			functions.push(convertFieldToFunction('query', fieldName, field, url, options));
		}
	}

	const mutationType = schema.getMutationType();
	if (mutationType) {
		const fields = mutationType.getFields();
		for (const [fieldName, field] of Object.entries(fields)) {
			functions.push(convertFieldToFunction('mutation', fieldName, field, url, options));
		}
	}

	return {
		name,
		type: 'graphql',
		functions,
	};
}

async function loadSchema(source: string, options: LoadGraphQLOptions): Promise<GraphQLSchema> {
	// Check if source is a URL
	if (source.startsWith('http://') || source.startsWith('https://')) {
		const response = await fetch(source, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...options.headers,
			},
			body: JSON.stringify({ query: getIntrospectionQuery() }),
		});

		if (!response.ok) {
            // If POST with introspection fails, try GET assuming it might return SDL or JSON
            const getResponse = await fetch(source, {
                headers: options.headers
            });
            if (getResponse.ok) {
                const text = await getResponse.text();
                try {
                    return buildSchema(text);
                } catch (e) {
                    // If buildSchema fails, try parsing as JSON introspection result
                    try {
                         const json = JSON.parse(text);
                         return buildClientSchema(json.data);
                    } catch (e2) {
                         throw new Error(`Failed to parse schema from ${source}`);
                    }
                }
            }
			throw new Error(`Failed to fetch schema from ${source}: ${response.statusText}`);
		}

		const result = await response.json() as { data: IntrospectionQuery };
		return buildClientSchema(result.data);
	}

	// Load from local file
	const content = await fs.readFile(source, 'utf-8');
	if (source.endsWith('.json')) {
		const result = JSON.parse(content);
		return buildClientSchema(result.data || result);
	}
	return buildSchema(content);
}

function convertFieldToFunction(
	type: 'query' | 'mutation',
	fieldName: string,
	field: GraphQLField<any, any>,
	url: string,
	options: LoadGraphQLOptions
): CustomFunctionDef {
	const functionName = `${type}_${fieldName}`;
	const description = field.description || `${type} ${fieldName}`;
	
	const inputSchema = convertArgumentsToSchema(field.args);
	
	// Add special _fields parameter for custom field selection
	inputSchema.properties = inputSchema.properties || {};
	inputSchema.properties._fields = {
		type: 'string',
		description: 'Optional: Comma-separated list of fields to select (e.g., "id,name,email" or "id,name,account{id,name}"). If not provided, only top-level scalar fields are returned.',
	};
	
	const outputSchema = convertTypeToSchema(field.type, options.depthLimit || 3);

	return {
		name: functionName,
		description,
		inputSchema,
		outputSchema,
		handler: async (params: unknown, context?: { metadata?: Record<string, any> }) => {
			const paramsObj = (params as Record<string, any>) || {};
			const customFields = paramsObj._fields;
			
			// Remove _fields from variables sent to GraphQL
			const variables = { ...paramsObj };
			delete variables._fields;
			
			const query = buildQuery(
				type, 
				fieldName, 
				field.args, 
				variables, 
				field, 
				options.queryDepthLimit,
				customFields
			);
			
			// Log to server console (controlled by DEBUG_GRAPHQL env var)
			const debugMode = process.env.DEBUG_GRAPHQL === 'true';
			if (debugMode) {
				console.log(`\n${'='.repeat(80)}`);
				console.log(`[GraphQL ${functionName}] Query:`);
				console.log(query);
				console.log(`\n[GraphQL ${functionName}] Variables:`);
				console.log(JSON.stringify(variables, null, 2));
				if (customFields) {
					console.log(`\n[GraphQL ${functionName}] Custom fields: ${customFields}`);
				}
				console.log('='.repeat(80) + '\n');
			}
			
			if (context?.metadata) {
				context.metadata.graphql_query = query;
				context.metadata.graphql_variables = variables;
			}
			
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...options.headers,
				},
				body: JSON.stringify({ 
                    query,
                    variables
                }),
			});

			if (!response.ok) {
				const errorMsg = `GraphQL request failed: ${response.statusText}\nQuery: ${query}\nVariables: ${JSON.stringify(variables)}`;
				throw new Error(errorMsg);
			}

			const result = await response.json() as { data?: Record<string, any>, errors?: { message: string }[] };
			if (result.errors) {
				const errorMsg = `GraphQL Error: ${result.errors.map((e: any) => e.message).join(', ')}\nQuery: ${query}\nVariables: ${JSON.stringify(variables)}`;
				throw new Error(errorMsg);
			}

			return result.data?.[fieldName];
		},
	};
}

function convertArgumentsToSchema(args: readonly GraphQLArgument[]): JSONSchema {
	const properties: Record<string, JSONSchema> = {};
	const required: string[] = [];

	for (const arg of args) {
		const schema = convertTypeToSchema(arg.type, 3);
		if (arg.description) {
			schema.description = arg.description;
		}
		properties[arg.name] = schema;
		if (isNonNullType(arg.type)) {
			required.push(arg.name);
		}
	}

	return {
		type: 'object',
		properties,
		required: required.length > 0 ? required : undefined,
	};
}

function convertTypeToSchema(type: GraphQLInputType | GraphQLOutputType, depth: number): JSONSchema {
	if (isNonNullType(type)) {
		return convertTypeToSchema(type.ofType, depth);
	}

	if (isListType(type)) {
		return {
			type: 'array',
			items: convertTypeToSchema(type.ofType as GraphQLOutputType, depth),
		};
	}

	if (isScalarType(type)) {
		switch (type.name) {
			case 'Int':
			case 'Float':
				return { type: 'number' };
			case 'Boolean':
				return { type: 'boolean' };
            case 'ID':
			case 'String':
			default:
				return { type: 'string' };
		}
	}

	if (isEnumType(type)) {
		return {
			type: 'string',
			enum: type.getValues().map((v) => v.name),
		};
	}

	if ((isObjectType(type) || isInputObjectType(type)) && depth > 0) {
		const properties: Record<string, JSONSchema> = {};
		const fieldMap = type.getFields();
        
		for (const [name, field] of Object.entries(fieldMap)) {
			if (isObjectType(type)) {
				const objectField = field as GraphQLField<any, any>;
				if (objectField.deprecationReason || SKIPPED_FIELDS.has(name)) {
					continue;
				}
			}
			const fieldSchema = convertTypeToSchema(field.type, depth - 1);
			
			if ('description' in field && field.description) {
				fieldSchema.description = field.description;
			}
			
			properties[name] = fieldSchema;
		}
		
		if (Object.keys(properties).length === 0) {
			return { type: 'object' };
		}

		return {
			type: 'object',
			properties,
		};
	}
    
    if (isObjectType(type) || isInputObjectType(type)) {
        return { type: 'object' };
    }

	return { type: 'string' };
}

function buildQuery(
	type: 'query' | 'mutation',
	fieldName: string,
	args: readonly GraphQLArgument[],
	params: Record<string, any>,
    field: GraphQLField<any, any>,
    queryDepthLimit?: number,
	customFields?: string
): string {
    // We use variables for arguments
    const variableDefs: string[] = [];
    const fieldArgs: string[] = [];

    for (const arg of args) {
        if (params && params[arg.name] !== undefined) {
            const varName = arg.name;
            variableDefs.push(`$${varName}: ${arg.type.toString()}`);
            fieldArgs.push(`${arg.name}: $${varName}`);
        }
    }

    const variableString = variableDefs.length > 0 ? `(${variableDefs.join(', ')})` : '';
    const argsString = fieldArgs.length > 0 ? `(${fieldArgs.join(', ')})` : '';
    
    let selectionSet: string;
    if (customFields) {
        selectionSet = `{ ${customFields} }`;
    } else {
        const depth = queryDepthLimit !== undefined ? queryDepthLimit : 2;
        selectionSet = buildSelectionSet(field.type, depth);
    }

    return `${type} ${variableString} {
        ${fieldName}${argsString} ${selectionSet}
    }`;
}

const SKIPPED_FIELDS = new Set([
	// Common problematic fields across different API versions
	'settings',
	'sort',
	'filter',
	'filter_user_id',
	'filter_team_id',
	'tags',
	'access_level',
	'original_creation_date',
	'revision',
	'columns_namespace',
	'hierarchy_type',
	'object_type_unique_key',
	'created_at', 
	'tier', 
	'viewers', 
	'capabilities', 
	'description', 
	'assets', 
]);

function buildSelectionSet(type: GraphQLOutputType, depth?: number, visited = new Set<string>()): string {
	if (depth === undefined) depth = 2;
	if (isNonNullType(type)) {
		return buildSelectionSet(type.ofType, depth, visited);
	}
	if (isListType(type)) {
		return buildSelectionSet(type.ofType, depth, visited);
	}
	if (isObjectType(type) || isInterfaceType(type)) {
		const typeName = type.name;
		
		if (visited.has(typeName) && visited.size > 2) {
			return '';
		}
		
		const newVisited = new Set(visited);
		newVisited.add(typeName);
		
		const fields = type.getFields();
		const selections: string[] = [];
		let scalarCount = 0;
		let objectCount = 0;
		const MAX_SCALARS = 30;
		const MAX_OBJECTS = depth > 0 ? 5 : 0; // At depth 0, don't include ANY nested objects
		
		for (const [name, field] of Object.entries(fields)) {
			if (field.deprecationReason || SKIPPED_FIELDS.has(name)) continue;
			
			// Skip fields that require arguments WITHOUT defaults
			const hasRequiredArgsWithoutDefaults = field.args.some(arg => 
				isNonNullType(arg.type) && arg.defaultValue === undefined
			);
			if (hasRequiredArgsWithoutDefaults) continue;

			// Only select scalars or simple objects to avoid deep nesting and cycles
			const fieldType = getBaseType(field.type);
			if (isScalarType(fieldType) || isEnumType(fieldType)) {
				if (scalarCount < MAX_SCALARS) {
					selections.push(name);
					scalarCount++;
				}
			} else {
				// Only include nested objects if depth allows
				if (objectCount < MAX_OBJECTS && depth > 0) {
					const nextDepth = depth - 1;
					const subSelection = buildSelectionSet(field.type, nextDepth, newVisited);
					if (subSelection) {
						selections.push(`${name} ${subSelection}`);
						objectCount++;
					}
				}
			}
		}
		if (selections.length === 0) return '';

		return `{ ${selections.join(' ')} }`;
	}
	return '';
}

function getBaseType(type: GraphQLOutputType): any {
    if (isNonNullType(type) || isListType(type)) {
        return getBaseType(type.ofType);
    }
    return type;
}

