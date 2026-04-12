import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5179',
    headless: true,
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: [
    {
      command: 'npx tsx server/src/index.ts',
      port: 3001,
      reuseExistingServer: true,
      timeout: 15000,
    },
    {
      command: 'npx vite --port 5179',
      port: 5179,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
});
