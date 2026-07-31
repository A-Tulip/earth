import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置
 *
 * 关键路径测试：页面打开、地球加载、工具坞收放、二维三维切换、等高线、课程打开。
 * 运行：npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Cesium 单页应用，串行更稳
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // 视口设置足够大，避免工具坞被响应式收起
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 自动启动 dev server
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
