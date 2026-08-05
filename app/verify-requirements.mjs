import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const out = [];
const note = (label, ok, detail) => out.push({ label, ok, detail });

const browser = await chromium.launch({ headless: false, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 150)); });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  const has = (txt) => page.evaluate((t) => {
    const els = Array.from(document.querySelectorAll('*'));
    return els.some(el => el.childElementCount === 0 && el.textContent && el.textContent.trim().includes(t) && el.offsetParent !== null);
  }, txt);

  // 1. Earth + background
  const canvasInfo = await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).map(c => ({ cls: c.className, w: c.width, h: c.height })));
  note('1-页面/画布', true, JSON.stringify(canvasInfo));
  const star = await page.evaluate(() => {
    // starfield 可能是带特定 class 的 canvas
    const c = Array.from(document.querySelectorAll('canvas')).find(x => /star/i.test(x.className));
    return c ? c.className : '未找到star canvas';
  });
  note('1-星空', /star/i.test(star), star + ' | 背景CSS=' + await page.evaluate(() => getComputedStyle(document.body).backgroundImage.slice(0,60)));

  // 2. Ctrl+/ opens AI panel
  await page.keyboard.press('Control+/');
  await page.waitForTimeout(700);
  note('2-Ctrl+/开AI', await has('AI 地理助教'), '');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 3. click TopBar AI button
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /AI 对话|AI/.test(x.textContent || '')); if (b) b.click(); });
  await page.waitForTimeout(700);
  note('3-点AI按钮开面板', await has('AI 地理助教'), '');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 4. spacebar PTT (in main area, not input)
  // 直接派发 code='Space'，按下后立即(150ms)检测，避免 catch 重置错过同步的 listening:true
  const res = await page.evaluate(() => new Promise((resolve) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
    const snap = () => {
      const els = Array.from(document.querySelectorAll('*'));
      const listening = els.some(el => el.childElementCount === 0 && el.textContent && /正在聆听|聆听中/.test(el.textContent) && el.offsetParent !== null);
      resolve(listening);
    };
    setTimeout(snap, 150);
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true, cancelable: true })), 1200);
  }));
  const bodyTxtDuring = await page.evaluate(() => document.body.innerText);
  note('4-空格录音(按下150ms)', res, '检测到聆听=' + res + ' | 页面文本=' + bodyTxtDuring.replace(/\n/g, '|').slice(-200));

  // 5. course menu
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /课程/.test(x.textContent||'')); if (b) b.click(); });
  await page.waitForTimeout(700);
  note('5-课程菜单', await has('等高线') || await has('课程'), '');

  // 6. data layer buttons
  const dataBtns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => (b.textContent||'').trim()).filter(t => /天气|地震|数据|图层|人口|温度/.test(t)).slice(0,10));
  note('6-数据层按钮', dataBtns.length > 0, dataBtns.join('|'));

  note('控制台错误', errs.length === 0, errs.slice(0,6).join(' || '));
  await page.screenshot({ path: 'verify-shot.png' });
} catch (e) {
  note('异常', false, String(e));
}
console.log(JSON.stringify(out, null, 2));
await browser.close();