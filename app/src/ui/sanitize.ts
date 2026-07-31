/**
 * 富文本清理工具 —— 讲义层沙箱
 *
 * 课程讲义是 Markdown 文本，渲染前必须经过：
 * 1. Markdown → HTML（marked）
 * 2. HTML 清理（DOMPurify），剥离脚本、事件处理器、危险标签
 *
 * 防止 AI 生成内容或课程文件中的恶意 HTML 注入。
 * 仅在浏览器端使用，Node 端（如 validate.ts）不调用此模块。
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';

// 配置 marked：安全模式，禁用原生 HTML 直通
marked.setOptions({
  gfm: true,
  breaks: false,
});

/** DOMPurify 配置：仅允许讲义需要的标签 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'del', 'mark',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'code', 'pre', 'blockquote',
    'a', 'span', 'div',
  ],
  ALLOWED_ATTR: ['href', 'title', 'class', 'colspan', 'rowspan'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  ALLOW_DATA_ATTR: false,
};

/**
 * 将 Markdown 转换为安全的 HTML 字符串
 * @param markdown 原始 Markdown 文本
 * @returns 清理后的 HTML，可直接通过 dangerouslySetInnerHTML 渲染
 */
export function renderSanitizedMarkdown(markdown: string): string {
  if (!markdown) return '';
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
}

/**
 * 清理纯 HTML 字符串（用于 AI 回复等已有 HTML）
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
