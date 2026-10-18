import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// @orca/protocol ships TypeScript source, so it is bundled, never externalized.
const bundleProtocol = { exclude: ['@orca/protocol'] };

export default defineConfig({
  main: {
    build: { externalizeDeps: bundleProtocol },
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: {
      externalizeDeps: bundleProtocol,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
