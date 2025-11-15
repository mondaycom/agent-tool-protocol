import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
	// Ignore patterns (similar to old .eslintrc.js ignorePatterns)
	{
		ignores: [
			'**/dist/**',
			'**/node_modules/**',
			'**/coverage/**',
			'**/build/**',
			'**/.next/**',
			'*.js',
			'*.mjs',
			'*.cjs',
			'jest.config.js',
			'jest-resolver.js',
			'jest.e2e.config.ts',
		],
	},

	// Base TS recommended rules
	...tseslint.configs.recommended,

	// Global settings and rules
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		plugins: {
			import: importPlugin,
		},
		settings: {
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
					project: ['./tsconfig.json', './packages/*/tsconfig.json'],
				},
				node: {
					extensions: ['.ts', '.tsx', '.js', '.jsx'],
				},
			},
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/no-empty-function': 'warn',
			'no-console': 'off',

			// STRICT: Error on extraneous dependencies
			'import/no-extraneous-dependencies': [
				'error',
				{
					devDependencies: [
						'**/*.test.{ts,tsx,js,jsx}',
						'**/*.spec.{ts,tsx,js,jsx}',
						'**/__tests__/**',
						'**/test/**',
						'**/*.config.{ts,js,cjs,mjs}',
						'**/vite.config.{ts,js,mjs,cjs}',
						'**/jest.setup.{ts,js}',
						'**/scripts/**',
					],
					optionalDependencies: false,
					peerDependencies: false,
					includeTypes: true,
					// Monorepo support: check dependencies in both root and package-level
					packageDir: [
						'.',
						'packages/atp-compiler',
						'packages/client',
						'packages/langchain',
						'packages/mcp-adapter',
						'packages/protocol',
						'packages/provenance',
						'packages/providers',
						'packages/runtime',
						'packages/server',
					],
				},
			],
		},
	}
);
