import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: [
        'server/src/services/**',
        'server/src/routes/**',
      ],
      exclude: [
        'server/src/services/copilot.ts',  // external API calls
        'server/src/services/graph.ts',     // Outlook bridge COM
        'server/src/services/workiq.ts',    // external service
        'server/src/services/file-scanner.ts', // PowerShell/COM
        'server/src/services/notification-sse.ts',
        'server/src/services/reminder-scheduler.ts',
      ],
    },
  },
});
