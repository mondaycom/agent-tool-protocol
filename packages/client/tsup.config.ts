import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts', 'src/core/index.ts'],
	format: ['esm', 'cjs'],
	dts: false,
	sourcemap: true,
	clean: false,
	splitting: false,
	treeshake: true,
	external: [
		'zod',
		'@mondaydotcomorg/atp-protocol',
		'@mondaydotcomorg/atp-runtime',
	],
});
