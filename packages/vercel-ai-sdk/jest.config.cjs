/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>'],
	testMatch: ['**/__tests__/**/*.test.ts'],
	testPathIgnorePatterns: ['/node_modules/', '/dist/'],
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
		'^@mondaydotcomorg/atp-protocol$': '<rootDir>/../protocol/src/index.ts',
		'^@mondaydotcomorg/atp-runtime$': '<rootDir>/../runtime/src/index.ts',
		'^@mondaydotcomorg/atp-provenance$': '<rootDir>/../provenance/src/index.ts',
		'^@mondaydotcomorg/atp-compiler$': '<rootDir>/../atp-compiler/src/index.ts',
		'^@mondaydotcomorg/atp-server$': '<rootDir>/../server/src/index.ts',
		'^@mondaydotcomorg/atp-client$': '<rootDir>/../client/src/index.ts',
		'^@mondaydotcomorg/atp-providers$': '<rootDir>/../providers/src/index.ts',
		'^nanoid$': '<rootDir>/../../__mocks__/nanoid.js',
		'^zod-to-json-schema$': '<rootDir>/../../__mocks__/zod-to-json-schema/index.js',
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
	transformIgnorePatterns: [
		// Transform nanoid since it's ESM only
		'node_modules/(?!(nanoid)/)',
	],
	testTimeout: 30000,
	verbose: true,
	extensionsToTreatAsEsm: [],
};

