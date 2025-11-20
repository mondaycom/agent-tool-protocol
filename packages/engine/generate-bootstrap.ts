#!/usr/bin/env tsx
/**
 * Bootstrap Code Generator
 *
 * Generates the isolated-vm bootstrap code by analyzing the executor's createSandbox method
 * This ensures the bootstrap is always in sync with what's actually exposed
 */

import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Project, SyntaxKind } from 'ts-morph';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface RuntimeAPIParam {
	name: string;
	type: string;
	description: string;
	optional: boolean;
}

interface BootstrapMethod {
	name: string;
	params: RuntimeAPIParam[];
	isAsync: boolean;
	isVoid: boolean;
}

interface BootstrapAPI {
	name: string;
	methods: BootstrapMethod[];
}

/**
 * Generate parameter list for method call
 */
function generateParamList(params: RuntimeAPIParam[]): string {
	return params.map((p) => p.name).join(', ');
}

/**
 * Generate bootstrap code for a single method
 */
function generateMethodCode(apiName: string, method: BootstrapMethod, indent: string): string {
	const paramNames = generateParamList(method.params);
	const paramList = method.params.length > 0 ? `, [${paramNames}]` : '';
	const refName = `__atp_${apiName}_${method.name}`;

	if (method.isAsync) {
		// Async methods use .apply with promise result
		return `${indent}${method.name}: async (${paramNames}) => {
${indent}	return await ${refName}.apply(undefined${paramList}, { arguments: { copy: true }, result: { promise: true } });
${indent}}`;
	} else if (method.isVoid) {
		// Void sync methods use .applyIgnored (fire and forget)
		return `${indent}${method.name}: (${paramNames}) => {
${indent}	${refName}.applyIgnored(undefined${paramList}, { arguments: { copy: true } });
${indent}}`;
	} else {
		// Sync methods with return value use .applySync
		return `${indent}${method.name}: (${paramNames}) => {
${indent}	return ${refName}.applySync(undefined${paramList}, { arguments: { copy: true }, result: { copy: true } });
${indent}}`;
	}
}

/**
 * Generate complete bootstrap code
 */
function generateBootstrapCode(apis: BootstrapAPI[]): string {
	const indent = '\t\t\t\t';
	let code = `globalThis.atp = {\n`;

	// Generate ALL API namespaces from parsed executor code
	for (let i = 0; i < apis.length; i++) {
		const api = apis[i];
		if (!api) continue;

		code += `${indent}${api.name}: {\n`;

		for (let j = 0; j < api.methods.length; j++) {
			const method = api.methods[j];
			if (!method) continue;

			code += generateMethodCode(api.name, method, indent + '\t');
			if (j < api.methods.length - 1) {
				code += ',';
			}
			code += '\n';
		}

		code += `${indent}}`;
		if (i < apis.length - 1) {
			code += ',';
		}
		code += '\n';
	}

	code += `${indent}};`;

	return code;
}

/**
 * Generate list of Reference names that need to be injected
 */
function generateReferenceList(apis: BootstrapAPI[]): string[] {
	const refs: string[] = [];

	for (const api of apis) {
		for (const method of api.methods) {
			refs.push(`__atp_${api.name}_${method.name}`);
		}
	}

	return refs.sort();
}

/**
 * Parse the executor file to extract what's actually exposed in createSandbox
 */
function parseExecutorSandbox(): BootstrapAPI[] {
	const project = new Project();
	const executorPath = resolve(__dirname, '../src/executor/index.ts');
	const sourceFile = project.addSourceFileAtPath(executorPath);

	const apis: BootstrapAPI[] = [];

	// Find the createSandbox method
	const sandboxExecutorClass = sourceFile.getClass('SandboxExecutor');
	if (!sandboxExecutorClass) {
		throw new Error('Could not find SandboxExecutor class');
	}

	const createSandboxMethod = sandboxExecutorClass.getMethod('createSandbox');
	if (!createSandboxMethod) {
		throw new Error('Could not find createSandbox method');
	}

	// Find the 'const sandbox =' variable declaration
	const variableStatements = createSandboxMethod.getDescendantsOfKind(SyntaxKind.VariableStatement);
	let sandboxObject: any = null;

	for (const varStatement of variableStatements) {
		const declarations = varStatement.getDeclarations();
		for (const decl of declarations) {
			if (decl.getName() === 'sandbox') {
				const initializer = decl.getInitializer();
				if (initializer && initializer.isKind(SyntaxKind.ObjectLiteralExpression)) {
					sandboxObject = initializer.asKind(SyntaxKind.ObjectLiteralExpression);
					break;
				}
			}
		}
		if (sandboxObject) break;
	}

	if (!sandboxObject) {
		throw new Error('Could not find sandbox object initialization');
	}

	// Parse the sandbox object
	{
		for (const prop of sandboxObject.getProperties()) {
			if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;

			const propName = prop.getName();

			// Only process 'atp' namespace
			if (propName !== 'atp') continue;

			const initializer = prop.getInitializer();
			if (!initializer || !initializer.isKind(SyntaxKind.ObjectLiteralExpression)) continue;

			// Parse atp sub-APIs
			const atpObject = initializer.asKind(SyntaxKind.ObjectLiteralExpression);
			if (!atpObject) continue;

			for (const atpProp of atpObject.getProperties()) {
				if (!atpProp.isKind(SyntaxKind.PropertyAssignment)) continue;

				const apiName = atpProp.getName();
				const apiInitializer = atpProp.getInitializer();

				if (!apiInitializer || !apiInitializer.isKind(SyntaxKind.ObjectLiteralExpression)) continue;

				const apiObject = apiInitializer.asKind(SyntaxKind.ObjectLiteralExpression);
				if (!apiObject) continue;

				const methods: BootstrapMethod[] = [];

				// Parse methods in each API
				for (const methodProp of apiObject.getProperties()) {
					if (!methodProp.isKind(SyntaxKind.PropertyAssignment)) continue;

					const methodName = methodProp.getName();
					const methodInit = methodProp.getInitializer();

					// Determine if async and void
					let isAsync = false;
					let isVoid = false;
					const params: RuntimeAPIParam[] = [];

					if (methodInit?.isKind(SyntaxKind.ArrowFunction)) {
						const arrowFunc = methodInit.asKind(SyntaxKind.ArrowFunction);
						if (arrowFunc) {
							isAsync = arrowFunc.isAsync();

							// Get parameters
							for (const param of arrowFunc.getParameters()) {
								params.push({
									name: param.getName(),
									type: param.getType().getText(),
									description: '',
									optional: param.isOptional(),
								});
							}

							// Check if void (no return or returns nothing)
							const body = arrowFunc.getBody();
							if (body.isKind(SyntaxKind.Block)) {
								const returnStatements = body.getDescendantsOfKind(SyntaxKind.ReturnStatement);
								isVoid =
									returnStatements.length === 0 ||
									returnStatements.every((r: any) => !r.getExpression());
							}
						}
					}

					if (methodInit) {
						methods.push({
							name: methodName,
							params,
							isAsync,
							isVoid,
						});
					}
				}

				apis.push({
					name: apiName,
					methods,
				});
			}
		}
	}

	return apis;
}

async function main() {
	console.log('🔧 Analyzing executor to generate bootstrap code...');

	// Parse what's actually exposed in createSandbox
	const bootstrapAPIs = parseExecutorSandbox();

	console.log(`✅ Found ${bootstrapAPIs.length} ATP APIs`);
	for (const api of bootstrapAPIs) {
		console.log(`  - ${api.name}: ${api.methods.length} methods`);
	}
	console.log(
		`📋 Total: ${bootstrapAPIs.reduce((sum, api) => sum + api.methods.length, 0)} methods`
	);

	// Generate bootstrap code
	const bootstrapCode = generateBootstrapCode(bootstrapAPIs);

	// Generate reference list for documentation
	const refList = generateReferenceList(bootstrapAPIs);
	console.log(`📋 Generated ${refList.length} isolated-vm References`);

	// Generate TypeScript file
	const outputPath = resolve(__dirname, '../src/executor/bootstrap-generated.ts');
	const content = `/**
 * AUTO-GENERATED - DO NOT EDIT
 * Generated by scripts/generate-bootstrap.ts
 * 
 * This file contains the bootstrap code injected into the isolated-vm sandbox
 * It's generated from runtime API metadata to ensure it stays in sync
 */

/**
 * Bootstrap code for isolated-vm context
 * Creates the globalThis.atp object with all runtime APIs
 * 
 * Each method is a wrapper that calls the corresponding isolated-vm Reference
 * The References must be set using context.global.set() before evaluating this code
 * 
 * Required References (${refList.length} total):
${refList.map((ref) => ` * - ${ref}`).join('\n')}
 */
export const BOOTSTRAP_CODE = \`
			${bootstrapCode}
\`;

/**
 * List of all isolated-vm Reference names that must be injected
 */
export const REQUIRED_REFERENCES = ${JSON.stringify(refList, null, '\t')};
`;

	writeFileSync(outputPath, content, 'utf-8');
	console.log(`📝 Bootstrap code written to ${outputPath}`);
	console.log(`✨ Complete! Bootstrap code is now auto-generated from metadata`);
}

main().catch(console.error);
