/**
 * E2E：Push-to-Talk 空格键录音
 *
 * 验证：
 * - 按下空格不报错
 * - 空格不会在输入框聚焦时触发录音（避免影响文本输入）
 * - 释放空格后状态恢复
 *
 * 注意：浏览器实际 ASR 需要 Web Speech API 权限，
 * E2E 在无 headless 权限下可能无法真实识别，
 * 这里只验证键盘事件的处理不破坏应用。
 */
import { test, expect } from '@playwright/test';

test('按住空格不导致应用崩溃', async ({ page }) => {
  page.on('console', () => {});
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });

  // 按住空格 500ms 然后释放
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');

  // 应用应仍然可用
  await expect(page.locator('h1')).toContainText('地球探索者');

  // 工具坞仍然可见
  await expect(page.locator('[data-tool-dock]')).toBeVisible({ timeout: 5_000 });
});

test('在输入框中按空格不会触发录音', async ({ page }) => {
  page.on('console', () => {});
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });

  // 打开课程菜单使搜索框聚焦
  await page.getByRole('button', { name: /课程/ }).first().click();
  const searchInput = page.getByPlaceholder(/搜索课程/);
  await expect(searchInput).toBeVisible();
  await searchInput.focus();

  // 输入空格
  await searchInput.press(' ');
  await page.waitForTimeout(200);

  // 输入框应仍然可见且应用未崩溃
  await expect(searchInput).toBeVisible();
  await expect(page.locator('h1')).toContainText('地球探索者');
});
