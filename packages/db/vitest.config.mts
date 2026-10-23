import { defineConfig } from 'vitest/config';

// Integration tests need the dev Postgres from docker-compose.yml (pnpm dev:infra).
export default defineConfig({ test: { include: ['src/**/*.test.ts'], testTimeout: 20_000 } });
