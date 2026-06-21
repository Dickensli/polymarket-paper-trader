import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    sequence: {
      concurrent: false,
    },
    env: {},
    // Load .env.local automatically for DATABASE_URL etc.
    setupFiles: ['./__tests__/setup.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/auth.ts', 'src/lib/auth-provider.tsx', 'src/lib/query-provider.tsx'],
    },
    // Separate test pools for different layers
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
