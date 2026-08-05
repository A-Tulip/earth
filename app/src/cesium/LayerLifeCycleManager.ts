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
import type { TransientUIState } from '../state/sceneState';

import type { LayerErrorCategory, LayerErrorKind } from '../state/sceneState';

export type OpKind =
  | 'sceneMode'
  | 'basemap'
  | 'terrain'
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
  retryAction?: { name: string; args: Record<string, unknown> } | null;
}

type Snapshot = Partial<Record<OpKind, unknown>>;

// ---------- Q1 错误分类：根据 OpKind + 错误消息文本推断 LayerErrorCategory ----------
function classifyError(kind: OpKind, err: Error): LayerErrorCategory {
  const m = (err?.message ?? '').toLowerCase() + ' ' + (err?.name ?? '').toLowerCase();
  if (/(fetch|network|xhr|xmlhttprequest|net::|failed to load|failed to fetch|load.*image|tile.*error|request failed|connection)/.test(m)) return 'network';
  if (/(404|not found).*resource/.test(m) || m.includes('404 not found')) return 'not_found';
  if (/(401|403|auth|unauthorized|token|key|permission|credential|cors)/.test(m) || /no *'access-control-allow-origin'/.test(m)) return 'auth';
  if (/(408|timeout|timed ?out|abort|took too long|exceeded)/.test(m)) return 'timeout';
  if (/(429|too many|rate ?limit|throttl|quota)/.test(m)) return 'rate_limit';
  if (/(invalid|malformed|bad request|out of range|expected|missing|parameter|argument)/.test(m)) return 'invalid_args';
  // Q2：运行期空引用 / 类型错误 → 归类为 render（渲染过程中 Cesium 对象被提前销毁或未就绪），不再误判为 "资源不存在"
  if (/(render|webgl|shader|canvas|context|draw|typeerror|referenceerror|cannot read|reading|undefined is not|null is not)/.test(m)) return 'render';
  return 'unknown';
}

const OP_TO_KIND: Record<OpKind, LayerErrorKind> = {
  sceneMode: 'sceneMode',
  basemap: 'basemap',
  terrain: 'terrain',
  globeMaterial: 'globeMaterial',
  annotations: 'annotation',
  entities: 'annotation',
  dataLayer: 'data',
};

const ALL_KINDS: OpKind[] = [
  'sceneMode',
  'basemap',
  'terrain',
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
  /** 首帧渲染完成前为 false，此时所有错误静默处理，不弹"渲染失败"弹窗 */
  private initialized = false;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    // 监听首帧渲染完成 → 标记 initialized = true
    try {
      const off = viewer.scene.postRender.addEventListener(() => {
        this.initialized = true;
        try { off(); } catch { /* ignore */ }
      });
      // 兜底：3s 后强制标记为已初始化
      setTimeout(() => { this.initialized = true; }, 3000);
    } catch { /* ignore */ }
  }

  /**
   * 调度一个破坏性操作。
   * 同类上一个操作仍在跑 → 新的先排队；sceneMode morphing 期间其它 kind 全部延后。
   * run 内若抛错，Manager 吞掉错误并回滚，返回 undefined 给调用方。
   */
  async schedule<T>(
    kind: OpKind,
    run: (signal: AbortSignal) => Promise<T>,
    opts?: { retryAction?: { name: string; args: Record<string, unknown> } | null },
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
          retryAction: opts?.retryAction,
        });
      });
    }
    return this.runOne({
      kind,
      run: run as (s: AbortSignal) => Promise<unknown>,
      resolve: () => {},
      reject: () => {},
      controller: new AbortController(),
      retryAction: opts?.retryAction,
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
    // ====== Q2：同步到 store.ui.layerBusy，供 LoadingOverlay 渲染 ======
    // OpKind → store 层名称映射（store 使用简写）
    type StoreKind = NonNullable<keyof TransientUIState['layerBusy']>;
    const KIND_TO_STORE: Partial<Record<OpKind, StoreKind>> = {
      basemap: 'basemap',
      terrain: 'terrain',
      sceneMode: 'sceneMode',
      globeMaterial: 'globeMaterial',
      annotations: 'annotation',
      entities: 'annotation',
      dataLayer: 'data',
    };
    try {
      const st = useGeographyStore.getState();
      // 重新根据当前 snap 构建（每一个 kind 映射后 true/false，合并为一个）
      const next: TransientUIState['layerBusy'] = { ...(st.ui.layerBusy ?? {}) };
      // 先基于 snap 所有 OpKind 更新
      const storeKindsSeen = new Set<StoreKind>();
      for (const opk of ALL_KINDS) {
        const sk = KIND_TO_STORE[opk];
        if (!sk) continue;
        storeKindsSeen.add(sk);
        // 只要任一对应 OpKind 为 true → true
        if (snap[opk]) next[sk] = true;
      }
      // 对已经置 true 的，若所有对应 OpKind 都 false → 置 false
      for (const sk of storeKindsSeen) {
        if (next[sk]) {
          const anyTrue = ALL_KINDS.some((opk) => KIND_TO_STORE[opk] === sk && snap[opk]);
          if (!anyTrue) next[sk] = false;
        }
      }
      // 浅比较
      const prev = st.ui.layerBusy ?? {};
      const prevKeys = Object.keys(prev).filter((k) => prev[k as keyof typeof prev]);
      const nextKeys = Object.keys(next).filter((k) => next[k as keyof typeof next]);
      if (prevKeys.length !== nextKeys.length || nextKeys.some((k) => !prev[k as keyof typeof prev])) {
        useGeographyStore.setState({ ui: { ...st.ui, layerBusy: next } });
      }
    } catch { /* ignore：store 未就绪时跳过 */ }
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
      this.reportUiError(op, err as Error);
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
    // 防御：viewer / scene 未就绪时跳过，避免 "Cannot read properties of undefined (reading 'scene')"
    if (!viewer || !viewer.scene) return Promise.resolve();
    return new Promise((resolve) => {
      try { viewer.scene.requestRender(); } catch { /* noop */ }
      requestAnimationFrame(() => resolve());
    });
  }

  private cleanupBeforeRun(kind: OpKind): Promise<void> {
    const viewer = this.viewer;
    if (!viewer || !viewer.scene || !viewer.scene.globe) return Promise.resolve();
    // 0.2 Rule 3: 显式销毁 globe.material uniforms 的 Cesium.Texture
    if (kind === 'globeMaterial') {
      const globe = viewer.scene.globe as Cesium.Globe & {
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
      case 'terrain': return { terrain: { ...st.terrain } };
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
      case 'terrain':
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

  private reportUiError(op: PendingOp, err: Error): void {
    // 初始化期间（首帧渲染未完成）：所有错误静默处理，不弹"渲染失败"弹窗
    // 这是 "Cannot read properties of undefined (reading 'scene')" 的根因防护
    if (!this.initialized) {
      console.warn('[LayerLifeCycleManager] init-phase error (suppressed):', op.kind, err?.message ?? err);
      return;
    }
    const kind = op.kind;
    const store = useGeographyStore.getState();
    const cat = classifyError(kind, err);
    const uiKind = OP_TO_KIND[kind] ?? 'unknown';
    const msg = `${kind}: ${err?.message ?? String(err)}`;
    // Q1：根据 op.kind 自动推断 retryAction（若调用方没传，基于 snapshot 生成）
    let retryAction = op.retryAction ?? null;
    if (!retryAction) {
      const snap = this.prevState[kind] as Record<string, unknown> | undefined;
      switch (kind) {
        case 'basemap': {
          const bm = snap?.basemap ?? store.basemap;
          retryAction = { name: 'view.setBasemap', args: { basemap: bm } };
          break;
        }
        case 'terrain':
        case 'globeMaterial': {
          const t = snap?.terrain ?? store.terrain;
          retryAction = { name: 'view.setBasemap', args: { basemap: store.basemap } };
          // terrain 没有直接 public 命令，回退到切 basemap 触发 provider 重建
          break;
        }
        case 'sceneMode': {
          const vm = snap?.viewMode ?? store.viewMode;
          retryAction = { name: 'view.setMode', args: { mode: vm } };
          break;
        }
        case 'annotations':
        case 'entities':
        case 'dataLayer':
          // 无通用重放命令，留给调用方指定；此处留 null（UI 上显示"已自动回退"即可）
          retryAction = null;
          break;
      }
    }
    try {
      store.setUI({
        lastLayerError: msg,
        lastLayerErrorAt: new Date().toISOString(),
        lastLayerErrorCategory: cat,
        lastLayerErrorKind: uiKind,
        lastLayerErrorRetryAction: retryAction,
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
