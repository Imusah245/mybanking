import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite + React configuration with an embedded Vitest test block.
// The test block uses jsdom so React components can render in Node,
// and loads src/test/setup.js (jest-dom matchers) before each test file.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
});
