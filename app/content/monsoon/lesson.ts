/**
 * 季风与气候 —— 样板课程
 *
 * 课标：普通高中地理课程标准 2017年版 2020年修订 - 必修1：大气受热过程与大气环流
 * 教材：人教版高中地理必修1第二章第二节
 */

import { LessonPackage } from '../../src/lessons/schema';

const lesson: LessonPackage = {
  meta: {
    id: 'monsoon',
    level: 'senior',
    category: 'natural',
    title: '季风与气候',
    description: '观察东亚与南亚季风的形成及对气候的影响',
    tags: ['季风', '东亚季风', '南亚季风', '气候'],
    grade: '高一',
    objectives: [
      '理解季风的概念与形成原因',
      '认识东亚季风与南亚季风的特点',
      '理解季风对农业生产和生活的影响',
    ],
    duration: 14,
    references: [
      '普通高中地理课程标准（2017年版 2020年修订）',
      '人教版高中地理必修1第二章第二节',
      '中国气象局气候资料',
    ],
    curriculumStandard: '普通高中地理课程标准 2017年版 2020年修订 - 必修1：大气受热过程与大气环流',
  },

  steps: [
    {
      id: 'intro',
      title: '什么是季风',
      narration:
        '季风是随季节变化而风向相反的风。' +
        '一般冬半年由陆地吹向海洋，夏半年由海洋吹向陆地。' +
        '季风的形成与海陆热力性质差异和气压带风带的季节移动有关。',
      lecture:
        '## 季风\n\n' +
        '### 定义\n' +
        '大范围地区盛行风向随季节有规律地相反变换的现象。\n\n' +
        '### 形成原因\n' +
        '1. **海陆热力性质差异**（主要原因）\n' +
        '   - 陆地比热小，升温快，降温也快\n' +
        '   - 海洋比热大，升温慢，降温也慢\n' +
        '   - 冬夏海陆温差形成气压差异\n' +
        '2. **气压带风带的季节移动**（南亚季风主因）\n' +
        '   - 太阳直射点移动引起气压带风带南北移动\n' +
        '   - 东南信风越过赤道后受地转偏向力变为西南季风',
      scene: {
        camera: { longitude: 110, latitude: 20, height: 18000000, duration: 3 },
        viewMode: '3d',
        basemap: 'satellite',
        layers: { data: { temperature: true, precipitation: true } },
        timeAnimation: {
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-07-01T00:00:00Z',
          multiplier: 43200,
        },
      },
    },
    {
      id: 'winter-monsoon',
      title: '冬季风',
      narration:
        '冬季，亚欧大陆形成强大的西伯利亚高压，' +
        '海洋上相对为低压。' +
        '风从陆地吹向海洋，' +
        '在东亚形成西北季风，在南亚形成东北季风。' +
        '冬季风寒冷干燥。',
      lecture:
        '## 冬季风\n\n' +
        '### 成因\n' +
        '冬季陆地降温快，形成 **西伯利亚高压（蒙古高压）**，' +
        '海洋相对为阿留申低压。\n\n' +
        '### 特征\n' +
        '| 地区 | 风向 | 性质 | 影响 |\n' +
        '|------|------|------|------|\n' +
        '| 东亚 | 西北风 | 寒冷干燥 | 降温、寒潮 |\n' +
        '| 南亚 | 东北风 | 温和干燥 | 干季 |\n' +
        '| 华南 | 偏北风 | 干冷 | 少雨 |\n\n' +
        '### 极端表现\n' +
        '强冬季风南下形成 **寒潮**，24小时内气温可降 8°C 以上。',
      scene: {
        camera: { longitude: 105, latitude: 30, height: 12000000, duration: 2.5 },
        layers: { data: { temperature: true } },
        timeAnimation: {
          startTime: '2024-01-15T00:00:00Z',
          endTime: '2024-01-16T00:00:00Z',
          multiplier: 60,
        },
      },
    },
    {
      id: 'summer-monsoon',
      title: '夏季风',
      narration:
        '夏季，亚欧大陆形成低压，' +
        '太平洋和印度洋为高压。' +
        '风从海洋吹向陆地。' +
        '在东亚形成东南季风，在南亚形成西南季风。' +
        '夏季风温暖湿润，带来丰沛降水。',
      lecture:
        '## 夏季风\n\n' +
        '### 成因\n' +
        '夏季陆地升温快，形成 **亚洲低压（印度低压）**，' +
        '海洋相对为夏威夷高压。\n\n' +
        '### 特征\n' +
        '| 地区 | 风向 | 性质 | 影响 |\n' +
        '|------|------|------|------|\n' +
        '| 东亚 | 东南风 | 温暖湿润 | 雨季 |\n' +
        '| 南亚 | 西南风 | 温暖湿润 | 雨季 |\n' +
        '| 华南 | 偏南风 | 暖湿 | 暴雨 |\n\n' +
        '### 雨带推移\n' +
        '1. 4-5月：华南沿海\n' +
        '2. 6月：长江中下游（梅雨）\n' +
        '3. 7-8月：华北、东北\n' +
        '4. 9月：南撤',
      scene: {
        camera: { longitude: 105, latitude: 30, height: 12000000, duration: 2.5 },
        layers: { data: { precipitation: true, temperature: true } },
        timeAnimation: {
          startTime: '2024-07-15T00:00:00Z',
          endTime: '2024-07-16T00:00:00Z',
          multiplier: 60,
        },
      },
    },
    {
      id: 'east-asia-monsoon',
      title: '东亚季风',
      narration:
        '东亚季风主要由海陆热力性质差异形成。' +
        '冬季西北风寒冷干燥，夏季东南风温暖湿润。' +
        '东亚季风区包括中国东部、日本、朝鲜半岛等地。' +
        '气候特征是雨热同期，四季分明。',
      lecture:
        '## 东亚季风\n\n' +
        '### 范围\n' +
        '中国东部、日本、朝鲜半岛、俄罗斯远东\n\n' +
        '### 形成主因\n' +
        '世界最大的亚欧大陆与最大的太平洋之间的海陆热力差异。\n\n' +
        '### 气候特点\n' +
        '- **雨热同期**：夏季高温多雨\n' +
        '- **四季分明**：季节差异显著\n' +
        '- **南北差异大**：从温带季风到亚热带季风\n\n' +
        '### 影响\n' +
        '- 农业一年一熟到两熟/三熟\n' +
        '- 季风不稳定易引起旱涝灾害',
      scene: {
        camera: { longitude: 120, latitude: 35, height: 8000000, duration: 2.5 },
        layers: { data: { precipitation: true } },
        timeAnimation: {
          startTime: '2024-06-01T00:00:00Z',
          endTime: '2024-08-31T00:00:00Z',
          multiplier: 720,
        },
      },
    },
    {
      id: 'south-asia-monsoon',
      title: '南亚季风',
      narration:
        '南亚季风的形成既有海陆热力差异，' +
        '也有气压带风带季节移动的影响。' +
        '夏季东南信风越过赤道，受地转偏向力变为西南季风。' +
        '南亚季风是热带季风，雨季降水集中。',
      lecture:
        '## 南亚季风\n\n' +
        '### 范围\n' +
        '印度半岛、中南半岛、中国西南\n\n' +
        '### 形成原因\n' +
        '1. **夏季**：南半球的东南信风越过赤道，' +
        '受地转偏向力右偏形成 **西南季风**\n' +
        '2. **冬季**：东北信风 + 海陆差异共同作用形成东北季风\n\n' +
        '### 气候特点\n' +
        '- 全年高温\n' +
        '- **旱雨两季**明显\n' +
        '  - 雨季：6-9月（西南季风）\n' +
        '  - 旱季：10月-次年5月\n\n' +
        '### 注意\n' +
        '南亚夏季风的强弱影响印度的旱涝，' +
        '进而影响粮食产量。',
      scene: {
        camera: { longitude: 80, latitude: 20, height: 8000000, duration: 2.5 },
        layers: { data: { precipitation: true, temperature: true } },
        timeAnimation: {
          startTime: '2024-06-01T00:00:00Z',
          endTime: '2024-09-30T00:00:00Z',
          multiplier: 720,
        },
      },
    },
    {
      id: 'influence',
      title: '季风的影响',
      narration:
        '季风给我国带来雨热同期的优越条件，' +
        '有利于水稻等喜温作物的种植。' +
        '但夏季风不稳定，易造成旱涝灾害。' +
        '冬季风强烈时形成寒潮，影响生产生活。',
      lecture:
        '## 季风的影响\n\n' +
        '### 有利影响\n' +
        '- 雨热同期，利于农作物生长\n' +
        '- 形成丰富的农业气候资源\n' +
        '- 促进水稻种植业发展\n\n' +
        '### 不利影响\n' +
        '- 夏季风过强 → 北涝南旱\n' +
        '- 夏季风过弱 → 南涝北旱\n' +
        '- 冬季风强烈 → 寒潮\n' +
        '- 季风转换期 → 台风\n\n' +
        '### 适应措施\n' +
        '- 修建水库、跨流域调水\n' +
        '- 选育抗旱抗涝品种\n' +
        '- 调整种植制度',
      scene: {
        camera: { longitude: 110, latitude: 30, height: 10000000, duration: 2.5 },
        layers: { data: { precipitation: true, temperature: true } },
      },
    },
    {
      id: 'quiz',
      title: '季风练习',
      narration: '来做一个练习。我国东部夏季主要吹什么风？',
      question: {
        id: 'monsoon-quiz-1',
        type: 'choice',
        question: '我国东部夏季的盛行风向是？',
        options: ['西北风', '东南风', '西南风', '东北风'],
        answer: '东南风',
        explanation:
          '夏季亚欧大陆形成低压，太平洋形成高压，风从海洋吹向陆地，在东亚形成东南季风，带来温暖湿润的空气。',
      },
      scene: {
        camera: { longitude: 120, latitude: 30, height: 8000000, duration: 2 },
        layers: { data: { precipitation: true } },
      },
    },
    {
      id: 'summary',
      title: '本节小结',
      narration:
        '今天我们学习了季风。' +
        '季风是风向随季节相反的风。' +
        '东亚季风主因是海陆差异，南亚季风主因是气压带风带移动。' +
        '季风使我国雨热同期，但也带来旱涝灾害。',
      lecture:
        '## 本节总结\n\n' +
        '### 核心知识点\n' +
        '1. 季风定义：风向随季节相反变换\n' +
        '2. 成因：海陆热力差异 + 气压带风带移动\n' +
        '3. 东亚季风：冬西北、夏东南\n' +
        '4. 南亚季风：冬东北、夏西南\n' +
        '5. 影响：雨热同期，旱涝风险\n\n' +
        '### 常见误区\n' +
        '- 误以为南亚夏季风是东南风（实际是西南风）\n' +
        '- 误以为季风只由海陆差异形成（南亚有气压带移动因素）',
      scene: {
        camera: { longitude: 105, latitude: 25, height: 12000000, duration: 3 },
        layers: { data: { precipitation: true, temperature: true } },
      },
    },
  ],
};

export default lesson;
