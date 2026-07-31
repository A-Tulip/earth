/**
 * 中国地势三级阶梯 —— 样板课程
 *
 * 课标：义务教育地理课程标准 2022年版 - 中国地理
 * 教材：人教版八年级上册第二章第一节
 */

import { LessonPackage } from '../../src/lessons/schema';

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
      },
    },
  ],
};

export default lesson;
