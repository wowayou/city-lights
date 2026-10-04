import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { host: true },
  preview: { host: true },
  build: { target: 'es2020' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
