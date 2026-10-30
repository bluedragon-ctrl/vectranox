import { defineConfig } from 'vite';
import { roomsApi } from './api';

// Run from the repo root, so the game is served next to the editor and Play can open it.
export default defineConfig({
  plugins: [roomsApi()],
  // Its own cache, so it can run next to `npm run dev`.
  cacheDir: 'node_modules/.vite-editor',
  server: {
    port: 5174,
    strictPort: true,
    open: '/editor/',
  },
});
