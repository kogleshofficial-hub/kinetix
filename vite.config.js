import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Both pages are static. Only the main game imports MediaPipe; the Creator
// Studio is a local editor that does not request camera access.
export default defineConfig({
  build: {
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        creator: resolve(root, 'creator.html')
      },
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/');
          if (normalizedId.includes('/node_modules/@mediapipe/tasks-vision/')) {
            return 'mediapipe-vendor';
          }
        }
      }
    }
  }
});
