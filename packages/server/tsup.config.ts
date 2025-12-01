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
		'@mondaydotcomorg/atp-protocol',
		'@mondaydotcomorg/atp-provenance',
		'@mondaydotcomorg/atp-providers',
		'@mondaydotcomorg/atp-runtime',
		'@mondaydotcomorg/atp-compiler',
		'isolated-vm',
	],
});
