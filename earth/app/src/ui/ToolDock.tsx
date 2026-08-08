/**
 * ToolDock —— 左下角可折叠工具坞
 *
 * 默认只显示"视图、标注、天文、数据、测量"几个紧凑入口。
 * 点击入口后展开轻量菜单。点击地图空白处或按 Esc 后自动收起。
 */

import { useState, useEffect } from 'react';
import { useGeographyStore } from '../state/store';
import { commandBus } from '../commands/bus';
import { Tool, Eye, MapPin, Sun, Database, Ruler, ChevronLeft } from './icons';
import { useLayerBusy } from './useLayerBusy';

type DockPanel = 'view' | 'annotation' | 'astronomy' | 'data' | 'measure' | null;

/** 工具坞通用按钮样式：busy 时降低透明度 + 禁用指针事件，避免连点触发 Manager 队列堆积 */
function dockDisabledClass(busy: boolean): string {
  return busy ? 'opacity-50 pointer-events-none cursor-not-allowed' : '';
}

export function ToolDock() {
  const [collapsed, setCollapsed] = useState(false);
  const [activePanel, setActivePanel] = useState<DockPanel>(null);
  const store = useGeographyStore();
  const state = store;
  const { busy: sceneBusy } = useLayerBusy('sceneMode');
  const { busy: basemapBusy } = useLayerBusy('basemap');
  const { busy: globeMaterialBusy } = useLayerBusy('globeMaterial');

  // Esc 收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActivePanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 点击空白处收起
  useEffect(() => {
    if (!activePanel) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-tool-dock]')) {
        setActivePanel(null);
      }
    };
    // 延迟绑定，避免触发当前点击
    const timer = setTimeout(() => {
      window.addEventListener('click', onClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', onClick);
    };
  }, [activePanel]);

  if (collapsed) {
    return (
      <button
        data-agent-button="dock.expand"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-6 left-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-ink-800/80 text-geo-300 backdrop-blur-sm ring-1 ring-geo-500/20 hover:bg-ink-700/80 hover:ring-geo-500/40 transition-all"
        aria-label="展开工具坞"
        title="展开工具坞"
      >
        <Tool className="h-5 w-5" />
      </button>
    );
  }

  const tools: Array<{ id: DockPanel; label: string; icon: typeof Tool }> = [
    { id: 'view', label: '视图', icon: Eye },
    { id: 'annotation', label: '标注', icon: MapPin },
    { id: 'astronomy', label: '天文', icon: Sun },
    { id: 'data', label: '数据', icon: Database },
    { id: 'measure', label: '测量', icon: Ruler },
  ];

  return (
    <div data-tool-dock className="fixed bottom-6 left-6 z-30 flex flex-col gap-2">
      {/* 展开的面板 */}
      {activePanel && (
        <div className="mb-2 max-h-[60vh] w-64 overflow-y-auto rounded-xl bg-ink-800/90 p-3 text-sm text-white backdrop-blur-md ring-1 ring-geo-500/20 animate-slide-up">
          {activePanel === 'view' && <ViewPanel state={state} sceneBusy={sceneBusy} basemapBusy={basemapBusy} globeMaterialBusy={globeMaterialBusy} />}
          {activePanel === 'annotation' && <AnnotationPanel state={state} />}
          {activePanel === 'astronomy' && <AstronomyPanel state={state} />}
          {activePanel === 'data' && <DataPanel state={state} />}
          {activePanel === 'measure' && <MeasurePanel state={state} />}
        </div>
      )}

      {/* 工具入口按钮组 */}
      <div className={`flex items-center gap-1 rounded-full bg-ink-800/80 p-1.5 backdrop-blur-sm ring-1 ring-geo-500/20 ${dockDisabledClass(sceneBusy || basemapBusy || globeMaterialBusy)}`}>
        {tools.map((t) => (
          <button
            key={t.id}
            data-agent-button={`dock.${t.id}`}
            onClick={() => setActivePanel(activePanel === t.id ? null : t.id)}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
              activePanel === t.id
                ? 'bg-geo-500/20 text-geo-300'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
            title={t.label}
          >
            <t.icon className="h-4 w-4" />
          </button>
        ))}
        <div className="mx-0.5 h-5 w-px bg-white/10" />
        <button
          data-agent-button="dock.collapse"
          onClick={() => setCollapsed(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10"
          title="折叠工具坞"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ============ 面板组件 ============

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-white/80">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  disabled,
  title,
}: {
  id?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      data-agent-button={id}
      onClick={disabled ? undefined : onChange}
      title={title}
      disabled={disabled}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? 'bg-geo-500' : 'bg-white/20'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'left-4' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function ViewPanel({
  state,
  sceneBusy,
  basemapBusy,
  globeMaterialBusy,
}: {
  state: ReturnType<typeof useGeographyStore.getState>;
  sceneBusy: boolean;
  basemapBusy: boolean;
  globeMaterialBusy: boolean;
}) {
  // 仅当检测到有天地图 token 时才展示天地图显式底图切换（无 token 时点击也会自动回退到国际回退底图，但为了 UI 清晰，不展示给用户）
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  const showTiandituGroup = !!env.VITE_TIANDITU_TOKEN;
  const showAmapGroup = !!env.VITE_AMAP_KEY;

  return (
    <div className="space-y-1">
      <div className="mb-2 text-xs font-medium text-geo-300">视图模式</div>
      <div className={sceneBusy ? dockDisabledClass(true) : ''}>
        <PanelRow label="三维">
          <Toggle id="view.mode.3d" checked={state.viewMode === '3d'} onChange={() => commandBus.execute({ name: 'view.setMode', args: { mode: '3d' } })} />
        </PanelRow>
        <PanelRow label="二维">
          <Toggle id="view.mode.2d" checked={state.viewMode === '2d'} onChange={() => commandBus.execute({ name: 'view.setMode', args: { mode: '2d' } })} />
        </PanelRow>
      </div>

      {/* Q3：底图按 卫星/街景(路网政区)/地貌 三类清晰分组 */}
      <div className="my-2 h-px bg-white/10" />
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-geo-300">底图 · 卫星影像</div>
      </div>
      <div className={basemapBusy ? dockDisabledClass(true) : ''}>
        {(['satellite', 'amapSatellite', ...(showTiandituGroup ? ['tiandituSatellite' as const] : [])] as const).map((bm) => (
          <PanelRow key={bm} label={basemapLabel(bm)}>
            <Toggle id={`view.basemap.${bm}`} checked={state.basemap === bm} onChange={() => commandBus.execute({ name: 'view.setBasemap', args: { basemap: bm } })} />
          </PanelRow>
        ))}
      </div>

      <div className="my-2 h-px bg-white/10" />
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-geo-300">底图 · 街景 / 路网政区</div>
        <div className="text-[10px] text-geo-400/80">街道级别</div>
      </div>
      <div className={basemapBusy ? dockDisabledClass(true) : ''}>
        {(['political', 'osm', ...(showAmapGroup ? ['amapPolitical' as const, 'amapRoad' as const] : []), ...(showTiandituGroup ? ['tiandituPolitical' as const] : [])] as const).map((bm) => (
          <PanelRow key={bm} label={basemapLabel(bm)}>
            <Toggle id={`view.basemap.${bm}`} checked={state.basemap === bm} onChange={() => commandBus.execute({ name: 'view.setBasemap', args: { basemap: bm } })} />
          </PanelRow>
        ))}
      </div>

      <div className="my-2 h-px bg-white/10" />
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-geo-300">底图 · 地貌 / 地势</div>
        <div className="text-[10px] text-geo-400/80">分层设色</div>
      </div>
      <div className={basemapBusy ? dockDisabledClass(true) : ''}>
        {(['relief', 'landform', 'contour', ...(showTiandituGroup ? ['tiandituRelief' as const] : [])] as const).map((bm) => (
          <PanelRow key={bm} label={basemapLabel(bm)}>
            <Toggle id={`view.basemap.${bm}`} checked={state.basemap === bm} onChange={() => commandBus.execute({ name: 'view.setBasemap', args: { basemap: bm } })} />
          </PanelRow>
        ))}
      </div>

      <div className="my-2 h-px bg-white/10" />
      <div className="mb-2 text-xs font-medium text-geo-300">地形分析</div>
      {!state.terrain.available && (
        <div className="mb-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300">
          当前为椭球回退模式，等高线/坡度/坡向等地形分析功能不可用
        </div>
      )}
      <div className={globeMaterialBusy ? dockDisabledClass(true) : ''}>
        <PanelRow label="等高线">
          <Toggle
            id="terrain.contour"
            checked={state.terrain.contour}
            disabled={state.viewMode !== '3d' || !state.terrain.available}
            title={!state.terrain.available ? '需要配置地形数据（VITE_CESIUM_ION_TOKEN）' : state.viewMode !== '3d' ? '等高线仅在 3D 地球模式下可用' : undefined}
            onChange={() =>
              state.terrain.contour
                ? commandBus.execute({ name: 'layer.toggle', args: { layer: '__clearTerrain__', visible: false } })
                : commandBus.execute({ name: 'layer.showContour', args: { spacing: state.terrain.contourSpacing } })
            }
          />
        </PanelRow>
        <div className="flex items-center gap-2 py-1 text-xs">
          <span className="text-white/60 w-14 shrink-0">间距</span>
          <input
            type="range" min={50} max={2000} step={50}
            value={state.terrain.contourSpacing}
            disabled={state.viewMode !== '3d' || !state.terrain.available}
            onChange={(e) => commandBus.execute({ name: 'terrain.setContourSpacing', args: { spacing: parseInt(e.target.value, 10) } })}
            className={`flex-1 accent-geo-500 ${state.viewMode !== '3d' || !state.terrain.available ? 'opacity-40 cursor-not-allowed' : ''}`}
          />
          <span className="text-white/80 w-12 text-right">{state.terrain.contourSpacing}m</span>
        </div>
        <PanelRow label="高程分层">
          <Toggle
            id="terrain.elevationRamp"
            checked={state.terrain.elevationRamp}
            disabled={state.viewMode !== '3d'}
            title={state.viewMode !== '3d' ? '高程分层仅在 3D 地球模式下可用' : !state.terrain.available ? '当前为椭球地形，高程分层显示基于海平面的均匀色带。配置 VITE_CESIUM_ION_TOKEN 可获得真实地形效果' : undefined}
            onChange={() =>
              state.terrain.elevationRamp
                ? commandBus.execute({ name: 'layer.toggle', args: { layer: '__clearTerrain__', visible: false } })
                : commandBus.execute({ name: 'layer.showElevationRamp', args: {} })
            }
          />
        </PanelRow>
        <PanelRow label="坡度">
          <Toggle
            id="terrain.slope"
            checked={state.terrain.slope}
            disabled={state.viewMode !== '3d' || !state.terrain.available}
            title={!state.terrain.available ? '需要配置地形数据（VITE_CESIUM_ION_TOKEN）' : state.viewMode !== '3d' ? '坡度分析仅在 3D 地球模式下可用' : undefined}
            onChange={() =>
              state.terrain.slope
                ? commandBus.execute({ name: 'layer.toggle', args: { layer: '__clearTerrain__', visible: false } })
                : commandBus.execute({ name: 'layer.showSlope', args: {} })
            }
          />
        </PanelRow>
        <PanelRow label="坡向">
          <Toggle
            id="terrain.aspect"
            checked={state.terrain.aspect}
            disabled={state.viewMode !== '3d' || !state.terrain.available}
            title={!state.terrain.available ? '需要配置地形数据（VITE_CESIUM_ION_TOKEN）' : state.viewMode !== '3d' ? '坡向分析仅在 3D 地球模式下可用' : undefined}
            onChange={() =>
              state.terrain.aspect
                ? commandBus.execute({ name: 'layer.toggle', args: { layer: '__clearTerrain__', visible: false } })
                : commandBus.execute({ name: 'layer.showAspect', args: {} })
            }
          />
        </PanelRow>
      </div>
      <div className="py-1.5">
        <span className="text-white/80">地形夸张</span>
        <input
          type="range" min={0.5} max={5} step={0.5}
          value={state.terrain.exaggeration}
          disabled={state.viewMode !== '3d'}
          title={state.viewMode !== '3d' ? '地形夸张仅在 3D 地球模式下可用' : undefined}
          onChange={(e) => commandBus.execute({ name: 'terrain.setExaggeration', args: { value: parseFloat(e.target.value) } })}
          className={`mt-1 w-full accent-geo-500 ${state.viewMode !== '3d' ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </div>
    </div>
  );
}

function AnnotationPanel({ state }: { state: ReturnType<typeof useGeographyStore.getState> }) {
  // 按类别分组：避免 11 个标注层平铺造成的视觉杂乱
  const groups: Array<{ title: string; hint?: string; items: Array<{ key: keyof typeof state.annotations; label: string }> }> = [
    {
      title: '基础地理',
      items: [
        { key: 'graticule', label: '经纬线' },
        { key: 'dateLine', label: '日界线' },
        { key: 'cities', label: '城市' },
        { key: 'labels', label: '地名' },
      ],
    },
    {
      title: '地形地貌',
      items: [
        { key: 'mountains', label: '山脉' },
        { key: 'rivers', label: '河流' },
      ],
    },
    {
      title: '气候气象',
      items: [
        { key: 'climateZones', label: '气候带' },
        { key: 'oceanCurrents', label: '洋流' },
        { key: 'monsoonWinds', label: '季风风向' },
      ],
    },
    {
      title: '行政 & 地质',
      items: [
        { key: 'adminBounds', label: '行政边界' },
        { key: 'plates', label: '板块' },
      ],
    },
  ];
  return (
    <div className="space-y-1">
      <div className="mb-2 text-xs font-medium text-geo-300">标注图层</div>
      {groups.map((g, gi) => (
        <div key={g.title}>
          {gi > 0 && <div className="my-2 h-px bg-white/10" />}
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[11px] font-medium text-white/60">{g.title}</div>
            {g.hint && <div className="text-[10px] text-geo-400/80">{g.hint}</div>}
          </div>
          {g.items.map((item) => (
            <PanelRow key={item.key} label={item.label}>
              <Toggle
                id={`annotate.${item.key}`}
                checked={state.annotations[item.key]}
                onChange={() => commandBus.execute({ name: 'layer.toggle', args: { layer: item.key } })}
              />
            </PanelRow>
          ))}
        </div>
      ))}
    </div>
  );
}

function AstronomyPanel({ state }: { state: ReturnType<typeof useGeographyStore.getState> }) {
  const items: Array<{ key: keyof typeof state.astronomy; label: string; only3D?: boolean }> = [
    { key: 'axis', label: '地轴', only3D: true },
    { key: 'directPoint', label: '太阳直射点', only3D: true },
    { key: 'twilight', label: '晨昏线', only3D: true },
    { key: 'dayMode', label: '日间模式' },
    { key: 'rotation', label: '自转', only3D: true },
    { key: 'revolution', label: '公转', only3D: true },
  ];
  return (
    <div className="space-y-1">
      <div className="mb-2 text-xs font-medium text-geo-300">视图切换</div>
      <button
        data-agent-button="astronomy.toggleSolarSystem"
        onClick={() => commandBus.execute({
          name: state.solarSystemActive ? 'view.showEarth' : 'view.showSolarSystem',
          args: {},
        })}
        className={`block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
          state.solarSystemActive
            ? 'bg-geo-500/20 text-geo-300'
            : 'text-white/80 hover:bg-white/10'
        }`}
      >
        {state.solarSystemActive ? '返回地球视图' : '太阳系视图'}
      </button>

      <div className="my-2 h-px bg-white/10" />
      <div className="mb-2 text-xs font-medium text-geo-300">天文图层</div>
      {items.map((item) => {
        const disabled2D = item.only3D && state.viewMode !== '3d';
        return (
          <PanelRow key={item.key} label={item.label}>
            <Toggle
              id={`astronomy.${item.key}`}
              checked={state.astronomy[item.key]}
              disabled={disabled2D}
              title={disabled2D ? `${item.label}仅在 3D 地球模式下可用` : undefined}
              onChange={() => commandBus.execute({ name: 'layer.toggle', args: { layer: item.key } })}
            />
          </PanelRow>
        );
      })}
      <div className="my-2 h-px bg-white/10" />
      <div className="py-1.5">
        <span className="text-white/80">自转速度</span>
        <input
          type="range" min={0} max={5} step={0.1}
          value={state.rotationSpeed}
          disabled={state.viewMode !== '3d'}
          title={state.viewMode !== '3d' ? '自转控制仅在 3D 地球模式下可用' : undefined}
          onChange={(e) => commandBus.execute({ name: 'animation.setSpeed', args: { speed: parseFloat(e.target.value) } })}
          className={`mt-1 w-full accent-geo-500 ${state.viewMode !== '3d' ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </div>
      <div className="py-1.5">
        <span className="text-white/80">公转速度</span>
        <input
          type="range" min={0} max={5} step={0.1}
          value={state.revolutionSpeed}
          disabled={state.viewMode !== '3d'}
          title={state.viewMode !== '3d' ? '公转控制仅在 3D 地球模式下可用' : undefined}
          onChange={(e) => commandBus.execute({ name: 'astronomy.setRevolutionSpeed', args: { speed: parseFloat(e.target.value) } })}
          className={`mt-1 w-full accent-geo-500 ${state.viewMode !== '3d' ? 'opacity-40 cursor-not-allowed' : ''}`}
        />
      </div>
    </div>
  );
}

function DataPanel({ state }: { state: ReturnType<typeof useGeographyStore.getState> }) {
  // 按类别分组：实时数据（需网络）vs 统计数据（预置）
  const groups: Array<{ title: string; hint: string; items: Array<{ key: keyof typeof state.data; label: string }> }> = [
    {
      title: '实时数据',
      hint: '联网获取',
      items: [
        { key: 'weather', label: '天气' },
        { key: 'earthquake', label: '地震' },
        { key: 'naturalEvents', label: '自然事件' },
        { key: 'temperature', label: '温度' },
        { key: 'precipitation', label: '降水' },
      ],
    },
    {
      title: '统计数据',
      hint: '预置数据',
      items: [
        { key: 'gdp', label: 'GDP' },
        { key: 'population', label: '人口' },
      ],
    },
  ];
  return (
    <div className="space-y-1">
      <div className="mb-2 text-xs font-medium text-geo-300">数据图层</div>
      {groups.map((g, gi) => (
        <div key={g.title}>
          {gi > 0 && <div className="my-2 h-px bg-white/10" />}
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[11px] font-medium text-white/60">{g.title}</div>
            <div className="text-[10px] text-geo-400/80">{g.hint}</div>
          </div>
          {g.items.map((item) => (
            <PanelRow key={item.key} label={item.label}>
              <Toggle
                id={`data.${item.key}`}
                checked={state.data[item.key]}
                onChange={() => commandBus.execute({ name: 'layer.toggle', args: { layer: item.key } })}
              />
            </PanelRow>
          ))}
        </div>
      ))}
    </div>
  );
}

function MeasurePanel({ state }: { state: ReturnType<typeof useGeographyStore.getState> }) {
  const modes: Array<{ mode: 'distance' | 'area' | 'angle' | 'height' | 'profile'; label: string }> = [
    { mode: 'distance', label: '距离测量' },
    { mode: 'area', label: '面积测量' },
    { mode: 'angle', label: '角度测量' },
    { mode: 'height', label: '高度测量' },
    { mode: 'profile', label: '地形剖面' },
  ];
  return (
    <div className="space-y-1">
      <div className="mb-2 text-xs font-medium text-geo-300">测量工具</div>
      {modes.map((m) => (
        <button
          key={m.mode}
          data-agent-button={`measure.${m.mode}`}
          onClick={() => commandBus.execute({ name: 'measure.start', args: { mode: m.mode } })}
          className={`block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
            state.measurement.mode === m.mode
              ? 'bg-geo-500/20 text-geo-300'
              : 'text-white/80 hover:bg-white/10'
          }`}
        >
          {m.label}
        </button>
      ))}
      <div className="my-2 h-px bg-white/10" />
      <button
        data-agent-button="measure.clear"
        onClick={() => commandBus.execute({ name: 'measure.clear', args: {} })}
        className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/10"
      >
        清除测量
      </button>
    </div>
  );
}

function basemapLabel(bm: string): string {
  const map: Record<string, string> = {
    satellite: '卫星影像（通用）',
    political: '政区底图（通用）',
    relief: '地势图（通用）',
    landform: '地貌图',
    contour: '等高线图',
    osm: 'OSM 地图',
    // Q7 高德
    amapSatellite: '高德·卫星',
    amapPolitical: '高德·路网政区',
    amapRoad: '高德·纯路网',
    // Q3 天地图显式
    tiandituSatellite: '天地图·卫星',
    tiandituPolitical: '天地图·政区路网',
    tiandituRelief: '天地图·地势',
  };
  return map[bm] ?? bm;
}
