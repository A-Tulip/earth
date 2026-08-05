import { test, expect } from '@playwright/test';

test('diag: pinpoint topmost element at landform button', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('地球探索者', { timeout: 20_000 });
  const dock = page.locator('[data-tool-dock]');
  await dock.waitFor({ state: 'visible', timeout: 15_000 });
  await dock.locator('button[title="视图"]').click();
  await expect(dock.getByText('底图 · 卫星影像')).toBeVisible();

  const info = await page.evaluate(() => {
    const landformBtn = document.querySelector('[data-agent-button="view.basemap.landform"]') as HTMLElement;
    if (!landformBtn) return { err: 'no landform btn' };
    const r = landformBtn.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    const cs = (el: Element | null) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '', z: s.zIndex, pos: s.position, pe: s.pointerEvents };
    };
    // walk up ancestors of the top element
    const chain: unknown[] = [];
    let n: Element | null = topEl;
    while (n && chain.length < 8) { chain.push(cs(n)); n = n.parentElement; }
    return {
      btnRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      topEl: cs(topEl),
      chain,
    };
  });
  console.log('DIAG_TOP', JSON.stringify(info, null, 2));
  expect(true).toBeTruthy();
});