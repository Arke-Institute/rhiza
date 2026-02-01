import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Include patterns
    include: ['src/__tests__/**/*.test.ts'],

    // Exclude patterns
    exclude: ['node_modules', 'dist'],

    // Global test timeout (ms)
    testTimeout: 10000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/types/**',
        'src/index.ts',
      ],
    },

    // Reporter configuration
    reporters: ['verbose'],

    // Globals (describe, it, expect, etc.)
    globals: true,

    // Type checking
    typecheck: {
      enabled: true,
    },
  },

  // Path resolution
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
