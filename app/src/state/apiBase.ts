/**
 * 后端 API 基址工具。
 *
 * 开发环境：走同源 Vite 代理（/api → 本地 FastAPI 8787），返回原始相对路径。
 * 生产环境：Vercel 无法把 /api/* HTTP 请求转发到外部后端，需直连 Railway 后端，
 *          由 VITE_API_BASE_URL 指定（如 https://earth-production.up.railway.app）。
 *
 * 使用：`apiUrl('/api/llm/chat')`
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';

export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  const base = API_BASE.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}