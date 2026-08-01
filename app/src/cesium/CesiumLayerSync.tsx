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

  useEffect(() => {
    const getController = () => commandBus.getContext().cesium;
    const entities = entitiesRef.current;

    /** 清空某图层的所有实体 */
    const clearLayer = (key: string) => {
      const ctrl = getController();
      if (!ctrl) return;
      const list = entities[key];
      if (list) {
        const viewer = ctrl.getViewer();
        list.forEach((e) => viewer.entities.remove(e));
        entities[key] = [];
      }
    };

    /** 添加某图层的实体 */
    const ensureLayer = (key: string, build: (viewer: Cesium.Viewer) => Cesium.Entity[]) => {
      const ctrl = getController();
      if (!ctrl) return;
      if (entities[key] && entities[key].length > 0) return; // 已存在不重复添加
      const viewer = ctrl.getViewer();
      entities[key] = build(viewer);
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
        const ctrl = getController();
        if (!ctrl) return;
        const viewer = ctrl.getViewer();
        if (visible) {
          if (entities['graticule'] && entities['graticule'].length > 0) return;
          const lines: Cesium.Entity[] = [];
          // 经线：每 30 度
          for (let lon = -180; lon <= 180; lon += 30) {
            const positions: number[] = [];
            for (let lat = -80; lat <= 80; lat += 5) {
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
          // 纬线：每 30 度
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
          entities['graticule'] = lines;
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
        const ctrl = getController();
        if (!ctrl) return;
        const viewer = ctrl.getViewer();
        // 并行抓取所有预置城市天气
        const results = await Promise.all(getCities().map((c) => fetchWeather(c)));
        if (weatherCancelled || !useGeographyStore.getState().data.weather) return;
        entities['weather'] = results.map((w) =>
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
        const ctrl = getController();
        if (!ctrl) return;
        const viewer = ctrl.getViewer();
        const quakes = await fetchEarthquakes(4.5);
        if (earthquakeCancelled || !useGeographyStore.getState().data.earthquake) return;
        entities['earthquake'] = quakes.map((q) => {
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
        const ctrl = getController();
        if (!ctrl) return;
        const viewer = ctrl.getViewer();
        const events = await fetchNaturalEvents();
        if (naturalEventsCancelled || !useGeographyStore.getState().data.naturalEvents) return;
        entities['naturalEvents'] = events.slice(0, 50).map((ev, idx) =>
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
        const ctrl = getController();
        if (!ctrl) return;
        const viewer = ctrl.getViewer();
        const results = await Promise.all(getCities().slice(0, 10).map((c) => fetchTemperature(c)));
        if (temperatureCancelled || !useGeographyStore.getState().data.temperature) return;
        entities['temperature'] = results.map((t) => {
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
        const ctrl = getController();
        if (!ctrl) return;
        const viewer = ctrl.getViewer();
        const results = await Promise.all(getCities().slice(0, 10).map((c) => fetchPrecipitation(c)));
        if (precipitationCancelled || !useGeographyStore.getState().data.precipitation) return;
        entities['precipitation'] = results.map((p) => {
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
      },
      { fireImmediately: true },
    );

    return () => {
      unsubCities();
      unsubRivers();
      unsubPlates();
      unsubGraticule();
      unsubDateLine();
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
