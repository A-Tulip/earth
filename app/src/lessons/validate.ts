/**
 * 课程内容校验脚本
 *
 * 检查项：
 * 1. 字段完整性（meta / steps 必填）
 * 2. 工具名称合法（与 TOOL_NAMES 对齐）
 * 3. 经纬度合法
 * 4. 问题答案在选项中
 * 5. 时间动画配置合法
 * 6. catalog 与实际课程包对齐
 *
 * 运行：npm run validate:content
 */

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { LESSON_CATALOG } from './catalog';
import { TOOL_NAMES } from '../commands/schema';
import type { BasemapType } from '../state/sceneState';
import type { LessonPackage, LessonMeta, LessonStep } from './schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(__dirname, '../../content');
const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

/** 校验结果收集 */
interface ValidationReport {
  errors: string[];
  warnings: string[];
  ok: boolean;
}

const report: ValidationReport = { errors: [], warnings: [], ok: true };

function error(msg: string) {
  report.errors.push(msg);
  report.ok = false;
}

function warn(msg: string) {
  report.warnings.push(msg);
}

/** 列出所有课程目录 */
function listLessonDirs(): string[] {
  if (!existsSync(CONTENT_DIR)) {
    error(`课程目录不存在: ${CONTENT_DIR}`);
    return [];
  }
  return readdirSync(CONTENT_DIR).filter((name) => {
    const full = join(CONTENT_DIR, name);
    return statSync(full).isDirectory() && existsSync(join(full, 'lesson.ts'));
  });
}

/** 动态加载课程包 */
async function loadLesson(lessonId: string): Promise<LessonPackage | null> {
  try {
    // 使用 createRequire 以便在 tsx 下加载 TS 模块
    const require = createRequire(import.meta.url);
    const mod = require(`../../content/${lessonId}/lesson.ts`);
    return (mod?.default ?? mod) as LessonPackage;
  } catch (err) {
    error(`课程 ${lessonId} 加载失败: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** 校验 meta 字段完整性 */
function validateMeta(meta: Partial<LessonMeta> | undefined, lessonId: string) {
  if (!meta) {
    error(`[${lessonId}] meta 缺失`);
    return;
  }
  const required: (keyof LessonMeta)[] = [
    'id', 'level', 'category', 'title', 'description', 'tags',
    'grade', 'objectives', 'duration', 'references', 'curriculumStandard',
  ];
  for (const key of required) {
    if (meta[key] === undefined || meta[key] === null || meta[key] === '') {
      error(`[${lessonId}] meta.${key} 缺失`);
    }
  }
  if (meta.id && meta.id !== lessonId) {
    error(`[${lessonId}] meta.id (${meta.id}) 与目录名不一致`);
  }
  if (meta.level && !['junior', 'senior'].includes(meta.level)) {
    error(`[${lessonId}] meta.level 必须为 junior 或 senior，实际为 ${meta.level}`);
  }
  if (meta.category && !['natural', 'human', 'regional', 'earth-map'].includes(meta.category)) {
    error(`[${lessonId}] meta.category 非法: ${meta.category}`);
  }
  if (typeof meta.duration === 'number' && (meta.duration <= 0 || meta.duration > 120)) {
    warn(`[${lessonId}] meta.duration 异常: ${meta.duration} 分钟`);
  }
  if (Array.isArray(meta.tags) && meta.tags.length === 0) {
    warn(`[${lessonId}] meta.tags 为空`);
  }
}

/** 校验单个步骤 */
function validateStep(step: Partial<LessonStep>, lessonId: string, idx: number) {
  const prefix = `[${lessonId}] step[${idx}]`;
  if (!step.id) error(`${prefix} id 缺失`);
  if (!step.title) error(`${prefix} title 缺失`);
  // narration 可选：若缺失则必须提供 aiPrompt（ISSUE-6：AI 动态生成旁白）
  if (!step.narration && !step.aiPrompt) error(`${prefix} narration 缺失（且未提供 aiPrompt）`);
  if (!step.scene) {
    error(`${prefix} scene 缺失`);
    return;
  }

  // 镜头坐标合法
  const cam = step.scene.camera;
  if (cam) {
    if (typeof cam.longitude !== 'number' || cam.longitude < -180 || cam.longitude > 180) {
      error(`${prefix} camera.longitude 非法: ${cam.longitude}`);
    }
    if (typeof cam.latitude !== 'number' || cam.latitude < -90 || cam.latitude > 90) {
      error(`${prefix} camera.latitude 非法: ${cam.latitude}`);
    }
    if (typeof cam.height !== 'number' || cam.height < 0) {
      error(`${prefix} camera.height 非法: ${cam.height}`);
    }
  }

  // 视图模式 / 底图枚举（与 BasemapType 对齐，避免硬编码列表过期）
  if (step.scene.viewMode && !['2d', '3d', 'columbus'].includes(step.scene.viewMode)) {
    error(`${prefix} scene.viewMode 非法: ${step.scene.viewMode}`);
  }
  const BASEMAP_VALUES: BasemapType[] = [
    'satellite', 'political', 'relief', 'landform', 'contour', 'osm',
    'amapSatellite', 'amapPolitical', 'amapRoad',
    'tiandituSatellite', 'tiandituPolitical', 'tiandituRelief', 'terrain',
  ];
  if (step.scene.basemap && !BASEMAP_VALUES.includes(step.scene.basemap)) {
    error(`${prefix} scene.basemap 非法: ${step.scene.basemap}`);
  }

  // 等高线间距
  if (step.scene.contour) {
    if (typeof step.scene.contour.spacing !== 'number' || step.scene.contour.spacing < 10) {
      error(`${prefix} contour.spacing 非法: ${step.scene.contour.spacing}`);
    }
  }

  // 地形夸张
  if (typeof step.scene.exaggeration === 'number') {
    if (step.scene.exaggeration < 0.5 || step.scene.exaggeration > 10) {
      error(`${prefix} exaggeration 越界: ${step.scene.exaggeration}`);
    }
  }

  // 时间动画
  if (step.scene.timeAnimation) {
    const ta = step.scene.timeAnimation;
    if (!ta.startTime || !ta.endTime) {
      error(`${prefix} timeAnimation.startTime/endTime 缺失`);
    } else {
      const s = Date.parse(ta.startTime);
      const e = Date.parse(ta.endTime);
      if (isNaN(s)) error(`${prefix} timeAnimation.startTime 不是有效 ISO 时间`);
      if (isNaN(e)) error(`${prefix} timeAnimation.endTime 不是有效 ISO 时间`);
      if (!isNaN(s) && !isNaN(e) && e <= s) {
        error(`${prefix} timeAnimation.endTime 不早于 startTime`);
      }
    }
    if (typeof ta.multiplier !== 'number' || ta.multiplier <= 0) {
      error(`${prefix} timeAnimation.multiplier 非法: ${ta.multiplier}`);
    }
  }

  // 问题
  if (step.question) {
    validateQuestion(step.question, lessonId, idx);
  }
}

/** 校验问题 */
function validateQuestion(
  q: NonNullable<LessonStep['question']>,
  lessonId: string,
  stepIdx: number,
) {
  const prefix = `[${lessonId}] step[${stepIdx}].question`;
  if (!q.id) error(`${prefix} id 缺失`);
  if (!q.question) error(`${prefix} question 缺失`);
  if (!q.explanation) error(`${prefix} explanation 缺失`);

  if (q.type === 'choice') {
    if (!Array.isArray(q.options) || q.options.length < 2) {
      error(`${prefix} choice 题选项至少 2 个`);
    } else {
      // 选择题答案必须在选项中
      const opts = q.options as string[];
      const ans = Array.isArray(q.answer) ? q.answer : [q.answer as string];
      for (const a of ans) {
        if (!opts.includes(a)) {
          error(`${prefix} 答案 "${a}" 不在选项中`);
        }
      }
    }
  }

  if (q.type === 'map-click' && q.expectedRegion) {
    const r = q.expectedRegion;
    if (r.minLon >= r.maxLon) error(`${prefix} expectedRegion.minLon >= maxLon`);
    if (r.minLat >= r.maxLat) error(`${prefix} expectedRegion.minLat >= maxLat`);
    if (r.minLon < -180 || r.maxLon > 180) error(`${prefix} expectedRegion 经度越界`);
    if (r.minLat < -90 || r.maxLat > 90) error(`${prefix} expectedRegion 纬度越界`);
  }
}

/** 校验讲义中的工具引用（讲义本身是 Markdown，无需工具校验，这里只做基本检查） */
function validateLecture(step: LessonStep, lessonId: string, idx: number) {
  if (!step.lecture) return;
  if (step.lecture.length > 5000) {
    warn(`[${lessonId}] step[${idx}] lecture 较长 (${step.lecture.length} 字符)`);
  }
}

/** 校验 GeoJSON 文件（如果存在） */
function validateGeoJSON(lessonId: string) {
  const geoPath = join(CONTENT_DIR, lessonId, 'regions.geojson');
  if (!existsSync(geoPath)) return;
  try {
    const raw = readFileSync(geoPath, 'utf-8');
    const json = JSON.parse(raw);
    if (json.type !== 'FeatureCollection' && json.type !== 'Feature' && json.type !== 'Geometry') {
      warn(`[${lessonId}] GeoJSON type 异常: ${json.type}`);
    }
    if (json.type === 'FeatureCollection' && !Array.isArray(json.features)) {
      error(`[${lessonId}] GeoJSON FeatureCollection 缺少 features 数组`);
    }
  } catch (err) {
    error(`[${lessonId}] GeoJSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 校验 CZML 文件（如果存在） */
function validateCZML(lessonId: string) {
  const czmlPath = join(CONTENT_DIR, lessonId, 'simulation.czml');
  if (!existsSync(czmlPath)) return;
  try {
    const raw = readFileSync(czmlPath, 'utf-8');
    const json = JSON.parse(raw);
    if (!Array.isArray(json)) {
      error(`[${lessonId}] CZML 必须是数组`);
      return;
    }
    if (json.length === 0 || !json[0].id || json[0].id !== 'document') {
      warn(`[${lessonId}] CZML 第一个 packet 应为 document 类型`);
    }
  } catch (err) {
    error(`[${lessonId}] CZML 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 校验 catalog 与实际课程包对齐 */
function validateCatalog(diskLessons: string[]) {
  const catalogIds = new Set(LESSON_CATALOG.map((m) => m.id));
  const diskSet = new Set(diskLessons);

  for (const id of diskLessons) {
    if (!catalogIds.has(id)) {
      warn(`课程目录 ${id} 存在于磁盘但未在 catalog 注册`);
    }
  }
  for (const meta of LESSON_CATALOG) {
    if (!diskSet.has(meta.id)) {
      error(`catalog 中注册的 ${meta.id} 在磁盘上不存在`);
    }
  }
  // 检查 catalog 内 id 唯一
  const seen = new Set<string>();
  for (const meta of LESSON_CATALOG) {
    if (seen.has(meta.id)) {
      error(`catalog 中存在重复 id: ${meta.id}`);
    }
    seen.add(meta.id);
  }
}

/** 主流程 */
async function main() {
  console.log('=== 课程内容校验开始 ===\n');
  console.log(`课程目录: ${CONTENT_DIR}\n`);

  const diskLessons = listLessonDirs();
  console.log(`发现课程: ${diskLessons.join(', ') || '(无)'}\n`);

  validateCatalog(diskLessons);

  for (const lessonId of diskLessons) {
    console.log(`校验课程: ${lessonId}`);
    const lesson = await loadLesson(lessonId);
    if (!lesson) continue;

    validateMeta(lesson.meta, lessonId);

    if (!Array.isArray(lesson.steps) || lesson.steps.length === 0) {
      error(`[${lessonId}] steps 为空`);
      continue;
    }

    lesson.steps.forEach((step, idx) => validateStep(step, lessonId, idx));
    lesson.steps.forEach((step, idx) => validateLecture(step, lessonId, idx));

    // 检查 step id 唯一
    const stepIds = new Set<string>();
    lesson.steps.forEach((step, idx) => {
      if (step.id && stepIds.has(step.id)) {
        error(`[${lessonId}] step[${idx}] id 重复: ${step.id}`);
      }
      stepIds.add(step.id);
    });

    validateGeoJSON(lessonId);
    validateCZML(lessonId);
  }

  // 输出报告
  console.log('\n=== 校验报告 ===');
  console.log(`警告: ${report.warnings.length}`);
  report.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  console.log(`错误: ${report.errors.length}`);
  report.errors.forEach((e) => console.log(`  ✗ ${e}`));

  if (report.ok) {
    console.log('\n✓ 所有课程校验通过');
    process.exit(0);
  } else {
    console.log('\n✗ 校验未通过');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('校验脚本异常:', err);
  process.exit(2);
});
