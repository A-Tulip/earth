/**
 * E2E：工具坞收放
 *
 * 验证：
 * - 工具坞默认可见，包含"视图/标注/天文/数据/测量"入口
 * - 点击折叠按钮后工具坞收起为单个按钮
 * - 点击展开按钮恢复
 * - Esc 收起展开的面板
 */
import { test, expect } from '@playwright/test';

test('工具坞收起与展开', async ({ page }) => {
  page.on('console', () => {});
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });

  // 工具坞存在（含 data-tool-dock 属性）
  const dock = page.locator('[data-tool-dock]');
  await expect(dock).toBeVisible({ timeout: 15_000 });

  // 默认应能看到至少 5 个工具入口按钮
  const toolButtons = dock.locator('button[title]');
  await expect(toolButtons.first()).toBeVisible();
  expect(await toolButtons.count()).toBeGreaterThanOrEqual(5);

  // 点击折叠按钮（标题为"折叠工具坞"）
  await dock.locator('button[title="折叠工具坞"]').click();
  // 折叠后变成单个圆形按钮，title 为"展开工具坞"
  await expect(page.locator('button[title="展开工具坞"]')).toBeVisible();

  // 再次点击展开
  await page.locator('button[title="展开工具坞"]').click();
  await expect(page.locator('[data-tool-dock]')).toBeVisible();
});

test('点击"视图"展开面板，按 Esc 收起', async ({ page }) => {
  page.on('console', () => {});
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });

  const dock = page.locator('[data-tool-dock]');
  await expect(dock).toBeVisible({ timeout: 15_000 });

  // 点击"视图"入口
  await dock.locator('button[title="视图"]').click();

  // 展开后应出现"视图模式"标题
  await expect(dock.getByText('视图模式')).toBeVisible();

  // 按 Esc
  await page.keyboard.press('Escape');

  // 面板收起，"视图模式"标题消失
  await expect(dock.getByText('视图模式')).toHaveCount(0);
});
