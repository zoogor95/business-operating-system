import { defineConfig } from 'tsup';

// Dual ESM + CJS output: the NestJS API consumes CommonJS,
// the Vite apps consume ESM. Both get type declarations.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
