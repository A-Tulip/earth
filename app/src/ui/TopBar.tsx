/**
 * TopBar —— 顶部极简栏
 *
 * 左上角：产品名称"地球探索者" + 当前课程主题
 * 中上：城市搜索框（点击放大镜展开）
 * 右上角：课程入口、声音状态、全屏、帮助
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useGeographyStore } from '../state/store';
import { commandBus } from '../commands/bus';
import { BookOpen, Mic, MicOff, Maximize, Globe, Sun, Camera, Search, X, MapPin } from './icons';
import { searchCities, type CityData } from '../data/providers';

interface TopBarProps {
  onOpenCommandMenu: () => void;
  onToggleMute: () => void;
  onOpenHelp?: () => void;
}

export function TopBar({ onOpenCommandMenu, onToggleMute, onOpenHelp }: TopBarProps) {
  const lesson = useGeographyStore((s) => s.lesson);
  const voice = useGeographyStore((s) => s.voice);
  const solarSystemActive = useGeographyStore((s) => s.solarSystemActive);

  // 城市搜索状态
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CityData[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 输入变化时搜索（防抖）
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setHighlightIdx(0);
      return;
    }
    const timer = setTimeout(() => {
      setResults(searchCities(query, 8));
      setHighlightIdx(0);
    }, 120);
    return () => clearTimeout(timer);
  }, [query]);

  // 选中城市并飞行定位
  const selectCity = useCallback((city: CityData) => {
    commandBus.execute({
      name: 'camera.flyTo',
      args: {
        longitude: city.lon,
        latitude: city.lat,
        height: 500000,
        duration: 2.0,
      },
    });
    setSearchOpen(false);
    setQuery('');
    setResults([]);
  }, []);

  // 搜索框键盘导航
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[highlightIdx]) {
      e.preventDefault();
      selectCity(results[highlightIdx]);
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
      setQuery('');
      setResults([]);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="pointer-events-none fixed top-0 left-0 right-0 z-20 flex items-start justify-between p-4">
      {/* 左上角：产品名称 + 课程主题 */}
      <div className="pointer-events-auto">
        <h1 className="text-base font-medium text-white/90">
          地球探索者
          {lesson.activeLessonId && lesson.stepTitle && (
            <span className="ml-2 text-sm font-light text-geo-300">
              · {lesson.stepTitle}
            </span>
          )}
        </h1>
      </div>

      {/* 中上：城市搜索框（仅地球视图可用） */}
      <div className="pointer-events-auto relative">
        {searchOpen ? (
          <div className="relative">
            <div className="flex items-center gap-1.5 rounded-lg bg-ink-800/90 px-2.5 py-1.5 ring-1 ring-geo-500/40 backdrop-blur-sm">
              <Search className="h-4 w-4 text-white/50" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="搜索城市，如 北京/东京/纽约"
                autoFocus
                className="w-56 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
              />
              <button
                onClick={() => { setSearchOpen(false); setQuery(''); setResults([]); }}
                className="text-white/40 hover:text-white/80"
                title="关闭搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* 搜索结果下拉 */}
            {results.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto rounded-lg bg-ink-800/95 py-1 text-sm backdrop-blur-md ring-1 ring-geo-500/20">
                {results.map((c, idx) => (
                  <button
                    key={`${c.name}-${idx}`}
                    onClick={() => selectCity(c)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                      idx === highlightIdx ? 'bg-geo-500/20 text-geo-300' : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="flex-1">{c.name}</span>
                    <span className="text-xs text-white/40">{c.country}</span>
                    {c.population && (
                      <span className="text-xs text-white/30">{c.population}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {/* 无结果提示 */}
            {query.trim() && results.length === 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-lg bg-ink-800/95 px-3 py-2 text-sm text-white/50 backdrop-blur-md ring-1 ring-geo-500/20">
                未找到匹配的城市
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => { setSearchOpen(true); }}
            disabled={solarSystemActive}
            className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 backdrop-blur-sm transition-all ${
              solarSystemActive
                ? 'bg-ink-800/40 text-white/20 ring-white/5 cursor-not-allowed'
                : 'bg-ink-800/80 text-white/80 ring-geo-500/20 hover:bg-ink-700/80 hover:text-white'
            }`}
            title={solarSystemActive ? '太阳系视图不支持搜索' : '搜索城市'}
          >
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 右上角：操作按钮 */}
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          onClick={onOpenCommandMenu}
          className="flex items-center gap-1.5 rounded-lg bg-ink-800/80 px-3 py-1.5 text-sm text-white/80 ring-1 ring-geo-500/20 backdrop-blur-sm hover:bg-ink-700/80 hover:text-white transition-all"
        >
          <BookOpen className="h-4 w-4" />
          <span>课程</span>
        </button>

        <button
          onClick={() => commandBus.execute({
            name: solarSystemActive ? 'view.showEarth' : 'view.showSolarSystem',
            args: {},
          })}
          className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 backdrop-blur-sm transition-all ${
            solarSystemActive
              ? 'bg-geo-500/20 text-geo-300 ring-geo-500/40'
              : 'bg-ink-800/80 text-white/80 ring-geo-500/20 hover:bg-ink-700/80 hover:text-white'
          }`}
          title={solarSystemActive ? '返回地球' : '太阳系视图'}
        >
          {solarSystemActive ? <Globe className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>

        {/* 截图按钮（仅地球视图可用，太阳系视图禁用） */}
        <button
          onClick={() => commandBus.execute({ name: 'camera.screenshot', args: {} })}
          disabled={solarSystemActive}
          className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 backdrop-blur-sm transition-all ${
            solarSystemActive
              ? 'bg-ink-800/40 text-white/20 ring-white/5 cursor-not-allowed'
              : 'bg-ink-800/80 text-white/80 ring-geo-500/20 hover:bg-ink-700/80 hover:text-white'
          }`}
          title={solarSystemActive ? '太阳系视图暂不支持截图' : '截图保存当前画面'}
        >
          <Camera className="h-4 w-4" />
        </button>

        <button
          onClick={onToggleMute}
          className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 backdrop-blur-sm transition-all ${
            voice.muted
              ? 'bg-ink-800/80 text-white/40 ring-white/10'
              : 'bg-ink-800/80 text-geo-300 ring-geo-500/20'
          }`}
          title={voice.muted ? '取消静音' : '静音'}
        >
          {voice.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>

        <button
          onClick={toggleFullscreen}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-800/80 text-white/80 ring-1 ring-geo-500/20 backdrop-blur-sm hover:bg-ink-700/80 hover:text-white transition-all"
          title="全屏"
        >
          <Maximize className="h-4 w-4" />
        </button>

        {/* 帮助按钮 */}
        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-800/80 text-white/80 ring-1 ring-geo-500/20 backdrop-blur-sm hover:bg-ink-700/80 hover:text-white transition-all"
            title="按键说明（? 键打开）"
          >
            <span className="text-sm font-bold leading-none">?</span>
          </button>
        )}
      </div>
    </div>
  );
}
