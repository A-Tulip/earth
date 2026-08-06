/**
 * Guidance —— 首次打开时的极轻引导文字
 *
 * "按住空格说出你想观察的地点或知识点"
 * 引导数秒后淡出。
 */

import { useEffect, useState } from 'react';

export function Guidance() {
  // visible: 是否仍在 DOM 中；fading: 是否正在淡出
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    // 存储是否已显示过
    const shown = sessionStorage.getItem('guidance-shown');
    if (shown) {
      setVisible(false);
      return;
    }

    // 6 秒后开始淡出
    const startFade = setTimeout(() => setFading(true), 6000);
    return () => clearTimeout(startFade);
  }, []);

  // 淡出动画结束后再卸载
  const handleTransitionEnd = () => {
    if (fading) {
      setVisible(false);
      sessionStorage.setItem('guidance-shown', '1');
    }
  };

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center transition-opacity duration-1000"
      style={{ opacity: fading ? 0 : 1 }}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="text-center">
        <p className="text-base font-light text-white/60">
          按住空格说出你想观察的地点或知识点
        </p>
        <p className="mt-2 text-xs text-white/30">
          或点击左下角工具坞手动操作
        </p>
      </div>
    </div>
  );
}
