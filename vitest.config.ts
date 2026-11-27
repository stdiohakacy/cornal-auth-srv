import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  // `source` makes package.json `#src/*` imports resolve to the TypeScript sources.
  resolve: { tsconfigPaths: true, conditions: ['source'] },
  // Tests run in Vite's SSR (node) environment, which has its own condition list.
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    globals: true,
    root: './',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.int-spec.ts'],
          globalSetup: ['test/integration/support/global-setup.ts'],
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e-spec.ts'],
          globalSetup: ['test/integration/support/global-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
