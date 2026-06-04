import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/Puzzle_Tower/' : '/',
  plugins: [react()],
  server: {
    port: 5173
  }
});
