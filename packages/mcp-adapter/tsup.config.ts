import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: false, // Use tsc for declarations due to project references
	sourcemap: true,
	clean: false,
	splitting: false,
	treeshake: true,
	external: [
		'zod',
		'@mondaydotcomorg/atp-protocol',
		'@mondaydotcomorg/atp-server',
		'@modelcontextprotocol/sdk',
		'@modelcontextprotocol/sdk/client/index.js',
		'@modelcontextprotocol/sdk/client/stdio.js',
		'@modelcontextprotocol/sdk/client/sse.js',
	],
});
