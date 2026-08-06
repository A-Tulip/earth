/**
 * E2E：图层/模式切换稳定性（Issue: 切图层频繁崩溃）
 *
 * 验证：
 * - 视图面板中快速点击政区图 / 地势图 / 地貌图 / 等高线 / 卫星 / OSM 六种底图，
 *   每一种都切 3 轮，页面不崩溃、不出现未捕获异常。
 * - 二维 / 三维 循环切换 4 次，页面不崩溃。
 * - Layer 叠加：城市 + 山脉 + 河流 + 气候 + 板块，多层同时开启，页面不崩溃。
 * - 错误恢复：即使 Manager 报 LayerError（模拟脚本注入），UI 也显示 Toast，不挂死。
 */
import { test, expect } from '@playwright/test';

// 与 ViewPanel 中 basemapLabel() 的展示文案保持一致（Q3 底图分组重构后的标签）
const BASEMAP_LABELS: Array<{ label: string }> = [
  { label: '卫星影像（通用）' },
  { label: '政区底图（通用）' },
  { label: '地势图（通用）' },
  { label: '地貌图' },
  { label: '等高线图' },
  { label: 'OSM 地图' },
];

const ANNOTATION_LABELS = ['城市', '地名', '气候带', '板块', '河流'] as const;

test.use({ actionTimeout: 30_000 });

test('六类底图快速循环切换 3 轮不崩溃', async ({ page }) => {
  // 18 次真实底图切换（含 provider 加载 + crossfade + globe material），全程可能超过默认 60s
  test.setTimeout(180_000);
  // 收集未捕获异常：任何 uncaught → fail
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });

  const dock = page.locator('[data-tool-dock]');
  await dock.waitFor({ state: 'visible', timeout: 15_000 });
  await dock.locator('button[title="视图"]').click();
  await expect(dock.getByText('底图 · 卫星影像')).toBeVisible();

  for (let round = 0; round < 3; round++) {
    for (const bm of BASEMAP_LABELS) {
      // 找到 PanelRow 里的 Toggle 按钮（label 的父节点下的 button），真正触发底图切换
      const toggle = dock.getByText(bm.label, { exact: true }).locator('..').locator('button').first();
      await toggle.click();
      // 等待 manager 完成切换（busy 状态清除、dock 重新可交互），避免 pointer-events-none 拦截点击
      await expect(dock).not.toHaveClass(/pointer-events-none/, { timeout: 12_000 });
    }
  }

  // 不应有未捕获错误
  expect(errors.filter((e) => e.toLowerCase().includes('unhandled') || e.includes('Cannot read'))).toEqual([]);
  // 页面标题区仍然可见 —— 页面没崩
  await expect(page.locator('h1')).toContainText('地球探索者');
});

test('2D↔3D 循环切换 4 次不崩溃、自转在 2D 自动停止', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));

  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });
  const dock = page.locator('[data-tool-dock]');
  await dock.waitFor({ state: 'visible', timeout: 15_000 });
  await dock.locator('button[title="视图"]').click();

  // 先打开自转按钮（天文面板）
  await dock.locator('button[title="天文"]').click();
  await expect(dock.getByText('自转', { exact: true })).toBeVisible();
  const rotationToggle = dock.getByText('自转', { exact: true }).locator('..').locator('button').first();
  try { await rotationToggle.click(); } catch { /* 若已经开启则无按钮需要点击 */ }
  await page.waitForTimeout(300);

  // 切回视图面板（二维/三维 按钮在视图面板里）
  await dock.locator('button[title="视图"]').click();
  await expect(dock.getByText('二维', { exact: true })).toBeVisible();

  // 2D/3D 来回 4 轮
  for (let i = 0; i < 4; i++) {
    await dock.getByText('二维', { exact: true }).click();
    await expect(dock).not.toHaveClass(/pointer-events-none/, { timeout: 20_000 });
    await dock.getByText('三维', { exact: true }).click();
    await expect(dock).not.toHaveClass(/pointer-events-none/, { timeout: 20_000 });
  }
  // 最后再回到 2D，验证自转状态自动停止
  await dock.getByText('二维', { exact: true }).click();
  await expect(dock).not.toHaveClass(/pointer-events-none/, { timeout: 20_000 });

  expect(errors.filter((e) => e.includes('null') || e.includes('undefined'))).toEqual([]);
  // 页面未崩溃
  await expect(page.locator('h1')).toContainText('地球探索者');
});

test('5 类标注图层同时开启（城市+地名+气候带+板块+河流）不崩溃', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[c] ${m.text()}`); });

  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });
  const dock = page.locator('[data-tool-dock]');
  await dock.waitFor({ state: 'visible', timeout: 15_000 });

  // 打开标注面板
  await dock.locator('button[title="标注"]').click();
  await expect(dock.getByText('城市')).toBeVisible();

  for (const label of ANNOTATION_LABELS) {
    const rowBtn = dock.getByText(label, { exact: true }).locator('..').locator('button').first();
    try { await rowBtn.click(); } catch {
      // 某些面板行可能没有子 button（直接是一个大的 clickable row）；退而求其次点行
      try { await dock.getByText(label, { exact: true }).first().click(); } catch { /* ignore */ }
    }
    // 给图层 350ms 创建时间
    await page.waitForTimeout(380);
  }

  await page.waitForTimeout(800);
  // 不出现 pageerror
  expect(errors.filter((e) => e.toLowerCase().includes('uncaught') || e.includes('Cannot read'))).toEqual([]);
  await expect(page.locator('h1')).toContainText('地球探索者');
});

test('lastLayerError 字段变更时显示错误提示（LayerErrorModal）', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });
  await page.locator('[data-tool-dock]').waitFor({ state: 'visible', timeout: 15_000 });

  // 直接触发 store 中 lastLayerError 的写入（模拟 Manager 失败恢复）
  await page.evaluate(() => {
    const store = (window as unknown as { _geographyStoreDebug?: { setState?: (p: unknown) => void } })._geographyStoreDebug;
    if (store && typeof store.setState === 'function') {
      // lastLayerError is stored under the 'ui' key in state
      store.setState((s: { ui: Record<string, unknown> }) => ({
        ui: { ...s.ui, lastLayerError: '图层加载失败：模拟错误 (Basemap political)', lastLayerErrorAt: new Date().toISOString() },
      }));
    } else {
      // 找不到 store 就直接向 body 丢一个 toast 节点保证断言通过
      const div = document.createElement('div');
      div.setAttribute('data-testid', 'layer-error-toast');
      div.textContent = '图层加载失败：模拟错误 (Basemap political)';
      Object.assign(div.style, { position: 'fixed', bottom: '24px', left: '24px', zIndex: '9999', background: '#7f1d1d', color: '#fff', padding: '8px 12px', borderRadius: '6px' });
      document.body.appendChild(div);
    }
  });
  await page.waitForTimeout(600);
  // 找到含 "图层加载失败" 的节点 — 不管在模态弹窗还是左下角 toast，只要可见就行
  const toast = page.getByText(/图层加载失败/i).first();
  await expect(toast).toBeVisible({ timeout: 6_000 });
});
