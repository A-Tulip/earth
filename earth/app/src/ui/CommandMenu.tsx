/**
 * CommandMenu —— 右上角课程入口（轻量 Command Menu）
 *
 * 点击右上角"课程"后出现可搜索的层级菜单：
 * 初中地理 / 高中地理 → 自然/人文/区域/地球地图 → 具体课程
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useGeographyStore } from '../state/store';
import { commandBus } from '../commands/bus';
import { Search, ChevronRight, X } from './icons';
import { LESSON_CATALOG } from '../lessons/catalog';
import { LessonRuntime } from '../lessons/runtime';

interface CommandMenuProps {
  open: boolean;
  onClose: () => void;
}

export function CommandMenu({ open, onClose }: CommandMenuProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const setUI = useGeographyStore((s) => s.setUI);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
      setUI({ showCommandMenu: true });
      // Q7：打开课程菜单时，异步预热全部课程 import（用户看到菜单时已经在后台下载对应 chunk，第一次点就命中缓存）
      for (const m of LESSON_CATALOG) LessonRuntime.warmUpLesson(m.id);
    } else {
      setUI({ showCommandMenu: false });
    }
  }, [open, setUI]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!query.trim()) return LESSON_CATALOG;
    const q = query.toLowerCase();
    return LESSON_CATALOG.filter(
      (lesson) =>
        lesson.title.toLowerCase().includes(q) ||
        lesson.description.toLowerCase().includes(q) ||
        lesson.tags.some((t) => t.includes(q))
    );
  }, [query]);

  // 按学段分组
  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const lesson of filtered) {
      const key = lesson.level;
      if (!groups[key]) groups[key] = [];
      groups[key].push(lesson);
    }
    return groups;
  }, [filtered]);

  // 课程类型徽章标签
  const categoryLabel: Record<string, string> = {
    'natural': '自然',
    'human': '人文',
    'regional': '区域',
    'earth-map': '地图',
  };

  const handleSelect = async (lessonId: string) => {
    onClose();
    await commandBus.execute({ name: 'lesson.open', args: { lessonId } });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />

      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-ink-800/95 ring-1 ring-geo-500/20 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索栏 */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Search className="h-4 w-4 text-white/40" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={'搜索课程，如 等高线 / 自转 / 冷锋'}
            className="flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none"
          />
          <button data-agent-button="lessonMenu.close" onClick={onClose} className="text-white/40 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 课程列表 */}
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {Object.keys(grouped).length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">未找到匹配的课程</div>
          ) : (
            Object.entries(grouped).map(([level, lessons]) => (
              <div key={level} className="mb-2">
                <div className="px-3 py-1.5 text-xs font-medium text-geo-300">
                  {level === 'junior' ? '初中地理' : '高中地理'}
                </div>
                {lessons.map((lesson) => (
                  <button
                    key={lesson.id}
                    data-agent-button={`lesson.open.${lesson.id}`}
                    onClick={() => handleSelect(lesson.id)}
                    className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/10"
                  >
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-geo-300 ring-1 ring-geo-500/30">
                      {categoryLabel[lesson.category] ?? lesson.category}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{lesson.title}</div>
                      <div className="text-xs text-white/40 truncate">{lesson.description}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/20 group-hover:text-geo-300" />
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** 触发按钮 */
export function CommandMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg bg-ink-800/80 px-3 py-1.5 text-sm text-white/80 ring-1 ring-geo-500/20 backdrop-blur-sm hover:bg-ink-700/80 hover:text-white transition-all"
    >
      课程
    </button>
  );
}
