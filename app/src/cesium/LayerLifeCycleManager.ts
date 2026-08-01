/**
 * LayerLifeCycleManager —— §0 图层生命周期调度门
 *
 * 所有「会改 Cesium Viewer 资源」的代码（切 2D/3D、切底图、改 globe.material、
 * 增删标注实体、增删数据图层）必须通过此 Manager.schedule() 进入，禁止直接调
 * Cesium API。此约束的目标：
 *   1) morph 期间不切图层（Cesium 老坑，必崩）；
 *   2) 同类操作互斥（旧操作会被 AbortSignal 取消）；
 *   3) globe.material 下的 Cesium.Texture 被显式 destroy()，不依赖 GC；
 *   4) 任何 run() 抛错不冒泡白屏，保留上一个成功态并上报 scene.ui.lastLayerError。
 */
import * as Cesium from 'cesium';
import { useGeographyStore } from '../state/store';

export type OpKind =
  | 'sceneMode'
  | 'basemap'
  | 'globeMaterial'
  | 'annotations'
  | 'entities'
  | 'dataLayer';

export type BusyMap = Record<OpKind, boolean>;

interface PendingOp {
  kind: OpKind;
  run: (signal: AbortSignal) => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  controller: AbortController;
}

type Snapshot = Partial<Record<OpKind, unknown>>;

const ALL_KINDS: OpKind[] = [
  'sceneMode',
  'basemap',
  'globeMaterial',
  'annotations',
  'entities',
  'dataLayer',
];

export class LayerLifeCycleManager {
  private readonly viewer: Cesium.Viewer;
  private readonly busy: BusyMap = Object.fromEntries(ALL_KINDS.map((k) => [k, false])) as BusyMap;
  private readonly subs = new Set<(b: BusyMap) => void>();
  private readonly queue: PendingOp[] = [];
  private readonly prevState: Snapshot = {};
  private sceneMorphing = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  /**
   * 调度一个破坏性操作。
   * 同类上一个操作仍在跑 → 新的先排队；sceneMode morphing 期间其它 kind 全部延后。
   * run 内若抛错，Manager 吞掉错误并回滚，返回 undefined 给调用方。
   */
  async schedule<T>(
    kind: OpKind,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    const mustEnqueue =
      (this.sceneMorphing && kind !== 'sceneMode') ||
      this.busy[kind];
    if (mustEnqueue) {
      return new Promise<T | undefined>((resolve) => {
        const controller = new AbortController();
        this.queue.push({
          kind,
          run: run as (s: AbortSignal) => Promise<unknown>,
          resolve: resolve as (v: unknown) => void,
          reject: () => {},
          controller,
        });
      });
    }
    return this.runOne({
      kind,
      run: run as (s: AbortSignal) => Promise<unknown>,
      resolve: () => {},
      reject: () => {},
      controller: new AbortController(),
    }) as Promise<T | undefined>;
  }

  /** UI：按钮禁用。'all' 表示任意 kind 还在跑就返回 true */
  isBusy(kind: OpKind | 'all'): boolean {
    if (kind === 'all') return ALL_KINDS.some((k) => this.busy[k]);
    return this.busy[kind];
  }

  /** React hook 用：订阅 busy 位图变化 */
  subscribe(cb: (b: BusyMap) => void): () => void {
    this.subs.add(cb);
    cb({ ...this.busy });
    return () => this.subs.delete(cb);
  }

  /** CesiumCanvas 在 morphTo* 前调用，阻塞其余 kind */
  notifyMorphStart(): void {
    this.sceneMorphing = true;
    this.setBusy('sceneMode', true);
  }

  /** CesiumCanvas 在 morphComplete 回调里调用：解除阻塞，释放排队操作 */
  notifyMorphComplete(): void {
    this.sceneMorphing = false;
    this.setBusy('sceneMode', false);
    void this.drainQueue();
  }

  /* ========== PRIVATE ========== */

  private setBusy(kind: OpKind, v: boolean): void {
    if (this.busy[kind] === v) return;
    this.busy[kind] = v;
    const snap = { ...this.busy };
    this.subs.forEach((cb) => cb(snap));
  }

  private async runOne(op: PendingOp): Promise<unknown> {
    this.setBusy(op.kind, true);
    try {
      // 0.2 Rule 1: Cleanup → 下一帧 → Apply
      await this.cleanupBeforeRun(op.kind);
      await this.nextFrameRender();
      if (op.controller.signal.aborted) {
        op.resolve(undefined);
        this.setBusy(op.kind, false);
        void this.drainQueue();
        return undefined;
      }
      const result = await op.run(op.controller.signal);
      // 0.2 Rule 4: snapshot for rollback
      this.prevState[op.kind] = this.snapshotKind(op.kind);
      op.resolve(result);
      this.setBusy(op.kind, false);
      void this.drainQueue();
      return result;
    } catch (err) {
      console.warn('[LayerLifeCycleManager] rollback', op.kind, err);
      try {
        await this.rollbackKind(op.kind);
      } catch (_rollbackErr) {
        // ignore rollback failure, still report UI error
      }
      this.reportUiError(op.kind, err as Error);
      op.resolve(undefined); // never reject — white-screen protection
      this.setBusy(op.kind, false);
      void this.drainQueue();
      return undefined;
    }
  }

  private async drainQueue(): Promise<void> {
    let guard = 0;
    while (!this.sceneMorphing && this.queue.length > 0 && guard < 256) {
      guard++;
      const sceneIdx = this.queue.findIndex((o) => o.kind === 'sceneMode');
      const idx = sceneIdx >= 0 ? sceneIdx : 0;
      const next = this.queue.splice(idx, 1)[0];
      if (!next) break;
      if (next.controller.signal.aborted) {
        next.resolve(undefined);
        continue;
      }
      if (this.busy[next.kind]) {
        this.queue.unshift(next);
        break;
      }
      await this.runOne(next);
    }
  }

  private nextFrameRender(): Promise<void> {
    const viewer = this.viewer;
    return new Promise((resolve) => {
      viewer.scene.requestRender();
      requestAnimationFrame(() => resolve());
    });
  }

  private cleanupBeforeRun(kind: OpKind): Promise<void> {
    // 0.2 Rule 3: 显式销毁 globe.material uniforms 的 Cesium.Texture
    if (kind === 'globeMaterial') {
      const globe = this.viewer.scene.globe as Cesium.Globe & {
        material?: {
          uniforms?: Record<string, unknown>;
        };
      };
      const mat = globe.material;
      if (mat?.uniforms) {
        Object.values(mat.uniforms).forEach((v) => {
          const t = v as { destroy?: () => void; isDestroyed?: () => boolean } | undefined;
          if (t && typeof t.destroy === 'function' && !t.isDestroyed?.()) {
            try { t.destroy(); } catch (_e) { /* noop */ }
          }
        });
      }
      (globe as unknown as { material: unknown }).material = undefined;
    }
    return Promise.resolve();
  }

  private snapshotKind(kind: OpKind): unknown {
    const st = useGeographyStore.getState();
    switch (kind) {
      case 'basemap': return { basemap: st.basemap };
      case 'globeMaterial': return { terrain: { ...st.terrain } };
      case 'annotations': return { annotations: { ...st.annotations } };
      case 'entities': return { astronomy: { ...st.astronomy } };
      case 'dataLayer': return { data: { ...st.data } };
      case 'sceneMode': return { viewMode: st.viewMode };
      default: return undefined;
    }
  }

  private async rollbackKind(kind: OpKind): Promise<void> {
    const snap = this.prevState[kind] as Record<string, unknown> | undefined;
    if (!snap) return;
    const store = useGeographyStore.getState();
    switch (kind) {
      case 'basemap':
        if (typeof snap.basemap === 'string') store.setBasemap(snap.basemap as never);
        break;
      case 'globeMaterial':
        if (snap.terrain) store.setTerrain(snap.terrain as Parameters<typeof store.setTerrain>[0]);
        break;
      case 'annotations':
        if (snap.annotations) {
          Object.entries(snap.annotations as Record<string, boolean>).forEach(([k, v]) =>
            store.toggleAnnotation(k as keyof typeof store.annotations, v),
          );
        }
        break;
      case 'sceneMode':
        if (snap.viewMode) store.setViewMode(snap.viewMode as Parameters<typeof store.setViewMode>[0]);
        break;
      default:
        // entities / dataLayer: use patch
        store.patch(snap as Partial<Parameters<typeof store.patch>[0]>);
    }
    await this.nextFrameRender();
  }

  private reportUiError(kind: OpKind, err: Error): void {
    const store = useGeographyStore.getState();
    const msg = `${kind}: ${err?.message ?? String(err)}`;
    try {
      store.setUI({
        lastLayerError: msg,
        lastLayerErrorAt: new Date().toISOString(),
      } as Parameters<typeof store.setUI>[0]);
    } catch (_e) {
      console.error('[LayerLifeCycleManager]', msg);
    }
  }
}

/* ---------- Singleton holder (CesiumCanvas 注入单例，别处通过 getLayerManager 读取) ---------- */
let _singleton: LayerLifeCycleManager | null = null;
export function setLayerManagerSingleton(m: LayerLifeCycleManager): void {
  _singleton = m;
}
export function getLayerManager(): LayerLifeCycleManager | null {
  return _singleton;
}
