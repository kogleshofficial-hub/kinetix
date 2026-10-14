import { defineConfig } from 'vite';

// Production JS is minified with no source maps. Keep MediaPipe in a separate
// vendor chunk so only Kinetix-authored game logic is obfuscated below.
export default defineConfig({
  build: {
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
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
