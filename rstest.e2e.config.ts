import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['tests/e2e/**/*.test.ts'],
  testEnvironment: 'node',
  testTimeout: 30_000,
  hookTimeout: 60_000,
  pool: { maxWorkers: 1 },
});
