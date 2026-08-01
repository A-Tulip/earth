import { useEffect, useState } from 'react';
import { getLayerManager, type BusyMap, type OpKind } from '../cesium/LayerLifeCycleManager';

/**
 * 订阅 LayerLifeCycleManager 的 busy 位图，返回当前是否忙碌。
 * 用法：
 *   const { busy } = useLayerBusy('all');                // 任何图层类操作
 *   const { busy } = useLayerBusy('basemap','sceneMode');// 指定 kind
 */
export function useLayerBusy(...kinds: (OpKind | 'all')[]): { busy: boolean } {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const mgr = getLayerManager();
    if (!mgr) return;
    const update = (map: BusyMap) => {
      const isBusy = kinds.some((k) =>
        k === 'all' ? Object.values(map).some(Boolean) : map[k as OpKind],
      );
      setBusy(isBusy);
    };
    return mgr.subscribe(update);
  }, [kinds.join(',')]);
  return { busy };
}
