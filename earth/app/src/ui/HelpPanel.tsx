/**
 * HelpPanel —— 按键说明与操作帮助面板
 *
 * 按 ? 键唤起，Esc 键或点击遮罩关闭。
 * 包含：键盘快捷键、语音指令示例、图层说明。
 */

import { useEffect, useState } from 'react';
import { X } from './icons';

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  key: string;
  description: string;
}

interface CommandExample {
  text: string;
  description: string;
}

interface LayerGroup {
  name: string;
  items: Array<{ label: string; description: string }>;
}

const SHORTCUTS: ShortcutItem[] = [
  { key: '空格（按住）', description: '开始语音录音，松开后识别并执行指令' },
  { key: '空格（松开）', description: '结束录音，提交给 ASR + LLM 处理' },
  { key: '?', description: '打开/关闭本帮助面板' },
  { key: 'Esc', description: '关闭当前打开的浮层（工具面板/搜索/帮助）' },
  { key: '↑ ↓', description: '在搜索结果列表中上下移动高亮项' },
  { key: 'Enter', description: '在搜索框中确认选中城市并飞行定位' },
  { key: '鼠标拖拽', description: '旋转地球视角' },
  { key: '鼠标滚轮', description: '缩放视角高度' },
  { key: '右键拖拽', description: '倾斜视角（俯仰角）' },
  { key: '左键点击地球', description: '在测量模式下添加测量点' },
];

const VOICE_EXAMPLES: CommandExample[] = [
  { text: '飞到北京', description: '镜头飞行到指定城市' },
  { text: '显示等高线', description: '开启等高线地形分析' },
  { text: '等高线间距 500', description: '自定义等高线间距（米）' },
  { text: '切换到二维', description: '切换为 2D 视图' },
  { text: '显示城市', description: '打开城市标注图层' },
  { text: '打开晨昏线', description: '显示昼夜分界线' },
  { text: '开始自转', description: '启动地球自转动画' },
  { text: '暂停', description: '暂停当前动画' },
  { text: '地形夸张 3 倍', description: '放大地形起伏' },
  { text: '轴倾角 23.5', description: '设置地轴倾角' },
  { text: '打开等高线课程', description: '启动等高线教学课程' },
  { text: '截图', description: '保存当前画面为 PNG' },
  { text: '太阳系', description: '切换到太阳系视图' },
  { text: '返回地球', description: '从太阳系返回地球视图' },
];

const LAYER_GROUPS: LayerGroup[] = [
  {
    name: '标注图层',
    items: [
      { label: '经纬线', description: '每 30° 一条，地理坐标参考' },
      { label: '城市', description: '全球主要城市点位 + 名称' },
      { label: '气候带', description: '纬度带气候分区（热带/温带/寒带）' },
      { label: '板块', description: '六大板块边界（汇聚/离散/转换）' },
      { label: '日界线', description: '180° 经线，国际日期变更线' },
      { label: '河流', description: '世界主要河流' },
      { label: '山脉', description: '世界主要山脉点位 + 海拔' },
      { label: '行政边界', description: '国家行政区域' },
      { label: '洋流', description: '暖流（红）/寒流（蓝）' },
      { label: '季风风向', description: '夏季风（红）/冬季风（蓝）箭头' },
    ],
  },
  {
    name: '天文图层',
    items: [
      { label: '地轴', description: '贯穿南北极的旋转轴（带 23.5° 倾角）' },
      { label: '太阳直射点', description: '当前季节太阳直射纬度' },
      { label: '晨昏线', description: '昼夜分界线（开启光照效果）' },
      { label: '日间模式', description: '高亮日间半球' },
      { label: '自转', description: '地球绕地轴自西向东旋转' },
      { label: '公转', description: '地球绕太阳公转（太阳系视图）' },
    ],
  },
  {
    name: '数据图层',
    items: [
      { label: '天气', description: 'Open-Meteo 实时天气（温度+天气现象）' },
      { label: '地震', description: 'USGS 近 30 天 ≥4.5 级地震' },
      { label: '自然事件', description: 'NASA EONET 自然灾害事件' },
      { label: 'GDP', description: '世界各国 GDP 气泡图' },
      { label: '人口', description: '世界各国人口气泡图' },
      { label: '温度', description: '主要城市年均温' },
      { label: '降水', description: '主要城市年降水总量' },
    ],
  },
  {
    name: '地形分析',
    items: [
      { label: '等高线', description: '按指定间距渲染等高线' },
      { label: '高程分层', description: '海拔高度色带分层' },
      { label: '坡度', description: '地形坡度色彩分析' },
      { label: '坡向', description: '坡面朝向分析' },
      { label: '地形夸张', description: '放大地形起伏（0.5~5 倍）' },
    ],
  },
  {
    name: '测量工具',
    items: [
      { label: '距离测量', description: '左键添加点，右键结束，显示总距离' },
      { label: '面积测量', description: '左键添加多边形顶点，右键结束' },
      { label: '角度测量', description: '测量三点夹角' },
      { label: '高度测量', description: '测量点位海拔' },
      { label: '地形剖面', description: '沿路径生成高程剖面' },
    ],
  },
];

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  const [tab, setTab] = useState<'shortcuts' | 'voice' | 'layers'>('shortcuts');

  // Esc 关闭（已由父组件处理，这里再保险一次）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative max-h-[85vh] w-[min(720px,92vw)] overflow-hidden rounded-2xl bg-ink-800/95 ring-1 ring-geo-500/30 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-base font-medium text-white/90">按键说明 · 操作指南</h2>
          <button
            data-agent-button="help.close"
            onClick={onClose}
            className="text-white/50 hover:text-white"
            title="关闭（Esc）"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 标签页 */}
        <div className="flex gap-1 border-b border-white/10 px-5 py-2">
          {([
            { id: 'shortcuts', label: '键盘快捷键' },
            { id: 'voice', label: '语音指令' },
            { id: 'layers', label: '图层与工具' },
          ] as const).map((t) => (
            <button
              key={t.id}
              data-agent-button={`help.tab.${t.id}`}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                tab === t.id
                  ? 'bg-geo-500/20 text-geo-300'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm">
          {tab === 'shortcuts' && (
            <div className="space-y-1.5">
              {SHORTCUTS.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-white/80">{s.description}</span>
                  <kbd className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/90 ring-1 ring-white/10">
                    {s.key}
                  </kbd>
                </div>
              ))}
              <div className="mt-4 rounded-lg bg-geo-500/10 px-3 py-2 text-xs text-geo-300/80">
                提示：在输入框中按空格会正常输入，不会触发录音。
              </div>
            </div>
          )}

          {tab === 'voice' && (
            <div className="space-y-1.5">
              <p className="mb-2 text-xs text-white/50">
                按住空格说出以下指令，AI 会自动识别并执行。关键词识别为离线回退，
                配置火山引擎后支持自然语言。
              </p>
              {VOICE_EXAMPLES.map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <code className="rounded bg-geo-500/10 px-2 py-0.5 text-geo-300">
                    "{c.text}"
                  </code>
                  <span className="text-white/60">{c.description}</span>
                </div>
              ))}
              <div className="mt-4 rounded-lg bg-geo-500/10 px-3 py-2 text-xs text-geo-300/80">
                提示：语音权限失败时会自动回退到文本命令入口；网络不可用时使用离线关键词识别。
              </div>
            </div>
          )}

          {tab === 'layers' && (
            <div className="space-y-4">
              {LAYER_GROUPS.map((g) => (
                <div key={g.name}>
                  <div className="mb-1.5 text-xs font-medium text-geo-300">{g.name}</div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {g.items.map((item) => (
                      <div key={item.label} className="flex items-baseline gap-2 py-0.5">
                        <span className="flex-shrink-0 text-white/80">{item.label}</span>
                        <span className="text-xs text-white/40">— {item.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="mt-2 rounded-lg bg-geo-500/10 px-3 py-2 text-xs text-geo-300/80">
                提示：地形分析（等高线/坡度等）需要真实地形数据。未配置 Cesium ion token 时
                使用椭球回退，海拔恒为 0，建议配置 token 获得真实地形。
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="border-t border-white/10 px-5 py-2 text-center text-xs text-white/40">
          按 <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">?</kbd> 或
          <kbd className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-white/70">Esc</kbd> 关闭
        </div>
      </div>
    </div>
  );
}
