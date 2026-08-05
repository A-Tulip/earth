/**
 * 中国地势三级阶梯 —— 样板课程
 *
 * 课标：义务教育地理课程标准 2022年版 - 中国地理
 * 教材：人教版八年级上册第二章第一节
 */

import { LessonPackage, RegionOverlay } from '../../src/lessons/schema';

/**
 * 中国地势三级阶梯的简化多边形边界（教学高亮用，非精确政区边界）。
 * 顶点逆时针，首尾自动闭合。
 */
const FIRST_STEP: RegionOverlay = {
  id: 'first-step',
  name: '第一级阶梯\n青藏高原',
  color: '#f54e00',
  coordinates: [
    [73, 37], [80, 40], [90, 40], [98, 37], [103, 33], [104, 29],
    [101, 26], [97, 24], [94, 25], [90, 27], [86, 29], [82, 31],
    [77, 34], [73, 37],
  ],
};

const SECOND_STEP: RegionOverlay = {
  id: 'second-step',
  name: '第二级阶梯\n高原盆地',
  color: '#2b7de9',
  coordinates: [
    [104, 41], [110, 44], [117, 46], [124, 48], [128, 46], [125, 43],
    [120, 41], [115, 39], [111, 37], [113, 35], [116, 34], [119, 32],
    [121, 30], [120, 28], [117, 26], [114, 24], [110, 22], [107, 22],
    [104, 24], [102, 27], [101, 30], [103, 33], [104, 36], [103, 39],
    [104, 41],
  ],
};

const THIRD_STEP: RegionOverlay = {
  id: 'third-step',
  name: '第三级阶梯\n平原丘陵',
  color: '#3a9d5d',
  coordinates: [
    [128, 46], [133, 43], [134, 39], [133, 35], [130, 31], [127, 30],
    [124, 31], [121, 33], [118, 35], [116, 34], [114, 31], [112, 29],
    [110, 28], [109, 26], [110, 24], [112, 24], [114, 26], [116, 28],
    [118, 30], [120, 33], [122, 36], [123, 39], [124, 42], [126, 45],
    [128, 46],
  ],
};

const ALL_STEPS: RegionOverlay[] = [FIRST_STEP, SECOND_STEP, THIRD_STEP];

const lesson: LessonPackage = {
  meta: {
    id: 'china-terrain',
    level: 'junior',
    category: 'regional',
    title: '中国地势三级阶梯',
    description: '认识中国西高东低、呈阶梯状分布的地势特征',
    tags: ['中国', '地势', '阶梯', '地形'],
    grade: '八年级',
    objectives: [
      '了解中国地势西高东低、呈阶梯状分布的特征',
      '认识三级阶梯的海拔范围与主要地形区',
      '理解地势对河流流向与气候的影响',
    ],
    duration: 10,
    references: [
      '义务教育地理课程标准（2022年版）',
      '人教版八年级上册第二章第一节',
    ],
    curriculumStandard: '义务教育地理课程标准 2022年版 - 中国地理：地形与地势',
  },

  steps: [
    {
      id: 'overview',
      title: '中国地势总特征',
      narration:
        '中国地势的总体特征是西高东低，呈阶梯状分布。' +
        '从西向东，地势逐级下降，就像一级级巨大的台阶。' +
        '现在我们从高空俯瞰中国全貌。',
      lecture:
        '## 中国地势总特征\n\n' +
        '### 核心特征\n' +
        '- **西高东低**：西部海拔高，东部海拔低\n' +
        '- **呈阶梯状分布**：从西向东分三级阶梯\n' +
        '- **向海洋倾斜**：地势向太平洋倾斜\n\n' +
        '### 影响\n' +
        '- 河流多自西向东流\n' +
        '- 有利于海洋湿润气流深入内陆\n' +
        '- 阶梯交界处水能资源丰富',
      scene: {
        camera: { longitude: 105, latitude: 35, height: 8000000, duration: 3 },
        viewMode: '3d',
        basemap: 'terrain',
        exaggeration: 3,
        regions: ALL_STEPS,
      },
    },
    {
      id: 'first-step',
      title: '第一级阶梯：青藏高原',
      narration:
        '第一级阶梯是青藏高原，平均海拔 4000 米以上，被称为"世界屋脊"。' +
        '这里分布着昆仑山、祁连山、横断山脉等高大山脉。' +
        '青藏高原是中国乃至亚洲许多大江大河的发源地。',
      lecture:
        '## 第一级阶梯\n\n' +
        '| 项目 | 内容 |\n|---|---|\n' +
        '| 平均海拔 | 4000 米以上 |\n' +
        '| 主要地形 | 高原、高山 |\n' +
        '| 代表地形区 | 青藏高原、柴达木盆地 |\n' +
        '| 分界线 | 昆仑山—祁连山—横断山脉 |\n\n' +
        '### "世界屋脊"\n' +
        '青藏高原是世界上海拔最高的高原，' +
        '冰雪融水滋养了长江、黄河、澜沧江等大江大河。',
      scene: {
        camera: { longitude: 90, latitude: 32, height: 3000000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 4,
        regions: [FIRST_STEP],
      },
    },
    {
      id: 'second-step',
      title: '第二级阶梯：高原盆地',
      narration:
        '第二级阶梯海拔一般在 1000 到 2000 米，' +
        '主要地形是高原和盆地。' +
        '这里有内蒙古高原、黄土高原、云贵高原，' +
        '以及塔里木盆地、准噶尔盆地、四川盆地。',
      lecture:
        '## 第二级阶梯\n\n' +
        '| 项目 | 内容 |\n|---|---|\n' +
        '| 平均海拔 | 1000-2000 米 |\n' +
        '| 主要地形 | 高原、盆地 |\n' +
        '| 代表高原 | 内蒙古高原、黄土高原、云贵高原 |\n' +
        '| 代表盆地 | 塔里木盆地、准噶尔盆地、四川盆地 |\n' +
        '| 分界线 | 大兴安岭—太行山—巫山—雪峰山 |',
      scene: {
        camera: { longitude: 105, latitude: 38, height: 4000000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 3,
        regions: [SECOND_STEP],
      },
    },
    {
      id: 'third-step',
      title: '第三级阶梯：平原丘陵',
      narration:
        '第三级阶梯海拔多在 500 米以下，' +
        '主要地形是平原和丘陵。' +
        '这里有东北平原、华北平原、长江中下游平原，' +
        '是中国主要的农业区和人口密集区。' +
        '再向东就是近海大陆架。',
      lecture:
        '## 第三级阶梯\n\n' +
        '| 项目 | 内容 |\n|---|---|\n' +
        '| 平均海拔 | 500 米以下 |\n' +
        '| 主要地形 | 平原、丘陵 |\n' +
        '| 代表平原 | 东北平原、华北平原、长江中下游平原 |\n' +
        '| 代表丘陵 | 东南丘陵 |\n' +
        '| 向东延伸 | 近海大陆架 |',
      scene: {
        camera: { longitude: 115, latitude: 32, height: 3000000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 2,
        regions: [THIRD_STEP],
      },
    },
    {
      id: 'quiz',
      title: '阶梯判读练习',
      narration: '现在来做一个练习。以下关于中国地势的说法，哪个是正确的？',
      question: {
        id: 'china-terrain-quiz-1',
        type: 'choice',
        question: '关于中国地势特征的正确说法是？',
        options: [
          '东高西低，呈阶梯状分布',
          '西高东低，呈阶梯状分布',
          '中间高四周低',
          '南高北低，平坦开阔',
        ],
        answer: '西高东低，呈阶梯状分布',
        explanation:
          '中国地势西高东低，从西向东分三级阶梯逐级下降。' +
          '第一级青藏高原 >4000m，第二级高原盆地 1000-2000m，第三级平原丘陵 <500m。',
      },
      scene: {
        camera: { longitude: 105, latitude: 35, height: 6000000, duration: 2 },
        basemap: 'terrain',
        exaggeration: 3,
        regions: ALL_STEPS,
      },
    },
    {
      id: 'summary',
      title: '本节小结',
      narration:
        '今天我们学习了中国地势三级阶梯。' +
        '记住：西高东低、呈阶梯状分布。' +
        '第一级青藏高原，第二级高原盆地，第三级平原丘陵。' +
        '这种地势使大河向东流，阶梯交界处水能丰富。',
      lecture:
        '## 本节总结\n\n' +
        '### 三级阶梯\n' +
        '| 阶梯 | 海拔 | 主要地形 |\n|---|---|---|\n' +
        '| 第一级 | >4000m | 青藏高原 |\n' +
        '| 第二级 | 1000-2000m | 高原、盆地 |\n' +
        '| 第三级 | <500m | 平原、丘陵 |\n\n' +
        '### 阶梯分界线\n' +
        '- 一、二级：昆仑山—祁连山—横断山脉\n' +
        '- 二、三级：大兴安岭—太行山—巫山—雪峰山\n\n' +
        '### 地势影响\n' +
        '1. 河流多自西向东流\n' +
        '2. 海洋湿润气流深入内陆\n' +
        '3. 阶梯交界处水能资源丰富',
      scene: {
        camera: { longitude: 105, latitude: 35, height: 8000000, duration: 3 },
        basemap: 'terrain',
        exaggeration: 3,
        regions: ALL_STEPS,
      },
    },
  ],
};

export default lesson;
