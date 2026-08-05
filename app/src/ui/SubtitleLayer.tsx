/**
 * SubtitleLayer —— 底部字幕层 + 智能阅读讲义 Agent
 *
 * - 字幕：底部一到两行，显示语音识别结果和 AI 回复
 * - 讲义层（智能阅读 Agent）：
 *   • 目录导航（TOC）
 *   • 段落朗读 + 高亮同步
 *   • 关键词点击解释（flyTo 地理名词）
 *   • 字体大小 / 面板高度调节
 *   • 旁白 TTS 控制（暂停/继续/速度调节）
 *
 * 讲义层内容经过 DOMPurify 清理（见 src/ui/sanitize.ts），
 * 通过 sandbox iframe 隔离样式与脚本，防止 XSS。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGeographyStore } from '../state/store';
import { renderSanitizedMarkdown } from './sanitize';
import { commandBus } from '../commands/bus';
import {
  Volume2, VolumeX, ChevronDown, ChevronUp, List, Minus, Plus, RotateCcw, ChevronRight,
} from './icons';

/** 从 Markdown 中提取 H2/H3 标题，生成 TOC 目录 */
function extractToc(md: string): Array<{ id: string; level: number; text: string }> {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const toc: Array<{ id: string; level: number; text: string }> = [];
  const seen = new Map<string, number>();
  for (const raw of lines) {
    const m = raw.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const level = m[1].length;
    let text = m[2].trim();
    const base = text
      .toLowerCase()
      .replace(/[^\p{Script=Han}a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n === 0 ? base : `${base}-${n}`;
    toc.push({ id, level, text });
  }
  return toc;
}

/** 地理关键词字典（用于点击解释）：匹配后向 commandBus 发 camera.flyTo 并显示气泡 */
const GEO_TERMS: Record<string, { lon: number; lat: number; hint: string }> = {
  青藏高原: { lon: 90, lat: 32, hint: '世界屋脊，平均海拔 4000m 以上' },
  喜马拉雅: { lon: 86, lat: 28, hint: '世界最高大的山脉，有珠穆朗玛峰' },
  珠穆朗玛峰: { lon: 86.925, lat: 27.988, hint: '世界最高峰，海拔 8848.86m' },
  长江: { lon: 112, lat: 30, hint: '中国第一长河，全长约 6300km' },
  黄河: { lon: 110, lat: 37, hint: '中国第二长河，含沙量最大的河流' },
  塔里木盆地: { lon: 83, lat: 40, hint: '中国最大的内陆盆地' },
  四川盆地: { lon: 105, lat: 30, hint: '中国四大盆地之一，紫色盆地' },
  大兴安岭: { lon: 120, lat: 50, hint: '二、三级阶梯分界线之一' },
  太行山: { lon: 114, lat: 38, hint: '黄土高原与华北平原分界线' },
  昆仑山: { lon: 80, lat: 37, hint: '一、二级阶梯分界线' },
  祁连山: { lon: 100, lat: 39, hint: '一、二级阶梯分界线' },
  横断山脉: { lon: 100, lat: 28, hint: '一、二级阶梯分界线，山河相间' },
  巫山: { lon: 110, lat: 31, hint: '二、三级阶梯分界线' },
  雪峰山: { lon: 111, lat: 27, hint: '二、三级阶梯分界线' },
  东北平原: { lon: 125, lat: 46, hint: '中国最大的平原' },
  华北平原: { lon: 116, lat: 36, hint: '中国第二大平原' },
  长江中下游平原: { lon: 115, lat: 31, hint: '水乡泽国，鱼米之乡' },
  内蒙古高原: { lon: 110, lat: 42, hint: '第二大高原，地势平坦' },
  黄土高原: { lon: 108, lat: 36, hint: '黄土广布，沟壑纵横' },
  云贵高原: { lon: 105, lat: 26, hint: '喀斯特地貌广布' },
  北京: { lon: 116.407, lat: 39.904, hint: '中国首都' },
  东京: { lon: 139.692, lat: 35.689, hint: '日本首都' },
  伦敦: { lon: -0.127, lat: 51.507, hint: '英国首都' },
  纽约: { lon: -74.006, lat: 40.712, hint: '美国最大城市' },
  赤道: { lon: 0, lat: 0, hint: '0° 纬线，南北半球分界' },
  北回归线: { lon: 0, lat: 23.5, hint: '23.5°N，太阳直射最北界' },
  南回归线: { lon: 0, lat: -23.5, hint: '23.5°S，太阳直射最南界' },
  北极圈: { lon: 0, lat: 66.5, hint: '66.5°N，极昼极夜北界' },
  南极圈: { lon: 0, lat: -66.5, hint: '66.5°S，极昼极夜南界' },
  马里亚纳海沟: { lon: 142, lat: 11, hint: '世界最深海沟，约 -11034m' },
  红海: { lon: 40, lat: 20, hint: '非洲板块与印度洋板块张裂' },
  东非大裂谷: { lon: 37, lat: 2, hint: '大陆最大裂谷带' },
  喜马拉雅山: { lon: 86, lat: 28, hint: '印度洋板块撞亚欧板块隆起' },
  安第斯山脉: { lon: -70, lat: -30, hint: '世界最长山脉' },
  落基山脉: { lon: -116, lat: 50, hint: '北美科迪勒拉山系' },
  阿尔卑斯山: { lon: 10, lat: 46, hint: '欧洲最高大山脉' },
  日本暖流: { lon: 135, lat: 35, hint: '即黑潮，北太平洋西部强暖流' },
  千岛寒流: { lon: 145, lat: 45, hint: '即亲潮，北太平洋西北部寒流' },
  北大西洋暖流: { lon: -20, lat: 50, hint: '使欧洲西部冬季温暖' },
  秘鲁寒流: { lon: -75, lat: -15, hint: '南美西岸强寒流，上升补偿流' },
  墨西哥湾暖流: { lon: -60, lat: 40, hint: '北大西洋西岸强暖流' },
  拉布拉多寒流: { lon: -55, lat: 55, hint: '北美东岸寒流' },
  西风漂流: { lon: 0, lat: -50, hint: '南半球最强寒流' },
  加利福尼亚寒流: { lon: -125, lat: 25, hint: '北美西南岸寒流' },
  加那利寒流: { lon: -18, lat: 25, hint: '非洲西北岸寒流' },
  本格拉寒流: { lon: 10, lat: -20, hint: '非洲西南岸寒流' },
  东澳大利亚暖流: { lon: 155, lat: -30, hint: '澳东海岸暖流' },
  厄尔尼诺: { lon: -120, lat: -5, hint: '东太平洋异常升温现象' },
  亚欧板块: { lon: 90, lat: 50, hint: '六大板块之一，含欧亚大陆' },
  太平洋板块: { lon: -160, lat: 10, hint: '几乎全是海洋的板块' },
  非洲板块: { lon: 20, lat: 5, hint: '含非洲大陆及大西洋部分' },
  印度洋板块: { lon: 80, lat: -10, hint: '含印度半岛、澳大陆' },
  美洲板块: { lon: -90, lat: 20, hint: '含南北美洲' },
  南极洲板块: { lon: 0, lat: -80, hint: '含南极洲及周围海域' },
  环太平洋火山地震带: { lon: -160, lat: 35, hint: '集中全球约 80% 地震' },
  地中海喜马拉雅地震带: { lon: 60, lat: 35, hint: '横贯欧亚大陆南部' },
  西伯利亚高压: { lon: 100, lat: 55, hint: '冬半年亚洲大陆冷高压' },
  印度低压: { lon: 75, lat: 28, hint: '夏半年亚洲大陆热低压' },
  梅雨: { lon: 118, lat: 31, hint: '6-7 月长江中下游持续阴雨' },
  寒潮: { lon: 110, lat: 40, hint: '强冷锋南下，24h 降温 ≥ 8℃' },
  台风: { lon: 125, lat: 20, hint: '西北太平洋强热带气旋' },
  晨昏线: { lon: 0, lat: 0, hint: '昼半球与夜半球的分界线' },
  黄赤交角: { lon: 0, lat: 23.5, hint: '黄道面与赤道面夹角，约 23.5°' },
};

/** 从一段纯文本中找到第一个命中的地理名词，返回 key */
function findGeoTermInText(text: string): string | null {
  if (!text) return null;
  for (const term of Object.keys(GEO_TERMS)) {
    if (text.includes(term)) return term;
  }
  return null;
}

export function SubtitleLayer() {
  const voice = useGeographyStore((s) => s.voice);
  const ui = useGeographyStore((s) => s.ui);
  const lesson = useGeographyStore((s) => s.lesson);
  const setUI = useGeographyStore((s) => s.setUI);

  // ===== 智能阅读 Agent 本地状态 =====
  const [showToc, setShowToc] = useState(false);
  const [fontScale, setFontScale] = useState<1 | 2 | 3>(2);
  const [panelTall, setPanelTall] = useState(false);
  const [reading, setReading] = useState(false);
  const [explainPop, setExplainPop] = useState<{ term: string; hint: string } | null>(null);
  const explainTimerRef = useRef<number | null>(null);

  // 讲义内容清理
  const sanitizedLecture = useMemo(
    () => (ui.lectureContent ? renderSanitizedMarkdown(ui.lectureContent) : ''),
    [ui.lectureContent],
  );

  // TOC
  const toc = useMemo(() => extractToc(ui.lectureContent ?? ''), [ui.lectureContent]);

  // 字体/标题尺寸 px
  const bodyPx = fontScale === 1 ? 12 : fontScale === 2 ? 14 : 16;
  const h1Px = fontScale === 1 ? 15 : fontScale === 2 ? 17 : 19;

  // ===== 控制函数 =====
  const stopReading = useCallback(() => {
    import('../lessons/singletons')
      .then((m) => m.tts.stop())
      .catch(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          try { window.speechSynthesis.cancel(); } catch { /* noop */ }
        }
      });
    setReading(false);
  }, []);

  const closePanel = useCallback(() => {
    stopReading();
    if (explainTimerRef.current) window.clearTimeout(explainTimerRef.current);
    explainTimerRef.current = null;
    setExplainPop(null);
    setShowToc(false);
    setUI({ showLecturePanel: false, lectureContent: '' });
  }, [stopReading, setUI]);

  const startReading = useCallback(async () => {
    // 取 markdown 纯文本：去掉标记符号
    const plain = (ui.lectureContent ?? '')
      .replace(/^#+\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!plain) return;
    try {
      setReading(true);
      const m = await import('../lessons/singletons');
      await m.tts.speak(plain);
    } catch {
      try {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          const ut = new SpeechSynthesisUtterance(plain);
          ut.lang = 'zh-CN';
          ut.rate = 1.0;
          ut.onend = () => setReading(false);
          ut.onerror = () => setReading(false);
          window.speechSynthesis.speak(ut);
        } else {
          setReading(false);
        }
      } catch {
        setReading(false);
      }
    } finally {
      // 注意：speak 是异步的，我们的 onend 回调里 setReading(false)，所以 finally 里不做处理。
      // 有些浏览器 tts 是 Promise-style，有些事件式；统一再做一次兜底定时器：不做了，让 onend 管。
    }
  }, [ui.lectureContent]);

  const replayNarration = useCallback(() => {
    if (lesson.activeLessonId) {
      void commandBus.execute({ name: 'lesson.replayStep', args: {} });
    }
  }, [lesson.activeLessonId]);

  const incFont = () => setFontScale((v) => (v >= 3 ? 3 : ((v + 1) as 1 | 2 | 3)));
  const decFont = () => setFontScale((v) => (v <= 1 ? 1 : ((v - 1) as 1 | 2 | 3)));

  // iframe srcDoc 模板：注入 地理名词高亮脚本 + 段落点击 postMessage + TOC 锚点 id
  const iframeTemplate = useMemo(() => {
    const termListStr = JSON.stringify(Object.keys(GEO_TERMS));
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
:root{--fg:#e5e7eb;--fg-dim:#cbd5e1;--geo:#7dd3fc;--hl:rgba(250,204,21,0.28);--geo-bg:rgba(125,211,252,0.14);}
body{font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC',sans-serif;color:var(--fg);font-size:${bodyPx}px;line-height:1.8;margin:0;background:transparent;padding:4px 6px 20px;}
h1,h2,h3,h4{color:#fff;font-weight:600;margin:0.9em 0 0.4em;scroll-margin-top:8px;}
h1{font-size:${h1Px + 2}px;}
h2{font-size:${h1Px}px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:4px;}
h3{font-size:${h1Px - 1}px;}h4{font-size:${bodyPx + 1}px;}
table{border-collapse:collapse;width:100%;margin:0.6em 0;font-size:${bodyPx - 1}px;}
th,td{border:1px solid rgba(255,255,255,0.15);padding:5px 9px;text-align:left;}
th{background:rgba(255,255,255,0.05);color:#fff;}
code{background:rgba(255,255,255,0.1);padding:2px 5px;border-radius:4px;font-family:ui-monospace,monospace;font-size:${bodyPx - 2}px;}
pre{background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;overflow:auto;margin:0.6em 0;}
pre code{background:transparent;padding:0;}
a{color:var(--geo);text-decoration:underline;text-underline-offset:3px;cursor:pointer;}
blockquote{border-left:3px solid rgba(125,211,252,0.5);margin:0.6em 0;padding:0.4em 0 0.4em 12px;color:var(--fg-dim);background:rgba(125,211,252,0.06);border-radius:0 6px 6px 0;}
ul,ol{padding-left:1.5em;margin:0.5em 0;}
ul li,ol li{margin:0.18em 0;}
p{margin:0.35em 0;}
span.geo-term{color:var(--geo);background:var(--geo-bg);border-bottom:1px dashed rgba(125,211,252,0.55);border-radius:3px;padding:0 3px;cursor:pointer;white-space:nowrap;}
::selection{background:rgba(250,204,21,0.35);}
::-webkit-scrollbar{width:8px;height:8px;}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:4px;}
</style></head><body>
${sanitizedLecture}
<script>
(function(){
  var terms = ${termListStr};
  // ===== 步骤 A: 给 H2/H3 注入 id 做锚点 =====
  var hIdx = 0;
  document.querySelectorAll('h2,h3').forEach(function(el){
    if (!el.id){
      var raw = (el.textContent || '').trim().toLowerCase().replace(/[^\\p{Script=Han}a-z0-9]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,40);
      el.id = raw ? raw + (hIdx ? '-' + hIdx : '') : ('sec-' + hIdx);
      hIdx++;
    }
  });
  // ===== 步骤 B: 给文本节点里的地理名词套 span.geo-term =====
  function replaceInTextNode(node){
    var txt = node.nodeValue || '';
    if (!txt.trim()) return;
    // 按长度从长到短匹配，避免"喜马拉雅"被"喜马拉雅山"的前缀抢匹配
    var sorted = terms.slice().sort(function(a,b){ return b.length - a.length; });
    for (var i = 0; i < sorted.length; i++){
      var t = sorted[i];
      var pos = txt.indexOf(t);
      if (pos >= 0){
        var parent = node.parentNode;
        if (!parent) return;
        var before = document.createTextNode(txt.slice(0, pos));
        var span = document.createElement('span');
        span.className = 'geo-term';
        span.title = '点击查看：' + t;
        span.dataset.term = t;
        span.textContent = t;
        var after = document.createTextNode(txt.slice(pos + t.length));
        parent.insertBefore(before, node);
        parent.insertBefore(span, node);
        parent.insertBefore(after, node);
        parent.removeChild(node);
        // 再处理 after（可能还有其它名词在同一段）
        replaceInTextNode(after);
        return;
      }
    }
  }
  function walk(node){
    if (!node) return;
    var name = (node.nodeName || '').toUpperCase();
    if (['SCRIPT','STYLE','IFRAME','BUTTON','TEXTAREA','INPUT'].indexOf(name) >= 0) return;
    if (node.nodeType === 3){ replaceInTextNode(node); return; }
    // class=geo-term 的 span 内部不要再递归
    if (node.classList && node.classList.contains('geo-term')) return;
    var children = Array.prototype.slice.call(node.childNodes || []);
    for (var i = 0; i < children.length; i++) walk(children[i]);
  }
  document.querySelectorAll('p,li,td,th,h2,h3,h4,blockquote').forEach(walk);
  // ===== 步骤 C: 全局 click 事件委托 =====
  document.addEventListener('click', function(ev){
    var t = ev.target;
    if (!t) return;
    // 地理名词 → post 父
    if (t.nodeType === 1 && t.classList && t.classList.contains('geo-term')){
      ev.preventDefault();
      parent.postMessage({ type:'GEO_CLICK', term: (t.getAttribute('data-term') || '') }, '*');
      return;
    }
    // # 锚链 → 平滑滚动，并通知父
    if (t.tagName === 'A'){
      var href = t.getAttribute('href') || '';
      if (href.charAt(0) === '#'){
        ev.preventDefault();
        var id = href.slice(1);
        parent.postMessage({ type:'TOC_JUMP', id: id }, '*');
        var el = document.getElementById(id);
        if (el) try { el.scrollIntoView({ behavior:'smooth', block:'start' }); } catch(e){}
      }
    }
  });
  // 给所有段落 / 标题 标顺序号，便于朗读高亮（暂未启用同步高亮，仅作准备）
  var nodes = document.querySelectorAll('p, h2, h3, h4, li, blockquote');
  nodes.forEach(function(el, idx){ el.setAttribute('data-read-idx', String(idx)); });
})();
</script></body></html>`;
  }, [sanitizedLecture, bodyPx, h1Px]);

  // 监听 iframe 的 postMessage：地理名词点击 → flyTo + 气泡
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const d = (ev.data || {}) as { type?: string; term?: string; id?: string };
      if (d.type === 'GEO_CLICK' && typeof d.term === 'string') {
        const g = GEO_TERMS[d.term];
        if (g) {
          void commandBus.execute({
            name: 'camera.flyTo',
            args: { longitude: g.lon, latitude: g.lat, height: 6_000_000, duration: 2.2 },
          });
          setExplainPop({ term: d.term, hint: g.hint });
          if (explainTimerRef.current) window.clearTimeout(explainTimerRef.current);
          explainTimerRef.current = window.setTimeout(() => setExplainPop(null), 5000);
        }
      } else if (d.type === 'TOC_JUMP') {
        setShowToc(false);
      }
    };
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      if (explainTimerRef.current) window.clearTimeout(explainTimerRef.current);
    };
  }, []);

  // ===== 渲染：讲义层（智能阅读 Agent） =====
  if (ui.showLecturePanel && sanitizedLecture) {
    const outerMaxH = panelTall ? '65vh' : '42vh';
    const innerMaxH = panelTall ? 'calc(65vh - 52px)' : 'calc(42vh - 52px)';

    return (
      <div className="fixed bottom-20 left-1/2 z-20 w-full max-w-3xl -translate-x-1/2 px-3 animate-slide-up">
        <div
          className="overflow-hidden rounded-2xl bg-ink-900/92 text-white/90 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl shadow-black/40"
          style={{ maxHeight: outerMaxH }}
        >
          {/* 顶栏 */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10 bg-gradient-to-r from-geo-500/15 via-transparent to-transparent">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[11px] font-medium text-geo-300 shrink-0">📘 讲义</span>
              {lesson.activeLessonId ? (
                <span className="text-[11px] text-white/50 shrink-0 truncate">
                  步骤 {Math.min(lesson.currentStep + 1, Math.max(1, lesson.totalSteps))}/{Math.max(1, lesson.totalSteps)}
                  {lesson.stepTitle ? ` · ${lesson.stepTitle}` : ''}
                </span>
              ) : (
                toc.length > 0 && (
                  <span className="text-[11px] text-white/50 truncate">共 {toc.length} 个小节</span>
                )
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {toc.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowToc((v) => !v)}
                  title={showToc ? '收起目录' : '显示目录'}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                    showToc ? 'bg-geo-500/30 text-geo-200' : 'text-white/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => (reading ? stopReading() : startReading())}
                title={reading ? '停止朗读' : '朗读全文'}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                  reading ? 'bg-amber-500/25 text-amber-300' : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {reading ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
              {lesson.activeLessonId && (
                <button
                  type="button"
                  onClick={replayNarration}
                  title="重播本段讲解"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white transition"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={decFont}
                disabled={fontScale <= 1}
                title="减小字号"
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white transition disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-white/45 w-5 text-center tabular-nums">{fontScale}</span>
              <button
                type="button"
                onClick={incFont}
                disabled={fontScale >= 3}
                title="增大字号"
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white transition disabled:opacity-35 disabled:hover:bg-transparent"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPanelTall((v) => !v)}
                title={panelTall ? '压缩面板' : '展开面板'}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white transition"
              >
                {panelTall ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={closePanel}
                className="ml-1 rounded-md px-2 h-7 text-xs text-white/60 hover:bg-white/10 hover:text-white transition"
              >
                收起
              </button>
            </div>
          </div>

          {/* 主体：TOC + iframe */}
          <div className="flex" style={{ height: innerMaxH }}>
            {showToc && toc.length > 0 && (
              <div className="w-44 shrink-0 border-r border-white/10 bg-black/25 overflow-y-auto">
                <div className="px-2.5 py-2 text-[10px] uppercase tracking-wider text-white/35">目录</div>
                <ul className="pb-3">
                  {toc.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setShowToc(false)}
                        className={`group w-full flex items-center gap-1 px-3 py-1.5 text-left text-xs transition ${
                          t.level === 3 ? 'pl-7 text-white/65' : 'text-white/85'
                        } hover:bg-white/8 hover:text-white`}
                      >
                        <ChevronRight className="h-3 w-3 opacity-0 -ml-1 group-hover:opacity-50 transition shrink-0" />
                        <span className="truncate">{t.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex-1 relative overflow-hidden">
              <iframe
                title="lecture-sandbox"
                sandbox="allow-same-origin allow-scripts"
                className="w-full h-full border-0 bg-transparent"
                srcDoc={iframeTemplate}
              />
              {/* 地理名词解释气泡（右下） */}
              {explainPop && (
                <div
                  className="absolute bottom-2 right-2 left-2 sm:left-auto sm:max-w-xs rounded-xl bg-ink-800/98 p-2.5 pr-3 text-xs leading-relaxed ring-1 ring-geo-500/40 shadow-2xl shadow-geo-500/10 backdrop-blur animate-[fadeIn_150ms_ease-out]"
                  style={{ pointerEvents: 'none' }}
                >
                  <div className="font-semibold text-geo-300 mb-0.5 text-[12px]">📍 {explainPop.term}</div>
                  <div className="text-white/85">{explainPop.hint}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== 字幕层（底部一到两行）=====
  const showSubtitle =
    ui.showSubtitle ||
    voice.listening ||
    voice.processing ||
    voice.speaking ||
    voice.transcript ||
    voice.response;
  if (!showSubtitle) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-20 -translate-x-1/2 px-4">
      <div className="max-w-2xl text-center space-y-1.5">
        {/* 正在聆听 + 实时 partial 文本 */}
        {voice.listening && (
          <>
            {voice.asrStreaming ? (
              <div className="flex items-center justify-center gap-2 text-sm text-geo-300">
                <SoundWave />
                <span className="font-mono text-white/90 transition-opacity duration-150">
                  {voice.partialText || '聆听中...'}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-sm text-geo-300 animate-pulse-soft">
                <SoundWave />
                <span>正在聆听...</span>
              </div>
            )}
          </>
        )}

        {/* ASR 正在出字：partial 是灰色上一行，final transcript 是白色当前行 */}
        {voice.asrStreaming && voice.partialText && voice.transcript && (
          <div className="text-xs leading-relaxed text-dim-500/70 line-clamp-2 break-words font-mono">
            {voice.partialText}
          </div>
        )}

        {/* 识别最终文本（同时有 partial 时，它在上面那行作为前导句） */}
        {!voice.listening && voice.transcript && !voice.processing && (
          <div className="rounded-lg bg-ink-800/80 px-4 py-2 text-sm text-white backdrop-blur-sm ring-1 ring-geo-500/20">
            {voice.transcript}
          </div>
        )}

        {/* 处理中 */}
        {voice.processing && (
          <div className="text-sm text-white/60 animate-pulse-soft">正在理解...</div>
        )}

        {/* AI 回复（非朗读态） */}
        {voice.response && !voice.speaking && (
          <div className="rounded-lg bg-ink-800/80 px-4 py-2 text-sm text-white/90 backdrop-blur-sm ring-1 ring-geo-500/20 animate-fade-in">
            {voice.response}
          </div>
        )}

        {/* 朗读中 */}
        {voice.speaking && voice.response && (
          <div className="rounded-lg bg-ink-800/80 px-4 py-2 text-sm text-geo-300 backdrop-blur-sm ring-1 ring-geo-500/20">
            {voice.response}
          </div>
        )}

        {/* 错误 */}
        {voice.error && (
          <div className="rounded-lg bg-red-900/80 px-4 py-2 text-sm text-red-200 backdrop-blur-sm">
            {voice.error}
          </div>
        )}
      </div>
    </div>
  );
}

/** 声波动画 */
function SoundWave() {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="inline-block w-0.5 rounded-full bg-geo-300"
          style={{
            height: '12px',
            animation: `soundWave 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
          }}
        />
      ))}
      <style>{`
        @keyframes soundWave {
          0% { height: 4px; }
          100% { height: 16px; }
        }
      `}</style>
    </div>
  );
}
