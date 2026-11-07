import { defineConfig } from 'vitest/config'

// Timing budgets need a quiet CPU, especially on two-core CI runners. Run the existing
// performance suites after the parallel correctness suites, one file at a time.
const performance = [
  'src/office/sheets/formula/perf.test.ts',
  'src/office/sheets/numfmt/format.test.ts',
  'src/office/presentation/performance.test.ts',
  'src/office/sheets/view/clipboard.perf.test.ts',
]
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', exclude: ['**/node_modules/**', '**/dist/**', ...performance], sequence: { groupOrder: 0 } } },
      { test: { name: 'performance', include: performance, fileParallelism: false, maxWorkers: 1, sequence: { groupOrder: 1 } } },
    ],
  },
})
