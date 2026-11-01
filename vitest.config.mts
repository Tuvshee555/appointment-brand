import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
      // `server-only` throws outside the React server runtime; tests call services directly.
      'server-only': r('./tests/stubs/server-only.ts'),
    },
  },
  test: {
    env: { TZ: 'UTC' },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/global-setup.ts'],
          // Each file gets its own database cloned from a template; running files one
          // at a time keeps the embedded server's memory use small.
          fileParallelism: false,
          // Demo mode: notifications are only logged and QPay is the labelled simulation.
          env: {
            TZ: 'UTC',
            DEMO_MODE: 'true',
            QPAY_MODE: 'mock',
            SESSION_SECRET: 'integration-test-secret-0123456789',
          },
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
})
