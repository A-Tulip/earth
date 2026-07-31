# 课程编写

## 1. 课程体系

依据现行课程标准：
- **初中**：义务教育地理课程标准（2022 年版）
- **高中**：普通高中地理课程标准（2017 年版 2020 年修订）

### 初中覆盖
地球和地图、经纬网、比例尺、方向、等高线、基本地形、大洲大洋、板块、天气和气候、世界区域、中国疆域、中国地势、山脉地形区、长江黄河、人口、城市、农业、工业、交通、区域差异。

### 高中覆盖
地球自转和公转、地方时、昼夜长短、太阳高度、大气受热、热力环流、气压带风带、季风、锋面、气旋反气旋、台风、水循环、河流、洋流、板块、地貌过程、人口、城市化、农业区位、工业区位、交通区位、区域发展、可持续发展。

## 2. 可复用场景模板

不为每个知识点开发页面。课程表达收敛为模板：

| 模板 | 适用 |
|---|---|
| 全球与区域导览 | 大洲大洋、中国疆域、世界区域 |
| 地形分析 | 等高线、地势分布、基本地形、地貌识别 |
| 光照与时间 | 自转、公转、昼夜、地方时、太阳高度 |
| 流动系统 | 洋流、季风、水循环、河流 |
| 地质剖面 | 板块、地貌过程、地形剖面 |
| 数据空间比较 | 人口、GDP、城市化、区域差异 |
| 地图探究问题 | 互动题、地图点击题 |

AI 生成课程时选模板、填参数。固定模板无法表达的少数内容，再用 OpenMAIC/MAIC-UI 互动 HTML 生成。

## 3. 课程包结构

```
content/<lesson-id>/
├── lesson.ts (或 .mdx)     # 课程正文 + 步骤
├── scene.json (可选)       # 场景配置
├── questions.json (可选)   # 问题
├── references.yaml (可选)  # 来源
├── regions.geojson (可选)  # 空间区域
├── simulation.czml (可选)  # 动画
└── assets/ (可选)          # 资源
```

## 4. Schema（`src/lessons/schema.ts`）

```typescript
interface LessonPackage {
  meta: LessonMeta;          // id, level, category, title, grade, objectives, ...
  steps: LessonStep[];
}

interface LessonStep {
  id: string;
  title: string;
  narration: string;         // 旁白（TTS 朗读）
  lecture?: string;          // 讲义（Markdown，底部展开）
  question?: Question;       // 互动题
  scene: SceneConfig;        // 场景配置
}

interface SceneConfig {
  camera?: { longitude, latitude, height, duration };
  viewMode?: '2d' | '3d' | 'columbus';
  basemap?: 'satellite' | 'terrain' | 'political' | 'osm';
  contour?: { spacing: number };
  exaggeration?: number;
  layers?: { terrain: { elevationRamp, slope, aspect } };
}
```

## 5. 样板课程：等高线与地形判读

`content/contour-lines/lesson.ts` 是最完整样板，包含 7 步：

1. **引入**：等高线概念 + 云南山区镜头 + 等高线材质
2. **疏密与坡度**：等高距 100m + 地形夸张 3 倍
3. **地形部位识别**：山顶/山脊/山谷/鞍部/陡崖/盆地
4. **高程分层着色**：ElevationRamp 材质
5. **二维三维切换**：建立平面符号与立体地貌对应
6. **互动题**：选择"凸高为谷"的正确判断
7. **总结**：核心规则 + 常见误区 + 课标要求

## 6. 课程目录（`src/lessons/catalog.ts`）

新增课程在此注册 `LessonMeta`，CommandMenu 据此渲染可搜索层级菜单。

当前已注册：
- 初中：等高线、中国地势三级阶梯、地球自转与昼夜、板块运动与地震带
- 高中：地球公转与四季、冷锋与暖锋、季风与气候、洋流与气候

## 7. 课程运行时（`src/lessons/runtime.ts`）

`LessonRuntime` 提供：
- `load(lessonId)` — 加载课程
- `playStep(index)` — 播放指定步骤
- `pause()` / `resume()` — 暂停/恢复
- `advance()` — 推进下一步
- `interrupt()` — 教师打断
- `reset()` — 重置

播放步骤时：
1. 执行场景配置（flyTo、setMode、showContour 等）
2. 显示讲义（如果有）
3. TTS 朗读旁白（除非静音）

## 8. 校验流程

**三层校验：**
1. **AI 校验**：对照课程标准检查知识目标和概念准确性
2. **代码校验**：`npm run validate:content` 检查 Schema、引用、地点、工具名称、GeoJSON/CZML
3. **教师审核**：最终讲解人工审核

**AI 回答规则：**
- 优先检索课程包和权威来源
- 给出来源
- 无法确定的内容明确表达不确定性

## 9. 课标对齐示例（等高线课程）

```
课标：义务教育地理课程标准 2022年版 - 地图部分：阅读等高线地形图
教材：人教版八年级上册第一章第四节
知识目标：
  - 理解等高线是地表相同海拔点的连线
  - 掌握通过等高线疏密判断坡度陡缓
  - 能识别山顶、山脊、山谷、鞍部、陡崖等地形部位
  - 能绘制简单的地形剖面图
常见误区：山脊和山谷的凸出方向容易混淆
```

## 10. Studio（教师备课工具，默认关闭）

- 不出现在公共首页
- 通过 `ENABLE_STUDIO=true` 环境变量开启
- 支持输入主题、年级、课时、教学目标、材料
- 生成课程草稿 → 人工审核 → 发布
- 公共演示版本直接读取已发布课程包

不在仓库中复制受版权保护的完整教材正文。教材上传与知识抽取用于教师自有材料。
