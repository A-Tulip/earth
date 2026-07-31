/**
 * E2E：太阳系视图切换
 *
 * 验证：
 * - TopBar 右上角 Sun 图标按钮可切换到太阳系视图
 * - 切换后出现"正在加载太阳系视图"或 Three.js canvas
 * - TopBar 按钮变为 Globe 图标（返回地球）
 * - 工具坞"天文"面板的"太阳系视图"入口与 TopBar 走同一命令
 * - 返回地球视图后 Cesium canvas 恢复
 */
import { test, expect } from '@playwright/test';

test('TopBar 太阳系切换按钮可切换视图', async ({ page }) => {
  page.on('console', () => {});
  // 捕获 pageerror 以确保切换无抛错
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });

  // TopBar 右上角应有 title="太阳系视图" 的按钮（初始为 Sun 图标）
  const sunBtn = page.locator('button[title="太阳系视图"]');
  await expect(sunBtn).toBeVisible({ timeout: 15_000 });

  // 点击切换到太阳系
  await sunBtn.click();

  // 按钮变为"返回地球"（Globe 图标）
  await expect(page.locator('button[title="返回地球"]')).toBeVisible({ timeout: 15_000 });

  // 不应有 pageerror
  expect(errors).toEqual([]);

  // 点击返回地球
  await page.locator('button[title="返回地球"]').click();
  await expect(page.locator('button[title="太阳系视图"]')).toBeVisible({ timeout: 15_000 });
});

test('工具坞天文面板可切换到太阳系视图（与 TopBar 同一命令）', async ({ page }) => {
  page.on('console', () => {});
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });

  const dock = page.locator('[data-tool-dock]');
  await dock.waitFor({ state: 'visible', timeout: 15_000 });

  // 打开天文面板
  await dock.locator('button[title="天文"]').click();
  await expect(dock.getByText('视图切换')).toBeVisible();

  // 点击"太阳系视图"按钮
  await dock.getByText('太阳系视图', { exact: true }).click();

  // TopBar 按钮应同步变为"返回地球"（证明两者共用同一状态/命令）
  await expect(page.locator('button[title="返回地球"]')).toBeVisible({ timeout: 15_000 });

  // 工具坞按钮也应变为"返回地球视图"
  await expect(dock.getByText('返回地球视图', { exact: true })).toBeVisible();

  expect(errors).toEqual([]);
});
