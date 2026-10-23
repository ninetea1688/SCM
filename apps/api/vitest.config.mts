import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so NestJS decorator metadata (DI) works under Vitest.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    env: { LOG_LEVEL: 'error', NODE_ENV: 'test', QUEUE_PREFIX: 'scm-test' },
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
