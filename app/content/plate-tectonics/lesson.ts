/**
 * 板块运动与地震带 —— 样板课程
 *
 * 课标：义务教育地理课程标准 2022年版 - 世界地理
 * 教材：人教版七年级下册
 */

import { LessonPackage } from '../../src/lessons/schema';

const lesson: LessonPackage = {
  meta: {
    id: 'plate-tectonics',
    level: 'junior',
    category: 'natural',
    title: '板块运动与地震带',
    description: '观察全球板块分布与地震带的关系',
    tags: ['板块', '地震', '构造'],
    grade: '七年级',
    objectives: [
      '了解六大板块的名称和分布',
      '理解板块构造学说基本观点',
      '认识世界两大火山地震带',
    ],
    duration: 12,
    references: [
      '义务教育地理课程标准（2022年版）',
      '人教版七年级下册',
      'USGS 地震数据',
    ],
    curriculumStandard: '义务教育地理课程标准 2022年版 - 世界地理：海陆变迁',
  },

  steps: [
    {
      id: 'intro',
      title: '六大板块',
      narration:
        '地球的岩石圈不是完整的一块，而是分裂成六大板块。' +
        '它们是亚欧板块、非洲板块、印度洋板块、太平洋板块、美洲板块和南极洲板块。' +
        '板块在软流层上缓慢运动。',
      lecture:
        '## 六大板块\n\n' +
        '| 板块 | 主要包含 |\n|---|---|\n' +
        '| 亚欧板块 | 欧洲及亚洲大部 |\n' +
        '| 非洲板块 | 非洲及部分大西洋 |\n' +
        '| 印度洋板块 | 印度洋及印度、澳大利亚等 |\n' +
        '| 太平洋板块 | 太平洋大部（几乎全为海洋）|\n' +
        '| 美洲板块 | 北美、南美 |\n' +
        '| 南极洲板块 | 南极洲及周围海域 |\n\n' +
        '### 板块构造学说要点\n' +
        '1. 岩石圈分裂为六大板块\n' +
        '2. 板块漂浮在软流层上\n' +
        '3. 板块内部稳定，交界处活跃',
      scene: {
        camera: { longitude: 0, latitude: 20, height: 20000000, duration: 3 },
        viewMode: '3d',
        basemap: 'political',
        layers: { annotations: { plates: true } },
      },
    },
    {
      id: 'motion',
      title: '板块运动方式',
      narration:
        '板块运动有三种基本方式。' +
        '张裂运动形成裂谷和海洋，' +
        '碰撞运动形成山脉和海沟，' +
        '平错运动形成断层。' +
        '板块运动是地震和火山的主要成因。',
      lecture:
        '## 板块运动方式\n\n' +
        '| 运动方式 | 边界类型 | 地表结果 |\n|---|---|---|\n' +
        '| 张裂 | 生长边界 | 裂谷、海岭、新海洋 |\n' +
        '| 碰撞 | 消亡边界 | 山脉、海沟、岛弧 |\n' +
        '| 平错 | 转换边界 | 断层 |\n\n' +
        '### 实例\n' +
        '- **张裂**：东非大裂谷、大西洋中脊、红海\n' +
        '- **碰撞**：喜马拉雅山（印度洋板块与亚欧板块）、安第斯山\n' +
        '- **平错**：圣安德烈斯断层',
      scene: {
        camera: { longitude: 0, latitude: 0, height: 18000000, duration: 2.5 },
        layers: { annotations: { plates: true } },
      },
    },
    {
      id: 'earthquake-zone',
      title: '世界两大火山地震带',
      narration:
        '世界火山地震主要集中分布在两大地带。' +
        '一是环太平洋火山地震带，集中了全球约 80% 的地震。' +
        '二是地中海-喜马拉雅火山地震带，横跨欧亚大陆南部。',
      lecture:
        '## 世界两大火山地震带\n\n' +
        '### 1. 环太平洋火山地震带\n' +
        '- 集中全球约 **80%** 的地震\n' +
        '- 沿太平洋周围分布\n' +
        '- 日本、智利、美国西海岸、印尼多地震\n\n' +
        '### 2. 地中海-喜马拉雅火山地震带\n' +
        '- 集中全球约 **15%** 的地震\n' +
        '- 横跨欧洲南部、喜马拉雅、东南亚\n' +
        '- 中国西南、意大利、土耳其多地震',
      scene: {
        camera: { longitude: 140, latitude: 0, height: 15000000, duration: 2.5 },
        layers: { data: { earthquake: true }, annotations: { plates: true } },
        timeAnimation: {
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-12-31T00:00:00Z',
          multiplier: 8760,
        },
      },
    },
    {
      id: 'china-earthquake',
      title: '中国的地震分布',
      narration:
        '中国位于世界两大地震带交汇处，地震多发。' +
        '主要地震带包括台湾地震带、西南地震带、' +
        '西北地震带、华北地震带。' +
        '看，这些红点是近期发生的地震。',
      lecture:
        '## 中国地震分布\n\n' +
        '| 地震带 | 位置 |\n|---|---|\n' +
        '| 台湾地震带 | 台湾及附近海域 |\n' +
        '| 西南地震带 | 云南、四川、西藏 |\n' +
        '| 西北地震带 | 新疆、甘肃 |\n' +
        '| 华北地震带 | 华北平原及周边 |\n\n' +
        '### 原因\n' +
        '中国处于亚欧板块、太平洋板块、印度洋板块交界，' +
        '板块运动活跃，地震多发。',
      scene: {
        camera: { longitude: 105, latitude: 30, height: 6000000, duration: 2.5 },
        layers: { data: { earthquake: true } },
      },
    },
    {
      id: 'quiz',
      title: '板块练习',
      narration: '来做一个练习。世界地震最集中的地带是？',
      question: {
        id: 'plate-quiz-1',
        type: 'choice',
        question: '世界地震火山最集中的地带是？',
        options: [
          '环太平洋火山地震带',
          '大西洋中脊',
          '东非大裂谷',
          '印度洋海岭',
        ],
        answer: '环太平洋火山地震带',
        explanation:
          '环太平洋火山地震带集中了全球约 80% 的地震，' +
          '因太平洋板块与周围板块交界，运动活跃。',
      },
      scene: {
        camera: { longitude: 180, latitude: 0, height: 18000000, duration: 2 },
        layers: { data: { earthquake: true }, annotations: { plates: true } },
      },
    },
    {
      id: 'summary',
      title: '本节小结',
      narration:
        '今天我们学习了板块运动与地震带。' +
        '六大板块在软流层上运动，交界处多地震火山。' +
        '世界两大火山地震带是环太平洋带和地中海-喜马拉雅带。' +
        '中国位于两大地震带交汇处，地震多发。',
      lecture:
        '## 本节总结\n\n' +
        '### 核心知识点\n' +
        '1. 六大板块：亚欧、非洲、印度洋、太平洋、美洲、南极洲\n' +
        '2. 板块运动：张裂、碰撞、平错\n' +
        '3. 两大火山地震带：环太平洋（80%）、地中海-喜马拉雅（15%）\n' +
        '4. 中国位于两大地震带交汇处\n\n' +
        '### 常见误区\n' +
        '- 误以为板块运动只发生在海洋（陆地交界也活跃）\n' +
        '- 误以为地震只发生在板块边界（板内也有地震）',
      scene: {
        camera: { longitude: 0, latitude: 20, height: 20000000, duration: 3 },
        layers: { annotations: { plates: true }, data: { earthquake: true } },
      },
    },
  ],
};

export default lesson;
