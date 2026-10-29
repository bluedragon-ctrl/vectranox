import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages (/vectranox/) and at a VPS root.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // three.js alone is ~550 kB; keep it in its own long-cached chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
