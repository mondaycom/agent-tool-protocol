/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>'],
	testMatch: [
		'**/__tests__/**/*.test.ts',
		'!**/packages/protocol/__tests__/**',
		'!**/packages/providers/__tests__/**',
		'!**/packages/server/__tests__/search-scope-filtering.test.ts',
		'!**/packages/server/__tests__/openapi-scope-extraction.test.ts',
		'!**/packages/atp-compiler/__tests__/**',
	],
	testPathIgnorePatterns: ['/node_modules/', '/dist/'],
	setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
	collectCoverageFrom: [
		'packages/*/src/**/*.ts',
		'!packages/*/src/**/*.d.ts',
		'!packages/*/src/index.ts',
	],
	moduleNameMapper: {
		'^nanoid$': '<rootDir>/__mocks__/nanoid.js',
		'^zod-to-json-schema$': '<rootDir>/__mocks__/zod-to-json-schema/index.js',
		'^@mondaydotcomorg/atp-protocol$': '<rootDir>/packages/protocol/src/index.ts',
		'^@mondaydotcomorg/atp-runtime$': '<rootDir>/packages/runtime/src/index.ts',
		'^@mondaydotcomorg/atp-provenance$': '<rootDir>/packages/provenance/src/index.ts',
		'^@mondaydotcomorg/atp-compiler$': '<rootDir>/packages/atp-compiler/src/index.ts',
		'^@mondaydotcomorg/atp-server$': '<rootDir>/packages/server/src/index.ts',
		'^@mondaydotcomorg/atp-server/(.*)$': '<rootDir>/packages/server/$1',
		'^@mondaydotcomorg/atp-client$': '<rootDir>/packages/client/src/index.ts',
		'^@mondaydotcomorg/atp-mcp-adapter$': '<rootDir>/packages/mcp-adapter/src/index.ts',
		'^@mondaydotcomorg/atp-langchain$': '<rootDir>/packages/langchain/src/index.ts',
		'^@mondaydotcomorg/atp-providers$': '<rootDir>/packages/providers/src/index.ts',
		// Force @babel/traverse to use compiled lib/index.js
		'^@babel/traverse$': '@babel/traverse/lib/index.js',
	},
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				tsconfig: {
					esModuleInterop: true,
					allowSyntheticDefaultImports: true,
					strict: false,
				},
				useESM: false,
			},
		],
	},
	testTimeout: 30000,
	verbose: true,
	extensionsToTreatAsEsm: [],
	resolver: '<rootDir>/jest-resolver.js',
	transformIgnorePatterns: [
		// Ignore all node_modules EXCEPT nanoid
		'node_modules/(?!(nanoid)/).*',
		// ALWAYS ignore @babel - use their compiled lib files
		'node_modules/@babel/.*',
	],
};
