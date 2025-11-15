#!/usr/bin/env tsx
/**
 * PURE OSS APPROACH - Battle-tested type extraction
 *
 * Uses:
 * 1. ts-json-schema-generator (OSS) for ALL type extraction
 * 2. ts-morph only for decorator parsing (API metadata)
 * 3. Custom converter to clean format
 *
 * No fallbacks - if OSS fails, we debug the config
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createGenerator } from 'ts-json-schema-generator';
import { Project } from 'ts-morph';
import type { RuntimeAPIMetadata, RuntimeAPIMethod, RuntimeAPIParam } from '../src/metadata/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract API metadata using ts-morph (lightweight, just for decorators)
 */
function extractAPIMetadata(project: Project): {
	apis: RuntimeAPIMetadata[];
	referencedTypes: Set<string>;
} {
	const metadataList: RuntimeAPIMetadata[] = [];
	const referencedTypes = new Set<string>();

	for (const sourceFile of project.getSourceFiles()) {
		if (
			sourceFile.getFilePath().includes('node_modules') ||
			sourceFile.getFilePath().includes('generated.ts')
		) {
			continue;
		}

		const classes = sourceFile.getClasses();

		for (const classDecl of classes) {
			const apiDecorator = classDecl.getDecorator('RuntimeAPI');
			if (!apiDecorator) continue;

			const decoratorArgs = apiDecorator.getArguments();
			const apiName = decoratorArgs[0]?.getText().replace(/^['"]|['"]$/g, '') || '';
			const apiDescription = decoratorArgs[1]?.getText().replace(/^['"]|['"]$/g, '') || '';

			const methods: RuntimeAPIMethod[] = [];

			for (const method of classDecl.getMethods()) {
				const methodDecorator = method.getDecorator('RuntimeMethod');
				if (!methodDecorator) continue;

				const methodName = method.getName();
				const methodArgs = methodDecorator.getArguments();
				const description = methodArgs[0]?.getText().replace(/^['"]|['"]$/g, '') || '';

				const params: RuntimeAPIParam[] = method.getParameters().map((param) => {
					const paramName = param.getName();
					const typeNode = param.getTypeNode();
					const paramType = typeNode ? typeNode.getText() : param.getType().getText();
					const isOptional = param.isOptional() || param.hasQuestionToken();

					collectReferencedTypes(paramType, referencedTypes);

					let paramDescription = '';
					if (methodArgs.length > 1 && methodArgs[1]) {
						const decoratorObj = methodArgs[1].getText();
						const match = decoratorObj.match(
							new RegExp(`${paramName}:\\s*\\{[^}]*description:\\s*['"]([^'"]+)['"]`)
						);
						if (match) {
							paramDescription = match[1] || '';
						}
					}

					return {
						name: paramName,
						type: paramType,
						description: paramDescription,
						optional: isOptional,
					};
				});

				const returnTypeNode = method.getReturnTypeNode();
				const returns = returnTypeNode
					? returnTypeNode.getText()
					: method.getSignature().getReturnType().getText();

				collectReferencedTypes(returns, referencedTypes);

				methods.push({
					name: methodName,
					description,
					params,
					returns,
				});
			}

			metadataList.push({
				name: apiName,
				description: apiDescription,
				methods,
			});
		}
	}

	return { apis: metadataList, referencedTypes };
}

/**
 * Fallback: Extract type using ts-morph when OSS fails (e.g., generics)
 */
function fallbackExtractType(project: Project, typeName: string): string | undefined {
	for (const sourceFile of project.getSourceFiles()) {
		if (
			sourceFile.getFilePath().includes('node_modules') ||
			sourceFile.getFilePath().includes('generated.ts')
		) {
			continue;
		}

		const interfaceDecl = sourceFile.getInterface(typeName);
		if (interfaceDecl) return interfaceDecl.getText();

		const typeAlias = sourceFile.getTypeAlias(typeName);
		if (typeAlias) return typeAlias.getText();

		const enumDecl = sourceFile.getEnum(typeName);
		if (enumDecl) return enumDecl.getText();
	}
	return undefined;
}

/**
 * Check if a type exists in our source files (not a built-in or external type)
 */
function isCustomType(project: Project, typeName: string): boolean {
	for (const sourceFile of project.getSourceFiles()) {
		if (
			sourceFile.getFilePath().includes('node_modules') ||
			sourceFile.getFilePath().includes('generated.ts')
		) {
			continue;
		}

		if (
			sourceFile.getInterface(typeName) ||
			sourceFile.getTypeAlias(typeName) ||
			sourceFile.getEnum(typeName)
		) {
			return true;
		}
	}
	return false;
}

/**
 * Collect custom type names from a type string
 */
function collectReferencedTypes(typeString: string, types: Set<string>): void {
	const matches = typeString.match(/\b[A-Z][a-zA-Z0-9]*\b/g);
	if (matches) {
		for (const match of matches) {
			types.add(match);
		}
	}
}

/**
 * Generate JSON Schema for a specific type using OSS
 */
function generateTypeSchema(tsConfigPath: string, typeName: string): any {
	try {
		const config = {
			path: 'src/**/*.ts',
			tsconfig: tsConfigPath,
			type: typeName,
			skipTypeCheck: true,
			expose: 'export' as const,
			jsDoc: 'extended' as const,
		};

		const generator = createGenerator(config);
		const schema = generator.createSchema(typeName);

		// Return the type definition
		return schema.definitions?.[typeName] || schema;
	} catch (error) {
		console.warn(`  ⚠ OSS failed for ${typeName}:`, (error as Error).message.split('\n')[0]);
		return null;
	}
}

/**
 * Convert JSON Schema to clean TypeScript-like definition string
 */
function jsonSchemaToTypeString(name: string, schema: any): string {
	if (schema.enum) {
		const values = schema.enum.map((v: any) => `'${v}'`).join(' | ');
		return `type ${name} = ${values};`;
	}

	if (schema.const) {
		return `type ${name} = '${schema.const}';`;
	}

	if (schema.type === 'object' && schema.properties) {
		const props = Object.entries(schema.properties).map(([key, value]: [string, any]) => {
			const optional = !schema.required?.includes(key);
			const typeStr = inferTypeFromSchema(value);
			return `  ${key}${optional ? '?' : ''}: ${typeStr};`;
		});
		return `interface ${name} {\n${props.join('\n')}\n}`;
	}

	return `type ${name} = ${inferTypeFromSchema(schema)};`;
}

/**
 * Infer TypeScript type string from JSON Schema
 */
function inferTypeFromSchema(schema: any): string {
	if (schema.$ref) return schema.$ref.replace('#/definitions/', '');
	if (schema.enum)
		return schema.enum.map((v: any) => (typeof v === 'string' ? `'${v}'` : v)).join(' | ');
	if (schema.const)
		return typeof schema.const === 'string' ? `'${schema.const}'` : String(schema.const);
	if (schema.type === 'string') return 'string';
	if (schema.type === 'number') return 'number';
	if (schema.type === 'boolean') return 'boolean';
	if (schema.type === 'null') return 'null';

	if (schema.type === 'array') {
		const items = schema.items ? inferTypeFromSchema(schema.items) : 'unknown';
		return `${items}[]`;
	}

	if (schema.type === 'object') {
		if (schema.additionalProperties === true) return 'Record<string, unknown>';
		if (schema.additionalProperties) {
			const valueType = inferTypeFromSchema(schema.additionalProperties);
			return `Record<string, ${valueType}>`;
		}
		if (schema.properties) {
			const keys = Object.keys(schema.properties);
			if (keys.length <= 3) {
				const props = keys
					.map((k) => {
						const optional = !schema.required?.includes(k);
						const type = inferTypeFromSchema(schema.properties[k]);
						return `${k}${optional ? '?' : ''}: ${type}`;
					})
					.join('; ');
				return `{ ${props} }`;
			}
		}
		return 'object';
	}

	if (schema.anyOf) return schema.anyOf.map((s: any) => inferTypeFromSchema(s)).join(' | ');
	if (schema.oneOf) return schema.oneOf.map((s: any) => inferTypeFromSchema(s)).join(' | ');
	if (schema.allOf) return schema.allOf.map((s: any) => inferTypeFromSchema(s)).join(' & ');

	return 'unknown';
}

async function main() {
	console.log('🔍 Extracting metadata using pure OSS approach...');

	const tsConfigPath = resolve(__dirname, '../tsconfig.json');

	const project = new Project({ tsConfigFilePath: tsConfigPath });
	project.addSourceFilesAtPaths('src/**/*.ts');
	const { apis, referencedTypes } = extractAPIMetadata(project);

	console.log(`✅ Found ${apis.length} runtime APIs`);
	for (const api of apis) {
		console.log(`  - ${api.name}: ${api.methods.length} methods`);
	}
	console.log(`📚 Found ${referencedTypes.size} referenced types`);

	const customTypes = Array.from(referencedTypes).filter((typeName) => {
		if (typeName.length === 1 && typeName === typeName.toUpperCase()) {
			return false;
		}
		return isCustomType(project, typeName);
	});

	console.log(
		`  Filtered to ${customTypes.length} custom types (from ${referencedTypes.size} total)`
	);

	const typeDefinitions: { name: string; definition: string }[] = [];

	for (const typeName of customTypes) {
		const schema = generateTypeSchema(tsConfigPath, typeName);

		if (schema) {
			const definition = jsonSchemaToTypeString(typeName, schema);
			typeDefinitions.push({ name: typeName, definition });
			console.log(`  ✓ ${typeName} (OSS)`);
		} else {
			// Fallback to ts-morph for types OSS can't handle (like generics)
			const fallbackDef = fallbackExtractType(project, typeName);
			if (fallbackDef) {
				typeDefinitions.push({ name: typeName, definition: fallbackDef });
				console.log(`  ✓ ${typeName} (ts-morph)`);
			} else {
				console.warn(`  ✗ ${typeName} - not found`);
			}
		}
	}

	console.log(
		`✅ Extracted ${typeDefinitions.length}/${customTypes.length} types (OSS + ts-morph fallback)`
	);

	const outputPath = resolve(__dirname, '../src/metadata/generated.ts');

	const apiNames = apis.map((api) => `'${api.name}'`).join(' | ');

	const content = `/**
 * AUTO-GENERATED - DO NOT EDIT
 * Generated by scripts/generate-metadata.ts
 * 
 * Hybrid approach:
 * - ts-json-schema-generator (OSS) for most types
 * - ts-morph fallback for types OSS can't handle (generics)
 */

import type { RuntimeAPIMetadata } from './types';

export const GENERATED_METADATA: RuntimeAPIMetadata[] = ${JSON.stringify(apis, null, 2)};

/**
 * Runtime API names - specific literal types for type-safe API filtering
 */
export type RuntimeAPIName = ${apiNames};

/**
 * Type definitions extracted using ts-json-schema-generator
 */
export const TYPE_REGISTRY = ${JSON.stringify(typeDefinitions, null, 2)};
`;

	writeFileSync(outputPath, content, 'utf-8');
	console.log(`📝 Metadata written to ${outputPath}`);
	console.log(
		`📊 Final: ${typeDefinitions.length} types, ${apis.reduce((acc, api) => acc + api.methods.length, 0)} methods`
	);
}

main().catch(console.error);
