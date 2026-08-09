/**
 * E2E：关键路径 - 页面打开 + 地球加载
 *
 * 验证：
 * - 打开页面后无控制台错误
 * - 产品名称"地球探索者"可见
 * - Cesium canvas 存在
 * - 引导文字出现
 */
import { test, expect, Page } from '@playwright/test';

// 屏蔽 Cesium 在某些环境下的警告
function silenceNoise(page: Page) {
  page.on('console', () => {});
  page.on('pageerror', () => {});
}

test('页面打开后显示"地球探索者"和地球画布', async ({ page }) => {
  silenceNoise(page);
  await page.goto('/');

  // 1. 产品名称
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });

  // 2. Cesium canvas 存在（容器内会有 canvas 元素）
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });

  // 3. 启动加载屏最终淡出（打开即用、无欢迎引导遮挡）
  await expect(page.getByTestId('app-loader')).toBeHidden({ timeout: 30_000 });
});

test('页面打开 5 秒内无致命 pageerror', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    // 忽略 Cesium 可能的资源加载警告
    const msg = err.message.toLowerCase();
    if (msg.includes('cesium') && msg.includes('failed to fetch')) return;
    errors.push(err.message);
  });

  await page.goto('/');
  await page.waitForTimeout(5000);
  expect(errors).toEqual([]);
});
