import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import type { StageTemplate } from './src/levels/stages';
import { checkRoom, checkRun, roomFile } from './src/levels/validate';

const ROOMS_DIR = 'src/levels/rooms';

/** Room files aren't type-checked, so a build checks them instead. */
function checkRoomFiles(): Plugin {
  return {
    name: 'check-room-files',
    apply: 'build',
    buildStart() {
      const files = readdirSync(ROOMS_DIR);
      const rooms = files.map((file) => JSON.parse(readFileSync(`${ROOMS_DIR}/${file}`, 'utf8')) as StageTemplate);
      const errors = [
        ...rooms.flatMap((room, i) => [
          ...checkRoom(room).filter((p) => p.level === 'error').map((p) => `${room.name}: ${p.message}`),
          ...(files[i] === roomFile(room.name) ? [] : [`${room.name}: should be in ${roomFile(room.name)}, is in ${files[i]}.`]),
        ]),
        ...checkRun(rooms).filter((p) => p.level === 'error').map((p) => p.message),
      ];
      if (errors.length > 0) this.error(`Bad room files:\n${errors.join('\n')}`);
    },
  };
}

// Relative base so the same build works on GitHub Pages (/vectranox/) and at a VPS root.
export default defineConfig({
  base: './',
  plugins: [checkRoomFiles()],
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
