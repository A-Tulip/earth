/**
 * CesiumLayerSync —— 图层实体同步组件
 *
 * 订阅 store 中的 annotations/data 图层状态，
 * 在 Cesium 上添加/移除对应的实体（城市点、河流线、板块边界）。
 *
 * 数据来源：data/providers.ts 的预置数据（教学回退，无需网络）。
 * 实体生命周期由本组件管理，避免重复添加。
 */

import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import { commandBus } from '../commands/bus';
import { useGeographyStore } from '../state/store';
import type { ViewMode } from '../state/sceneState';
import { getLayerManager } from './LayerLifeCycleManager';
import {
  getCities,
  getRivers,
  getPlates,
  fetchWeather,
  fetchEarthquakes,
  fetchNaturalEvents,
  getClimateZones,
  getMountains,
  getOceanCurrents,
  getMonsoonWinds,
  getAdminBounds,
  getGdp,
  getPopulation,
  fetchTemperature,
  fetchPrecipitation,
} from '../data/providers';

export function CesiumLayerSync() {
  // 实体引用：按图层 key 分组管理
  const entitiesRef = useRef<Record<string, Cesium.Entity[]>>({});
  // LOD 订阅句柄
  const lodHandleRef = useRef<(() => void) | null>(null);
  const lastModeRef = useRef<ViewMode>('3d');

  useEffect(() => {
    const getController = () => commandBus.getContext().cesium;
    const entities = entitiesRef.current;

    // ================ Q11 防崩溃：所有实体操作统一走 LayerLifeCycleManager.schedule ================
    // 判断图层 key 是标注类还是数据类（dataLayer）——用前缀匹配
    const ANNOT_PREFIXES = new Set([
      'cities', 'placenames', 'rivers', 'climateZones', 'tectonicPlates',
      'graticule', 'dateLine', 'mountains', 'adminBounds', 'oceanCurrents',
      'monsoonWinds', 'jetStream', 'coldWarm', 'plates',
    ]);
    const DATA_PREFIXES = new Set([
      'weather', 'earthquakes', 'naturalEvents', 'gdp', 'population',
      'temperature', 'precipitation', 'typhoons',
    ]);
    const kindForKey = (k: string): 'annotations' | 'dataLayer' => {
      if (ANNOT_PREFIXES.has(k)) return 'annotations';
      if (DATA_PREFIXES.has(k)) return 'dataLayer';
      return k.startsWith('weather') || k.startsWith('earthquake') || k.startsWith('gdp') || k.startsWith('pop') || k.startsWith('temp') || k.startsWith('precip') ? 'dataLayer' : 'annotations';
    };
    // 清理 / 添加实体：保证与 basemap/sceneMode/globeMaterial 互斥，防止场景过渡时期 Cesium 内部 null-deref
    /** 清空某图层的所有实体（调度进 annotations/dataLayer 队列） */
    const clearLayer = (key: string) => {
      try {
        const ctrl = getController();
        if (!ctrl) return;
        const list = entities[key];
        if (!list || list.length === 0) return;
        const kind = kindForKey(key);
        const mgr = getLayerManager();
        const run = (): void => {
          const viewer = ctrl.getViewer();
          if (!viewer || !viewer.scene || !viewer.entities) return;
          // Q2：按 id 精确 remove，避免 Cesium 内部同 id 实体残留导致后续 add 时被"复位"到旧位置
          for (const e of list) {
            try {
              if (e?.id != null) {
                const existing = viewer.entities.getById(String(e.id));
                if (existing) viewer.entities.remove(existing);
              } else {
                viewer.entities.remove(e);
              }
            } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:84', (e as any)?.message ?? e); }
          }
          entities[key] = [];
          try { viewer.scene.requestRender(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:87', (e as any)?.message ?? e); }
        };
        if (mgr) void mgr.schedule(kind, async () => run());
        else run();
      } catch (e) {
        // Q11：clearLayer 永远不向外抛错：避免 Zustand subscribe 异常冒泡到全局
        console.warn('[CesiumLayerSync] clearLayer fail', key, e);
      }
    };

    /** 添加某图层的实体（调度进 annotations/dataLayer 队列）—— 按 entity.id merge：已存在同 id 的只更新引用，不再重复 add（避免视觉"闪一下/回到原点"） */
    const ensureLayer = (key: string, build: (viewer: Cesium.Viewer) => Cesium.Entity[]) => {
      try {
        const ctrl = getController();
        if (!ctrl) return;
        const kind = kindForKey(key);
        const mgr = getLayerManager();
        const run = (): void => {
          try {
            const viewer = ctrl.getViewer();
            if (!viewer || !viewer.scene || !viewer.entities) return;
            const existing = entities[key] ?? [];
            // Q2：按 entity.id 建索引，避免每次 subscribe 触发时"remove 全部 + add 全部"造成的视觉闪烁
            const idx = new Map<string, Cesium.Entity>();
            for (const e of existing) if (e?.id != null) idx.set(String(e.id), e);
            // build 时不直接用返回数组，而是逐个检查：
            //   - 同 id 已在 viewer.entities 且未被销毁 → 复用，不重复 add
            //   - 同 id 已不在 viewer.entities → add
            const builtRaw = build(viewer);
            const merged: Cesium.Entity[] = [];
            for (const cand of builtRaw) {
              if (cand?.id == null) { merged.push(cand); continue; }
              const idStr = String(cand.id);
              const alreadyInViewer = viewer.entities.getById(idStr);
              if (alreadyInViewer) {
                // 真正存在的实体：
                //  - 如果 idx 中也有（我们之前的引用）→ 直接复用（位置/状态不会被重新创建）
                //  - idx 中没有（可能其他代码加过）→ 复用 viewer 中的，同时把 build 返回的 cand 立即移除（避免双重）
                if (idx.has(idStr)) {
                  merged.push(idx.get(idStr)!);
                  // build 过程已经 add 了 cand（因为 build 内部是 viewer.entities.add），移除它避免重复
                  try { viewer.entities.remove(cand); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:128', (e as any)?.message ?? e); }
                } else {
                  merged.push(alreadyInViewer);
                  try { viewer.entities.remove(cand); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:131', (e as any)?.message ?? e); }
                }
              } else {
                merged.push(cand);
              }
            }
            entities[key] = merged;
            backfillLabelMeta(merged);
            try { applyLabelLOD(viewer, entities); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:139', (e as any)?.message ?? e); }
            try { viewer.scene.requestRender(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:140', (e as any)?.message ?? e); }
          } catch (e) {
            console.warn('[CesiumLayerSync] ensureLayer build fail', key, e);
          }
        };
        if (mgr) void mgr.schedule(kind, async () => run());
        else run();
      } catch (e) {
        // Q11：ensureLayer 永远不向外抛错：避免订阅者 subscribe 回调里的异常冒泡到全局
        console.warn('[CesiumLayerSync] ensureLayer fail', key, e);
      }
    };

    /** 异步构建图层（用于网络抓取：天气/地震/自然事件/温雨）—— 保证 build 阶段也在 schedule 内执行；Q2：按 id merge，避免重复 add 视觉闪烁 */
    const ensureLayerAsync = async (
      key: string,
      buildAsync: (viewer: Cesium.Viewer) => Promise<Cesium.Entity[] | null>,
    ): Promise<void> => {
      try {
        const ctrl = getController();
        if (!ctrl) return;
        const kind = kindForKey(key);
        const mgr = getLayerManager();
        const run = async (): Promise<void> => {
          try {
            const viewer = ctrl.getViewer();
            if (!viewer || !viewer.scene || !viewer.entities) return;
            const built = await buildAsync(viewer);
            if (!built) return;
            // 合并：如果 entities[key] 已经有实体（可能是异步期间另一次触发），按 id 合并
            const existing = entities[key] ?? [];
            if (existing.length === 0) {
              entities[key] = built;
              backfillLabelMeta(built);
              try { applyLabelLOD(viewer, entities); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:174', (e as any)?.message ?? e); }
            } else {
              // 冲突：有旧引用了 → 按 id 建索引，只有不存在的才保留；新建的重复 id 立即 remove
              const idx = new Map<string, Cesium.Entity>();
              for (const e of existing) if (e?.id != null) idx.set(String(e.id), e);
              const finalList: Cesium.Entity[] = [...existing];
              for (const cand of built) {
                if (cand?.id == null) { finalList.push(cand); continue; }
                const idStr = String(cand.id);
                if (idx.has(idStr)) {
                  // 已存在 → cand 是 buildAsync 内部 viewer.entities.add 创建的重复，移除它
                  try { viewer.entities.remove(cand); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:185', (e as any)?.message ?? e); }
                } else {
                  finalList.push(cand);
                  idx.set(idStr, cand);
                }
              }
              entities[key] = finalList;
              backfillLabelMeta(finalList);
              try { applyLabelLOD(viewer, entities); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:193', (e as any)?.message ?? e); }
            }
            try { viewer.scene.requestRender(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:195', (e as any)?.message ?? e); }
          } catch (e) {
            console.warn('[CesiumLayerSync] async build fail', key, e);
          }
        };
        if (mgr) await mgr.schedule(kind, run);
        else await run();
      } catch (e) {
        console.warn('[CesiumLayerSync] ensureLayerAsync outer fail', key, e);
      }
    };

    // ============ 城市图层 ============
    const unsubCities = useGeographyStore.subscribe(
      (s) => s.annotations.cities,
      (visible) => {
        if (visible) {
          ensureLayer('cities', (viewer) =>
            getCities().map((city) =>
              viewer.entities.add({
                id: `city-${city.name}`,
                position: Cesium.Cartesian3.fromDegrees(city.lon, city.lat),
                point: {
                  pixelSize: 8,
                  color: Cesium.Color.fromBytes(125, 211, 252, 255),
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 1.5,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: {
                  text: city.name,
                  font: '13px Noto Sans SC',
                  fillColor: Cesium.Color.WHITE,
                  outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                  outlineWidth: 3,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(0, -14),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
              }),
            ),
          );
        } else {
          clearLayer('cities');
        }
      },
      { fireImmediately: true },
    );

    // ============ 河流图层 ============
    const unsubRivers = useGeographyStore.subscribe(
      (s) => s.annotations.rivers,
      (visible) => {
        if (visible) {
          ensureLayer('rivers', (viewer) =>
            getRivers().map((river) =>
              viewer.entities.add({
                id: `river-${river.name}`,
                polyline: {
                  positions: Cesium.Cartesian3.fromDegreesArray(
                    river.coordinates.flat(),
                  ),
                  width: 2.5,
                  material: Cesium.Color.fromBytes(96, 165, 250, 220),
                  clampToGround: true,
                },
                label: {
                  text: river.name,
                  font: '12px Noto Sans SC',
                  fillColor: Cesium.Color.fromBytes(147, 197, 253, 255),
                  outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(0, -10),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
              }),
            ),
          );
        } else {
          clearLayer('rivers');
        }
      },
      { fireImmediately: true },
    );

    // ============ 板块图层 ============
    const unsubPlates = useGeographyStore.subscribe(
      (s) => s.annotations.plates,
      (visible) => {
        if (visible) {
          ensureLayer('plates', (viewer) =>
            getPlates().map((plate) => {
              const color =
                plate.type === 'convergent'
                  ? Cesium.Color.fromBytes(239, 68, 68, 220)
                  : plate.type === 'divergent'
                    ? Cesium.Color.fromBytes(34, 197, 94, 220)
                    : Cesium.Color.fromBytes(234, 179, 8, 220);
              return viewer.entities.add({
                id: `plate-${plate.name}`,
                polyline: {
                  positions: Cesium.Cartesian3.fromDegreesArray(
                    plate.coordinates.flat(),
                  ),
                  width: 3,
                  material: color,
                  clampToGround: true,
                },
              });
            }),
          );
        } else {
          clearLayer('plates');
        }
      },
      { fireImmediately: true },
    );

    // ============ 经纬线图层 ============
    const unsubGraticule = useGeographyStore.subscribe(
      (s) => s.annotations.graticule,
      (visible) => {
        if (visible) {
          ensureLayer('graticule', (viewer) => {
            const lines: Cesium.Entity[] = [];
            // 经线：每 30 度，范围 ±89.5°（避免 ±90° 极点处的几何退化导致的渲染空洞/抖动）
            for (let lon = -180; lon <= 180; lon += 30) {
              const positions: number[] = [];
              for (let lat = -89.5; lat <= 89.5; lat += 3) {
                positions.push(lon, lat);
              }
              lines.push(
                viewer.entities.add({
                  id: `grat-lon-${lon}`,
                  polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray(positions),
                    width: 1,
                    material: Cesium.Color.fromBytes(125, 211, 252, 50),
                    clampToGround: true,
                  },
                }),
              );
            }
            // 纬线：每 30 度，范围 ±60°（±85°以上接近极点，贴地退化；只画教学常用带 ±70°/60°/...）
            for (let lat = -60; lat <= 60; lat += 30) {
              const positions: number[] = [];
              // 用 < 180 避免首尾重合（-180° 与 180° 是同一条经线，重合会触发 EllipsoidGeodesic 错误）
              for (let lon = -180; lon < 180; lon += 5) {
                positions.push(lon, lat);
              }
              lines.push(
                viewer.entities.add({
                  id: `grat-lat-${lat}`,
                  polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray(positions),
                    width: 1,
                    material: Cesium.Color.fromBytes(125, 211, 252, 50),
                    clampToGround: true,
                  },
                }),
              );
            }
            // 额外 ±60/±80°高纬度圈（教学常用），±85°+ 省略避免极点贴地退化
            for (const highLat of [-80, 80]) {
              const positions: number[] = [];
              for (let lon = -180; lon < 180; lon += 5) positions.push(lon, highLat);
              lines.push(
                viewer.entities.add({
                  id: `grat-lat-${highLat}`,
                  polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray(positions),
                    width: 1,
                    material: Cesium.Color.fromBytes(125, 211, 252, 38),
                    clampToGround: true,
                  },
                }),
              );
            }
            return lines;
          });
        } else {
          clearLayer('graticule');
        }
      },
      { fireImmediately: true },
    );

    // ============ 日界线 ============
    const unsubDateLine = useGeographyStore.subscribe(
      (s) => s.annotations.dateLine,
      (visible) => {
        if (visible) {
          ensureLayer('dateLine', (viewer) => [
            viewer.entities.add({
              id: 'date-line-180',
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray([
                  180, 80, 180, -80,
                ]),
                width: 2,
                material: Cesium.Color.fromBytes(251, 191, 36, 180),
                clampToGround: true,
              },
              label: {
                text: '日界线',
                font: '12px Noto Sans SC',
                fillColor: Cesium.Color.fromBytes(251, 191, 36, 255),
                outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(20, 0),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            }),
          ]);
        } else {
          clearLayer('dateLine');
        }
      },
      { fireImmediately: true },
    );

    // ============ 地名图层（labels） —— 瓦片注记层的显示/隐藏（天地图 cva_w / 高德 style=8）============
    // 注意：labels 图层不是 Cesium entities，而是 imageryLayers 中的第 2 层（叠加注记瓦片）
    // 每次切底图后 controller.setBasemap 内部也会再次根据 store.labels 同步一次状态
    let labelsLastApplyTs = 0;
    const applyLabelsVisible = (visible: boolean, urgent = false) => {
      try {
        const ctrl = getController();
        if (!ctrl) return;
        const now = Date.now();
        // 节流：非 urgent 情况下最小间隔 250ms（避免订阅+底图切换双重触发刷屏）
        if (!urgent && now - labelsLastApplyTs < 250) return;
        labelsLastApplyTs = now;
        // 通过 controller 上暴露的方法切注记瓦片可见性
        const ctrlAny = ctrl as unknown as { setLabelImageryVisible?: (v: boolean) => void };
        if (ctrlAny.setLabelImageryVisible) {
          ctrlAny.setLabelImageryVisible(visible);
        } else {
          // 兜底：直接调 updateLayer('labels', visible)（updateLayer 内部会识别 labels 并切瓦片）
          void ctrl.updateLayer('labels', visible);
        }
      } catch (e) {
        console.warn('[CesiumLayerSync] labels visible apply fail:', e);
      }
    };
    // labels 订阅：初始 labels=true → 应用一次；后续切换时同步
    const unsubLabels = useGeographyStore.subscribe(
      (s) => s.annotations.labels,
      (visible) => {
        applyLabelsVisible(visible, false);
      },
      { fireImmediately: true },
    );
    // 额外订阅 basemap 切换：每次底图切换完成后，需要把 labels 可见性再同步一次（因为 imageryLayers 被重建了）
    const unsubBasemapForLabels = useGeographyStore.subscribe(
      (s) => s.basemap,
      () => {
        // 底图切换后，注记瓦图层被重建 → 延迟 500ms（等 crossfade 完成后）再同步 labels 状态
        const visible = useGeographyStore.getState().annotations.labels;
        setTimeout(() => applyLabelsVisible(visible, true), 520);
      },
      { fireImmediately: false },
    );

    // ============ 天气数据图层（异步） ============
    let weatherCancelled = false;
    const unsubWeather = useGeographyStore.subscribe(
      (s) => s.data.weather,
      async (visible) => {
        if (!visible) {
          clearLayer('weather');
          return;
        }
        if (entities['weather'] && entities['weather'].length > 0) return;
        await ensureLayerAsync('weather', async (viewer) => {
          const results = await Promise.all(getCities().map((c) => fetchWeather(c)));
          if (weatherCancelled || !useGeographyStore.getState().data.weather) return null;
          return results.map((w) =>
            viewer.entities.add({
              id: `weather-${w.city}`,
              position: Cesium.Cartesian3.fromDegrees(w.lon, w.lat),
              point: {
                pixelSize: 10,
                color: Cesium.Color.fromBytes(56, 189, 248, 200),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1.5,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              label: {
                text: `${w.city} ${w.temp}℃ ${w.weather}`,
                font: '12px Noto Sans SC',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -16),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            }),
          );
        });
      },
      { fireImmediately: true },
    );

    // ============ 地震数据图层（异步） ============
    let earthquakeCancelled = false;
    const unsubEarthquake = useGeographyStore.subscribe(
      (s) => s.data.earthquake,
      async (visible) => {
        if (!visible) {
          clearLayer('earthquake');
          return;
        }
        if (entities['earthquake'] && entities['earthquake'].length > 0) return;
        await ensureLayerAsync('earthquake', async (viewer) => {
          const quakes = await fetchEarthquakes(4.5);
          if (earthquakeCancelled || !useGeographyStore.getState().data.earthquake) return null;
          return quakes.map((q) => {
            // 震级越大点越大：4.5→8px，9.0→22px
            const size = Math.max(8, Math.min(22, (q.magnitude - 4.5) * 4 + 8));
            const color =
              q.magnitude >= 6
                ? Cesium.Color.fromBytes(239, 68, 68, 230)
                : q.magnitude >= 5
                  ? Cesium.Color.fromBytes(251, 146, 60, 230)
                  : Cesium.Color.fromBytes(250, 204, 21, 230);
            return viewer.entities.add({
              id: `quake-${q.id}`,
              position: Cesium.Cartesian3.fromDegrees(q.lon, q.lat),
              point: {
                pixelSize: size,
                color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              label: {
                text: `M${q.magnitude}`,
                font: '11px Noto Sans SC',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          });
        });
      },
      { fireImmediately: true },
    );

    // ============ 自然事件图层（异步，NASA EONET） ============
    let naturalEventsCancelled = false;
    const unsubNaturalEvents = useGeographyStore.subscribe(
      (s) => s.data.naturalEvents,
      async (visible) => {
        if (!visible) {
          clearLayer('naturalEvents');
          return;
        }
        if (entities['naturalEvents'] && entities['naturalEvents'].length > 0) return;
        await ensureLayerAsync('naturalEvents', async (viewer) => {
          const events = await fetchNaturalEvents();
          if (naturalEventsCancelled || !useGeographyStore.getState().data.naturalEvents) return null;
          return events.slice(0, 50).map((ev, idx) =>
            viewer.entities.add({
              id: `event-${ev.id}-${idx}`,
              position: Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat),
              point: {
                pixelSize: 9,
                color: Cesium.Color.fromBytes(168, 85, 247, 220),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              label: {
                text: ev.title.slice(0, 16),
                font: '11px Noto Sans SC',
                fillColor: Cesium.Color.fromBytes(216, 180, 254, 255),
                outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            }),
          );
        });
      },
      { fireImmediately: true },
    );

    // ============ 气候带图层 ============
    const unsubClimateZones = useGeographyStore.subscribe(
      (s) => s.annotations.climateZones,
      (visible) => {
        if (visible) {
          ensureLayer('climateZones', (viewer) => {
            const zones = getClimateZones();
            const ents: Cesium.Entity[] = [];
            zones.forEach((zone, idx) => {
              // 用纬度带矩形 polygon 表示气候带
              // 用 < 180 避免首尾重合（-180° 与 180° 重合会触发 EllipsoidGeodesic 错误）
              const coords: number[] = [];
              for (let lon = -180; lon < 180; lon += 10) {
                coords.push(lon, zone.maxLat);
              }
              for (let lon = 170; lon >= -180; lon -= 10) {
                coords.push(lon, zone.minLat);
              }
              const [r, g, b] = zone.color;
              // 多边形区域：arcType 使用 RHUMB（等角航线），避免 GEODESIC 对大跨度纬线的对跖检查
              ents.push(
                viewer.entities.add({
                  id: `climate-${idx}`,
                  polygon: {
                    hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
                    material: Cesium.Color.fromBytes(r, g, b, 50),
                    outline: true,
                    outlineColor: Cesium.Color.fromBytes(r, g, b, 180),
                    arcType: Cesium.ArcType.RHUMB,
                  },
                }),
              );
              // 标签独立实体（label 需要 entity.position）
              ents.push(
                viewer.entities.add({
                  id: `climate-label-${idx}`,
                  position: Cesium.Cartesian3.fromDegrees(0, (zone.minLat + zone.maxLat) / 2, 0),
                  label: {
                    text: zone.name,
                    font: '12px Noto Sans SC',
                    fillColor: Cesium.Color.fromBytes(r, g, b, 255),
                    outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -10),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  },
                }),
              );
            });
            return ents;
          });
        } else {
          clearLayer('climateZones');
        }
      },
      { fireImmediately: true },
    );

    // ============ 山脉图层 ============
    const unsubMountains = useGeographyStore.subscribe(
      (s) => s.annotations.mountains,
      (visible) => {
        if (visible) {
          ensureLayer('mountains', (viewer) =>
            getMountains().map((m) =>
              viewer.entities.add({
                id: `mountain-${m.name}`,
                position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat),
                point: {
                  pixelSize: Math.max(6, Math.min(12, m.elevation / 1000)),
                  color: Cesium.Color.fromBytes(217, 119, 6, 255),
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 1.5,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
                label: {
                  text: `${m.name} ${m.elevation}m`,
                  font: '11px Noto Sans SC',
                  fillColor: Cesium.Color.fromBytes(252, 211, 77, 255),
                  outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(0, -14),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
              }),
            ),
          );
        } else {
          clearLayer('mountains');
        }
      },
      { fireImmediately: true },
    );

    // ============ 行政边界图层 ============
    const unsubAdminBounds = useGeographyStore.subscribe(
      (s) => s.annotations.adminBounds,
      (visible) => {
        if (visible) {
          ensureLayer('adminBounds', (viewer) =>
            getAdminBounds().flatMap((b) => {
              // 去除首尾重复点（数据中首尾相同会导致 EllipsoidGeodesic 重合点错误）
              const coords = b.coordinates.flat();
              if (coords.length >= 4) {
                const firstLon = coords[0];
                const firstLat = coords[1];
                const lastLon = coords[coords.length - 2];
                const lastLat = coords[coords.length - 1];
                if (firstLon === lastLon && firstLat === lastLat) {
                  coords.splice(coords.length - 2, 2);
                }
              }
              const ents: Cesium.Entity[] = [
                viewer.entities.add({
                  id: `admin-${b.name}`,
                  polygon: {
                    hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
                    material: Cesium.Color.fromBytes(125, 211, 252, 25),
                    outline: true,
                    outlineColor: Cesium.Color.fromBytes(125, 211, 252, 200),
                    outlineWidth: 1.5,
                  },
                }),
              ];
              // 标签独立实体（label 需要 entity.position）
              if (b.coordinates.length > 0) {
                const center = b.coordinates[Math.floor(b.coordinates.length / 2)];
                ents.push(
                  viewer.entities.add({
                    id: `admin-label-${b.name}`,
                    position: Cesium.Cartesian3.fromDegrees(center[0], center[1]),
                    label: {
                      text: b.name,
                      font: '12px Noto Sans SC',
                      fillColor: Cesium.Color.WHITE,
                      outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                      outlineWidth: 2,
                      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                      pixelOffset: new Cesium.Cartesian2(0, 0),
                      disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    },
                  }),
                );
              }
              return ents;
            }),
          );
        } else {
          clearLayer('adminBounds');
        }
      },
      { fireImmediately: true },
    );

    // ============ 洋流图层 ============
    const unsubOceanCurrents = useGeographyStore.subscribe(
      (s) => s.annotations.oceanCurrents,
      (visible) => {
        if (visible) {
          ensureLayer('oceanCurrents', (viewer) =>
            getOceanCurrents().flatMap((oc) => {
              const isWarm = oc.type === 'warm';
              const color = isWarm
                ? Cesium.Color.fromBytes(239, 68, 68, 230)
                : Cesium.Color.fromBytes(56, 189, 248, 230);
              const ents: Cesium.Entity[] = [
                viewer.entities.add({
                  id: `current-${oc.name}`,
                  polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray(oc.coordinates.flat()),
                    width: 4,
                    material: color,
                    clampToGround: true,
                  },
                }),
              ];
              // 在中点添加名称标签
              const mid = oc.coordinates[Math.floor(oc.coordinates.length / 2)];
              ents.push(
                viewer.entities.add({
                  id: `current-label-${oc.name}`,
                  position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1]),
                  label: {
                    text: `${oc.name}${isWarm ? '(暖)' : '(寒)'}`,
                    font: '11px Noto Sans SC',
                    fillColor: color,
                    outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -12),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  },
                }),
              );
              return ents;
            }),
          );
        } else {
          clearLayer('oceanCurrents');
        }
      },
      { fireImmediately: true },
    );

    // ============ 季风风向图层 ============
    const unsubMonsoonWinds = useGeographyStore.subscribe(
      (s) => s.annotations.monsoonWinds,
      (visible) => {
        if (visible) {
          ensureLayer('monsoonWinds', (viewer) =>
            getMonsoonWinds().flatMap((mw) => {
              const isSummer = mw.season === 'summer';
              const color = isSummer
                ? Cesium.Color.fromBytes(239, 68, 68, 220)
                : Cesium.Color.fromBytes(96, 165, 250, 220);
              const ents: Cesium.Entity[] = [
                viewer.entities.add({
                  id: `monsoon-${mw.name}`,
                  polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray(mw.coordinates.flat()),
                    width: 4,
                    material: new Cesium.PolylineArrowMaterialProperty(color),
                    clampToGround: true,
                  },
                }),
              ];
              const mid = mw.coordinates[Math.floor(mw.coordinates.length / 2)];
              ents.push(
                viewer.entities.add({
                  id: `monsoon-label-${mw.name}`,
                  position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1]),
                  label: {
                    text: mw.name,
                    font: '11px Noto Sans SC',
                    fillColor: color,
                    outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -14),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  },
                }),
              );
              return ents;
            }),
          );
        } else {
          clearLayer('monsoonWinds');
        }
      },
      { fireImmediately: true },
    );

    // ============ GDP 数据图层 ============
    const unsubGdp = useGeographyStore.subscribe(
      (s) => s.data.gdp,
      (visible) => {
        if (visible) {
          ensureLayer('gdp', (viewer) =>
            getGdp().map((g) => {
              // 气泡大小按 GDP 映射
              const size = Math.max(10, Math.min(30, g.gdp * 1.5));
              // 颜色按人均 GDP 映射
              const color = g.gdpPerCapita >= 4
                ? Cesium.Color.fromBytes(34, 197, 94, 220)
                : g.gdpPerCapita >= 1.5
                  ? Cesium.Color.fromBytes(251, 191, 36, 220)
                  : Cesium.Color.fromBytes(239, 68, 68, 220);
              return viewer.entities.add({
                id: `gdp-${g.iso3}`,
                position: Cesium.Cartesian3.fromDegrees(getCountryCenter(g.iso3).lon, getCountryCenter(g.iso3).lat),
                ellipse: {
                  semiMajorAxis: size * 50000,
                  semiMinorAxis: size * 50000,
                  material: color,
                  outline: true,
                  outlineColor: Cesium.Color.WHITE,
                },
                label: {
                  text: `${g.country}\n${g.gdp}万亿$`,
                  font: '11px Noto Sans SC',
                  fillColor: Cesium.Color.WHITE,
                  outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(0, -size - 4),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
              });
            }),
          );
        } else {
          clearLayer('gdp');
        }
      },
      { fireImmediately: true },
    );

    // ============ 人口数据图层 ============
    const unsubPopulation = useGeographyStore.subscribe(
      (s) => s.data.population,
      (visible) => {
        if (visible) {
          ensureLayer('population', (viewer) =>
            getPopulation().map((p) => {
              const size = Math.max(8, Math.min(28, p.population * 2));
              const color = p.density >= 300
                ? Cesium.Color.fromBytes(239, 68, 68, 220)
                : p.density >= 100
                  ? Cesium.Color.fromBytes(251, 146, 60, 220)
                  : Cesium.Color.fromBytes(96, 165, 250, 220);
              return viewer.entities.add({
                id: `pop-${p.iso3}`,
                position: Cesium.Cartesian3.fromDegrees(getCountryCenter(p.iso3).lon, getCountryCenter(p.iso3).lat),
                ellipse: {
                  semiMajorAxis: size * 60000,
                  semiMinorAxis: size * 60000,
                  material: color,
                  outline: true,
                  outlineColor: Cesium.Color.WHITE,
                },
                label: {
                  text: `${p.country}\n${p.population}亿`,
                  font: '11px Noto Sans SC',
                  fillColor: Cesium.Color.WHITE,
                  outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                  outlineWidth: 2,
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  pixelOffset: new Cesium.Cartesian2(0, -size - 4),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
              });
            }),
          );
        } else {
          clearLayer('population');
        }
      },
      { fireImmediately: true },
    );

    // ============ 温度数据图层（异步） ============
    let temperatureCancelled = false;
    const unsubTemperature = useGeographyStore.subscribe(
      (s) => s.data.temperature,
      async (visible) => {
        if (!visible) {
          clearLayer('temperature');
          return;
        }
        if (entities['temperature'] && entities['temperature'].length > 0) return;
        await ensureLayerAsync('temperature', async (viewer) => {
          const results = await Promise.all(getCities().slice(0, 10).map((c) => fetchTemperature(c)));
          if (temperatureCancelled || !useGeographyStore.getState().data.temperature) return null;
          return results.map((t) => {
            // 温度越高颜色越红
            const color = t.annualAvg >= 20
              ? Cesium.Color.fromBytes(239, 68, 68, 230)
              : t.annualAvg >= 10
                ? Cesium.Color.fromBytes(251, 191, 36, 230)
                : Cesium.Color.fromBytes(56, 189, 248, 230);
            return viewer.entities.add({
              id: `temp-${t.city}`,
              position: Cesium.Cartesian3.fromDegrees(t.lon, t.lat),
              point: {
                pixelSize: Math.max(8, Math.min(18, Math.abs(t.annualAvg) + 8)),
                color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1.5,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              label: {
                text: `${t.city} ${t.annualAvg}℃`,
                font: '11px Noto Sans SC',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -16),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          });
        });
      },
      { fireImmediately: true },
    );

    // ============ 降水数据图层（异步） ============
    let precipitationCancelled = false;
    const unsubPrecipitation = useGeographyStore.subscribe(
      (s) => s.data.precipitation,
      async (visible) => {
        if (!visible) {
          clearLayer('precipitation');
          return;
        }
        if (entities['precipitation'] && entities['precipitation'].length > 0) return;
        await ensureLayerAsync('precipitation', async (viewer) => {
          const results = await Promise.all(getCities().slice(0, 10).map((c) => fetchPrecipitation(c)));
          if (precipitationCancelled || !useGeographyStore.getState().data.precipitation) return null;
          return results.map((p) => {
            // 降水越多颜色越蓝
            const color = p.annualTotal >= 1200
              ? Cesium.Color.fromBytes(37, 99, 235, 230)
              : p.annualTotal >= 600
                ? Cesium.Color.fromBytes(96, 165, 250, 230)
                : Cesium.Color.fromBytes(251, 191, 36, 230);
            return viewer.entities.add({
              id: `precip-${p.city}`,
              position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
              point: {
                pixelSize: Math.max(8, Math.min(20, p.annualTotal / 100)),
                color,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1.5,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
              label: {
                text: `${p.city} ${p.annualTotal}mm`,
                font: '11px Noto Sans SC',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromBytes(10, 15, 26, 220),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -16),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          });
        });
      },
      { fireImmediately: true },
    );

    // ============ 标签 LOD + 2D 旋转守卫 ============
    // §2.6 8 tier LOD 预算 + 重叠贪婪避让（不做真实 bbox 近似，直接用相机高度阈值分 tier；§2.2 2D 时若开启旋转态守卫，store.astronomy.rotation=false
    const scheduleLOD = (() => {
      try {
        const ctrl0 = getController();
        if (!ctrl0) return undefined;
        const viewer = ctrl0.getViewer();
        // Q2 关键加固：viewer / scene / postRender 未就绪时跳过，避免 "Cannot read properties of undefined (reading 'scene')"
        if (!viewer || !viewer.scene || !viewer.scene.postRender) return undefined;
        const tickListener = viewer.scene.postRender.addEventListener(() => {
          try { applyLabelLOD(viewer, entities); } catch { /* 每帧回调内永不抛错 */ }
        });
        const storeModeUnsub = useGeographyStore.subscribe(
          (s) => s.viewMode,
          (mode) => {
            const prev = lastModeRef.current;
            lastModeRef.current = mode;
            if (mode === '2d' && prev !== '2d') {
              // 2D 模式下禁止自转：store 端写一次 + controller 执行一次 setRotation(false, 0)
              const cur = useGeographyStore.getState().astronomy.rotation;
              if (cur) {
                try {
                  const s = useGeographyStore.getState() as unknown as { setAstronomy?: (p: Partial<{ rotation: boolean }>) => void };
                  if (s.setAstronomy) s.setAstronomy({ rotation: false });
                  else useGeographyStore.setState({ astronomy: { ...useGeographyStore.getState().astronomy, rotation: false } });
                } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1054', (e as any)?.message ?? e); }
              }
              try {
                // CesiumController 暴露的是 setRotation(enabled, speed)
                const c = ctrl0 as unknown as { setRotation: (en: boolean, sp: number) => void };
                c.setRotation(false, 0);
              } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1060', (e as any)?.message ?? e); }
            }
          },
          { fireImmediately: true },
        );
        return () => {
          try { tickListener(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1066', (e as any)?.message ?? e); }
          try { storeModeUnsub?.(); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1067', (e as any)?.message ?? e); }
        };
      } catch (e) {
        // Q2 关键：scheduleLOD 构建失败永不冒泡到组件挂载异常（否则整个图层同步崩）
        console.warn('[CesiumLayerSync] scheduleLOD init fail, skip LOD:', e);
        return undefined;
      }
    })();
    if (scheduleLOD) lodHandleRef.current = scheduleLOD;
    // 立即执行一次 LOD 应用，保证图层刚添加的标签不会刷空白
    queueMicrotask(() => {
      try {
        const c = getController();
        if (!c) return;
        const v = c.getViewer();
        // 关键：viewer / scene / canvas / camera 任一缺失就跳过（Cesium 内部初始化时序）
        if (!v || !v.scene || !v.canvas || !v.camera) return;
        applyLabelLOD(v, entities);
      } catch (e) {
        console.warn('[CesiumLayerSync] initial LOD apply skip:', e);
      }
    });

    return () => {
      unsubCities();
      unsubRivers();
      unsubPlates();
      unsubGraticule();
      unsubDateLine();
      unsubLabels();
      unsubBasemapForLabels();
      unsubWeather();
      unsubEarthquake();
      unsubNaturalEvents();
      unsubClimateZones();
      unsubMountains();
      unsubAdminBounds();
      unsubOceanCurrents();
      unsubMonsoonWinds();
      unsubGdp();
      unsubPopulation();
      unsubTemperature();
      unsubPrecipitation();
      // 标签 LOD + 2D 旋转守卫清理
      if (lodHandleRef.current) {
        lodHandleRef.current();
        lodHandleRef.current = null;
      }
      // 取消异步抓取
      weatherCancelled = true;
      earthquakeCancelled = true;
      naturalEventsCancelled = true;
      temperatureCancelled = true;
      precipitationCancelled = true;
      // 卸载时清理所有实体
      Object.keys(entities).forEach(clearLayer);
    };
  }, []);

  return null;
}

// ============================================================
// §2.6 标签 LOD / 重叠贪婪避让
// 说明：
//   1) 每标签附加 labelMeta（layerKind + priority + maxVisibleHeight）
//   2) applyLabelLOD 在 camera move 后按 8 tier 预算，按 priority 优先，
//      其余通过 show=false 临时隐藏（不清空实体）
//   3) 同时对屏幕空间重叠做贪婪避让（近似，max 3 次 offset 偏移）
// ============================================================

interface LabelMeta {
  /** 图层种类：用于 tier 预算分类 */
  layerKind: 'city' | 'mountain' | 'river' | 'climate' | 'admin' | 'ocean' | 'monsoon' | 'data' | 'weather' | 'quake' | 'event' | 'gdp' | 'pop' | 'temp' | 'precip';
  /** 优先级数字，越大越优先显示 */
  priority: number;
  /** 高于此相机高度（米）时标签隐藏，实现远距离自动隐藏次要标签 */
  maxVisibleHeightMeters: number;
  /** 初始 pixelOffset（备份） */
  baseOffset: Cesium.Cartesian2;
  /** 该标签大致的像素尺寸（宽高近似，按字号估算） */
  approxPxW: number;
  approxPxH: number;
}

const LABEL_META_KEY = Symbol.for('earth.labelMeta');

type LabelLayerKind = LabelMeta['layerKind'];

/** 图层 ID 前缀 → 标签元数据默认值（在实体创建后"回填"，避免对每条 viewer.entities.add 做外科手术修改） */
const LAYER_META_TEMPLATE: Record<LabelLayerKind, {
  match: (entityId: string) => boolean;
  priority: number;
  maxVisibleHeightMeters: number;
  approxPxW: number;
  approxPxH: number;
}> = {
  city: { match: (id) => id.startsWith('city-'), priority: 70, maxVisibleHeightMeters: 8_000_000, approxPxW: 78, approxPxH: 20 },
  mountain: { match: (id) => id.startsWith('mountain-'), priority: 75, maxVisibleHeightMeters: 10_000_000, approxPxW: 120, approxPxH: 20 },
  river: { match: (id) => id.startsWith('river-'), priority: 55, maxVisibleHeightMeters: 12_000_000, approxPxW: 72, approxPxH: 20 },
  climate: { match: (id) => id.startsWith('climate-label-'), priority: 65, maxVisibleHeightMeters: 20_000_000, approxPxW: 120, approxPxH: 20 },
  admin: { match: (id) => id.startsWith('admin-label-'), priority: 50, maxVisibleHeightMeters: 10_000_000, approxPxW: 60, approxPxH: 20 },
  ocean: { match: (id) => id.startsWith('current-label-'), priority: 52, maxVisibleHeightMeters: 15_000_000, approxPxW: 110, approxPxH: 20 },
  monsoon: { match: (id) => id.startsWith('monsoon-label-'), priority: 48, maxVisibleHeightMeters: 12_000_000, approxPxW: 90, approxPxH: 20 },
  data: { match: () => false, priority: 40, maxVisibleHeightMeters: 22_000_000, approxPxW: 80, approxPxH: 34 },
  weather: { match: (id) => id.startsWith('weather-'), priority: 72, maxVisibleHeightMeters: 10_000_000, approxPxW: 150, approxPxH: 20 },
  quake: { match: (id) => id.startsWith('quake-'), priority: 78, maxVisibleHeightMeters: 12_000_000, approxPxW: 46, approxPxH: 18 },
  event: { match: (id) => id.startsWith('event-'), priority: 66, maxVisibleHeightMeters: 14_000_000, approxPxW: 140, approxPxH: 18 },
  gdp: { match: (id) => id.startsWith('gdp-'), priority: 60, maxVisibleHeightMeters: 22_000_000, approxPxW: 110, approxPxH: 34 },
  pop: { match: (id) => id.startsWith('pop-'), priority: 58, maxVisibleHeightMeters: 22_000_000, approxPxW: 110, approxPxH: 34 },
  temp: { match: (id) => id.startsWith('temp-'), priority: 68, maxVisibleHeightMeters: 12_000_000, approxPxW: 110, approxPxH: 20 },
  precip: { match: (id) => id.startsWith('precip-'), priority: 62, maxVisibleHeightMeters: 12_000_000, approxPxW: 120, approxPxH: 20 },
};

/**
 * 为某个图层下已添加的实体，基于 entity.id 前缀回填 label 元数据。
 * 避免了对每个 viewer.entities.add(...) 的大段重复性 edit。
 */
function backfillLabelMeta(layer: Cesium.Entity[]): void {
  if (!layer || layer.length === 0) return;
  for (const ent of layer) {
    if (!ent?.label) continue;
    const id = ent.id ?? '';
    // 日界线单实体特殊判定
    if (id === 'date-line-180') {
      const lbl = ent.label as unknown as { pixelOffset?: Cesium.Cartesian2 };
      attachLabelMeta(ent, {
        layerKind: 'event', // 复用 event bucket，数量少不冲突
        priority: 45,
        maxVisibleHeightMeters: 20_000_000,
        approxPxW: 42,
        approxPxH: 20,
        offset: lbl.pixelOffset ?? new Cesium.Cartesian2(20, 0),
      });
      continue;
    }
    for (const [kind, t] of Object.entries(LAYER_META_TEMPLATE)) {
      if (t.match(id)) {
        const lbl = ent.label as unknown as { pixelOffset?: Cesium.Cartesian2 };
        attachLabelMeta(ent, {
          layerKind: kind as LabelLayerKind,
          priority: t.priority,
          maxVisibleHeightMeters: t.maxVisibleHeightMeters,
          approxPxW: t.approxPxW,
          approxPxH: t.approxPxH,
          offset: lbl.pixelOffset ?? new Cesium.Cartesian2(0, -14),
        });
        break;
      }
    }
  }
}


function setMeta(e: Cesium.Entity, m: LabelMeta): void {
  // 直接挂到 entity 上，不破坏 id/name，Cesium 容忍自定义属性
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any)[LABEL_META_KEY] = m;
}
function getMeta(e: Cesium.Entity): LabelMeta | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((e as any)[LABEL_META_KEY] as LabelMeta) ?? null;
}

/** build 标签 entity 时调用，写入 LOD 元数据 */
function attachLabelMeta(
  entity: Cesium.Entity,
  cfg: Omit<LabelMeta, 'baseOffset'> & { offset?: Cesium.Cartesian2 },
): Cesium.Entity {
  const offset = cfg.offset ?? new Cesium.Cartesian2(0, -14);
  setMeta(entity, {
    layerKind: cfg.layerKind,
    priority: cfg.priority,
    maxVisibleHeightMeters: cfg.maxVisibleHeightMeters,
    baseOffset: Cesium.Cartesian2.clone(offset),
    approxPxW: cfg.approxPxW,
    approxPxH: cfg.approxPxH,
  });
  return entity;
}

/** §2.6 八档预算（单位：标签数量），按优先级依次占满 */
const LOD_TIER_BUDGET: Record<LabelMeta['layerKind'], number> = {
  city: 22,       // 城市/省会类
  mountain: 14,   // 山脉/山峰
  river: 8,       // 河流名
  climate: 6,     // 气候带
  admin: 12,      // 行政区
  ocean: 8,       // 洋流
  monsoon: 6,     // 季风
  data: 16,       // 抽象数据（GDP/人口/降水/温度合并上限）
  weather: 12,    // 天气
  quake: 14,      // 地震
  event: 10,      // 自然事件
  gdp: 10,        // GDP
  pop: 10,        // 人口
  temp: 8,        // 温度
  precip: 8,      // 降水
};

/**
 * LOD 档位：相机高度越高，预算越小（global 视角隐藏次要标签）
 * 返回一个按 layerKind 缩放的乘法因子（0.25 ~ 1.0）
 */
function tierScaleForCameraHeight(heightMeters: number): number {
  if (heightMeters <= 400_000) return 1;        // 省域级：满预算
  if (heightMeters <= 2_000_000) return 0.85;   // 中国级
  if (heightMeters <= 8_000_000) return 0.6;    // 东亚级
  if (heightMeters <= 20_000_000) return 0.4;   // 半球
  return 0.25;                                   // 全球
}

/**
 * 主 LOD 应用入口，在 scene postRender 调用。
 * - 扫描全部 labels（含 layer 元数据）
 * - 先按相机高度筛 maxVisibleHeightMeters（height 过高直接 show=false）
 * - 再按 layerKind × tierScale 预算裁剪
 * - 同图层内按 priority 高者先保留，再做屏幕空间重叠的 3 次 offset 贪婪避让
 */
function applyLabelLOD(viewer: Cesium.Viewer, layerEntities: Record<string, Cesium.Entity[]>): void {
  // Q2 关键加固：viewer / camera / scene / canvas 任一缺失，立即返回不抛错
  if (!viewer) return;
  const cam = viewer.camera;
  const scene = viewer.scene;
  const canvas = viewer.canvas;
  const clock = viewer.clock;
  if (!cam || !scene || !canvas || !clock) return;

  // 估计相机高度（椭球上最近表面距离，够 LOD 用；不需要精确到地形高度）
  let carto: Cesium.Cartographic | undefined;
  try {
    carto = Cesium.Cartographic.fromCartesian(cam.positionWC);
  } catch { return; }
  if (!carto || !Number.isFinite(carto.height)) return;

  const h = Math.max(0, carto.height);
  let scale = tierScaleForCameraHeight(h);
  // 乘以 AdaptiveDegrader 全局系数（tier2/3 进一步压缩预算）
  try {
    const f = (window as unknown as { _labelLODFactor?: number })._labelLODFactor;
    if (typeof f === 'number' && f > 0) scale *= f;
  } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1308', (e as any)?.message ?? e); }

  // 收集图层内有标签的实体（按 layerKind bucket）
  const buckets = new Map<LabelMeta['layerKind'], Array<{ e: Cesium.Entity; meta: LabelMeta }>>();
  const allWithLabel: Array<{ e: Cesium.Entity; meta: LabelMeta }> = [];

  // 遍历当前所有活跃图层实体
  for (const list of Object.values(layerEntities)) {
    if (!list || list.length === 0) continue;
    for (const ent of list) {
      if (!ent?.label) continue;
      const meta = getMeta(ent);
      if (!meta) continue;
      allWithLabel.push({ e: ent, meta });
      const arr = buckets.get(meta.layerKind);
      if (arr) arr.push({ e: ent, meta });
      else buckets.set(meta.layerKind, [{ e: ent, meta }]);
    }
  }

  // 先做高度隐藏 + 恢复 base offset（避免上一次 dodge 偏移堆积）
  for (const { e, meta } of allWithLabel) {
    const hideByHeight = h > meta.maxVisibleHeightMeters;
    // Cesium label.show 可能是 ConstantProperty，也可能不是，统一用 isScalar= true? 统一写
    const lbl = e.label!;
    if (lbl.show !== undefined) {
      // Cesium Property 在赋值为 boolean 常量时通常自动包一层
      try { (lbl as any).show = !hideByHeight; } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1335', (e as any)?.message ?? e); }
    }
    // 清 pixelOffset 到 base
    if (lbl.pixelOffset !== undefined) {
      try { (lbl as any).pixelOffset = Cesium.Cartesian2.clone(meta.baseOffset); } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1339', (e as any)?.message ?? e); }
    }
  }

  // 按 layer 预算裁剪：priority 从大到小，超出预算标记 show=false
  buckets.forEach((arr, kind) => {
    const budget = Math.max(1, Math.round(LOD_TIER_BUDGET[kind] * scale));
    if (arr.length <= budget) return;
    arr.sort((a, b) => b.meta.priority - a.meta.priority);
    for (let i = budget; i < arr.length; i++) {
      try { ((arr[i].e.label as any).show) = false; } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1349', (e as any)?.message ?? e); }
    }
  });

  // 在当前视口内做"屏幕空间"近似重叠避让（Cesium 投影转 pixel，只对 show=true 生效）
  // 注意：此过程在 postRender 里，若相机变化不大代价低，约 N*K 次比较（N 数百，K≈3 次 offset）
  const keptVisible: Array<{ cx: number; cy: number; w: number; h: number }> = [];
  const W = canvas.clientWidth ?? 0;
  const H = canvas.clientHeight ?? 0;
  if (W <= 0 || H <= 0) return;

  // 先按可见性 + priority 稳定排序
  const sortedForDodge = allWithLabel
    .filter((x) => {
      // 二次确认 show = true
      try {
        const s = (x.e.label as any).show;
        if (s === false) return false;
      } catch { return false; }
      return !x.meta || h <= x.meta.maxVisibleHeightMeters;
    })
    .sort((a, b) => b.meta.priority - a.meta.priority);

  for (const item of sortedForDodge) {
    if (!item.e.position) continue;
    // position 是 ConstantPositionProperty/Property；取当前时间的值（若为 undefined 跳过）
    let pos: Cesium.Cartesian3 | undefined;
    try {
      const p = item.e.position as unknown as { getValue?: (t: Cesium.JulianDate) => Cesium.Cartesian3 | undefined };
      if (p && typeof p.getValue === 'function') pos = p.getValue(clock.currentTime);
      // 若失败退化：尝试直接强制类型转
      if (!pos) pos = item.e.position as unknown as Cesium.Cartesian3;
    } catch { pos = undefined; }
    if (!pos) continue;
    // 投影到像素（世界 → 窗口）。优先 API 暴露的 SceneTransforms.worldToWindowCoordinates，
    // 若 Cesium 版本提供 wgs84ToWindowCoordinates 则后者是更精确的别名；二者择一。
    let windowCoord: Cesium.Cartesian2 | undefined;
    const st = Cesium.SceneTransforms as unknown as {
      worldToWindowCoordinates?: (s: Cesium.Scene, p: Cesium.Cartesian3, r?: Cesium.Cartesian2) => Cesium.Cartesian2 | undefined;
      wgs84ToWindowCoordinates?: (s: Cesium.Scene, p: Cesium.Cartesian3, r?: Cesium.Cartesian2) => Cesium.Cartesian2 | undefined;
    };
    try {
      if (typeof st.wgs84ToWindowCoordinates === 'function') {
        windowCoord = st.wgs84ToWindowCoordinates(scene, pos);
      } else if (typeof st.worldToWindowCoordinates === 'function') {
        windowCoord = st.worldToWindowCoordinates(scene, pos);
      }
    } catch { windowCoord = undefined; }
    if (!windowCoord) continue;
    // label 在点上方偏移 baseOffset.y 像素，近似中心
    const pxW = item.meta.approxPxW;
    const pxH = item.meta.approxPxH;
    let cx = windowCoord.x + item.meta.baseOffset.x;
    let cy = windowCoord.y + item.meta.baseOffset.y - pxH / 2;
    // 边界裁剪（标签中心完全在画布外也跳过不检查）
    if (cx < -pxW || cx > W + pxW || cy < -pxH || cy > H + pxH) continue;
    // 贪婪避让：最大 3 个偏移位置（上/下/右）
    const offsets = [
      { x: 0, y: 0 },
      { x: 0, y: -pxH - 6 },
      { x: pxW / 2 + 10, y: 0 },
      { x: 0, y: pxH + 6 },
    ];
    let placed = false;
    for (let o = 0; o < offsets.length; o++) {
      const ox = offsets[o].x;
      const oy = offsets[o].y;
      const rx = cx + ox - pxW / 2;
      const ry = cy + oy - pxH / 2;
      let collide = false;
      for (let k = 0; k < keptVisible.length; k++) {
        const r = keptVisible[k];
        const ax0 = r.cx - r.w / 2, ax1 = r.cx + r.w / 2;
        const ay0 = r.cy - r.h / 2, ay1 = r.cy + r.h / 2;
        const bx0 = rx, bx1 = rx + pxW;
        const by0 = ry, by1 = ry + pxH;
        // 任意方向不相交即可：AABB 相交反演
        const overlap = !(ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0);
        if (overlap) { collide = true; break; }
      }
      if (!collide) {
        placed = true;
        keptVisible.push({ cx: cx + ox, cy: cy + oy, w: pxW, h: pxH });
        if (o !== 0 && item.e.label) {
          try {
            const lbl = item.e.label as any;
            lbl.pixelOffset = new Cesium.Cartesian2(
              item.meta.baseOffset.x + ox,
              item.meta.baseOffset.y + oy,
            );
          } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1439', (e as any)?.message ?? e); }
        }
        break;
      }
    }
    if (!placed) {
      // 3 次都冲突 → 隐藏（避免文字叠在一起）
      try { ((item.e.label as any).show) = false; } catch (e) { console.warn('[EmptyCatch] cesium/CesiumLayerSync.tsx:1446', (e as any)?.message ?? e); }
    }
  }
}

/** 国家 ISO3 → 大致经纬度质心（用于 GDP/人口气泡定位） */
function getCountryCenter(iso3: string): { lon: number; lat: number } {
  const centers: Record<string, { lon: number; lat: number }> = {
    CHN: { lon: 104, lat: 35 },
    USA: { lon: -98, lat: 39 },
    JPN: { lon: 138, lat: 36 },
    DEU: { lon: 10, lat: 51 },
    IND: { lon: 78, lat: 22 },
    GBR: { lon: -2, lat: 54 },
    FRA: { lon: 2, lat: 46 },
    BRA: { lon: -52, lat: -10 },
    RUS: { lon: 90, lat: 60 },
    AUS: { lon: 134, lat: -25 },
    IDN: { lon: 113, lat: -2 },
    PAK: { lon: 69, lat: 30 },
    NGA: { lon: 8, lat: 10 },
    BGD: { lon: 90, lat: 24 },
  };
  return centers[iso3] ?? { lon: 0, lat: 0 };
}
