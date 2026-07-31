/**
 * 冷锋与天气 —— 样板课程
 *
 * 课标：普通高中地理课程标准 2017年版 2020年修订 - 必修1：常见天气系统
 * 教材：人教版高中地理必修1第二章第三节
 */

import { LessonPackage } from '../../src/lessons/schema';

const lesson: LessonPackage = {
  meta: {
    id: 'cold-front',
    level: 'senior',
    category: 'natural',
    title: '冷锋与天气',
    description: '观察冷锋的形成、结构与天气变化过程',
    tags: ['锋面', '冷锋', '天气系统'],
    grade: '高一',
    objectives: [
      '理解冷锋的概念与结构特征',
      '认识冷锋过境前、过境时、过境后的天气变化',
      '能够运用冷锋原理解释实际天气现象',
    ],
    duration: 12,
    references: [
      '普通高中地理课程标准（2017年版 2020年修订）',
      '人教版高中地理必修1第二章第三节',
      '中国气象局天气预报数据',
    ],
    curriculumStandard: '普通高中地理课程标准 2017年版 2020年修订 - 必修1：常见天气系统',
  },

  steps: [
    {
      id: 'intro',
      title: '什么是锋面',
      narration:
        '锋面是冷暖气团的交界面。' +
        '由于冷气团密度大、暖气团密度小，' +
        '冷气团在锋面下方，暖气团在锋面上方。' +
        '锋面与地面的交线叫锋线，' +
        '锋面和锋线统称为锋。',
      lecture:
        '## 锋面\n\n' +
        '### 概念\n' +
        '- **气团**：温度、湿度、气压等物理性质比较均匀的大范围空气\n' +
        '- **冷气团**：来自高纬度的冷气团（密度大）\n' +
        '- **暖气团**：来自低纬度的暖气团（密度小）\n' +
        '- **锋面**：冷暖气团的交界面\n' +
        '- **锋线**：锋面与地面的交线\n\n' +
        '### 分类\n' +
        '根据锋面移动方向中主导气团：\n' +
        '- **冷锋**：冷气团主动向暖气团移动\n' +
        '- **暖锋**：暖气团主动向冷气团移动\n' +
        '- **准静止锋**：冷暖气团势力相当',
      scene: {
        camera: { longitude: 110, latitude: 35, height: 12000000, duration: 3 },
        viewMode: '3d',
        basemap: 'satellite',
        layers: { data: { weather: true }, annotations: { cities: true } },
        timeAnimation: {
          startTime: '2024-04-15T00:00:00Z',
          endTime: '2024-04-16T00:00:00Z',
          multiplier: 360,
        },
      },
    },
    {
      id: 'cold-front-structure',
      title: '冷锋结构',
      narration:
        '冷锋是冷气团主动推动暖气团形成的锋面。' +
        '由于冷气团势力强，锋面坡度较陡，' +
        '通常约 1:50 到 1:100。' +
        '冷锋移动速度较快，每小时可达 30-50 公里。',
      lecture:
        '## 冷锋结构\n\n' +
        '### 特征\n' +
        '- **主导气团**：冷气团主动推进\n' +
        '- **锋面坡度**：较陡（1:50 ~ 1:100）\n' +
        '- **移动速度**：较快，30-50 km/h\n' +
        '- **锋面符号**：三角形（蓝色），指向移动方向\n\n' +
        '### 三维结构\n' +
        '```\n' +
        '          暖气团 ↗\n' +
        '         ┌──────\n' +
        '         │ ▲▲▲▲▲▲  ← 冷锋（三角形指向）\n' +
        '   冷气团 ────────→\n' +
        '   （密度大）\n' +
        '```',
      scene: {
        camera: { longitude: 110, latitude: 35, height: 8000000, duration: 2.5 },
        layers: { data: { weather: true } },
        timeAnimation: {
          startTime: '2024-04-15T06:00:00Z',
          endTime: '2024-04-15T18:00:00Z',
          multiplier: 180,
        },
      },
    },
    {
      id: 'before-passing',
      title: '过境前天气',
      narration:
        '冷锋过境前，当地受暖气团控制。' +
        '气温较高，气压较低，' +
        '天气温暖，可能伴有轻微的晴朗或多云天气。',
      lecture:
        '## 过境前天气\n\n' +
        '### 受暖气团控制\n' +
        '| 要素 | 状态 |\n' +
        '|------|------|\n' +
        '| 气温 | 较高 |\n' +
        '| 气压 | 较低 |\n' +
        '| 风向 | 偏南风 |\n' +
        '| 天气 | 晴朗或多云 |\n\n' +
        '### 解释\n' +
        '暖气团来自低纬度，温度高、密度小、气压低，' +
        '当地处于暖气团控制下时天气较为温暖。',
      scene: {
        camera: { longitude: 116, latitude: 35, height: 5000000, duration: 2.5 },
        layers: { data: { weather: true } },
        timeAnimation: {
          startTime: '2024-04-15T00:00:00Z',
          endTime: '2024-04-15T06:00:00Z',
          multiplier: 120,
        },
      },
    },
    {
      id: 'passing',
      title: '过境时天气',
      narration:
        '冷锋过境时，暖气团被快速抬升，' +
        '形成强烈的上升运动。' +
        '会出现大风、降温、云层增厚、' +
        '暴雨或雷暴等剧烈天气现象。',
      lecture:
        '## 过境时天气\n\n' +
        '### 剧烈天气\n' +
        '| 要素 | 状态 |\n' +
        '|------|------|\n' +
        '| 气温 | 急剧下降 |\n' +
        '| 气压 | 急剧上升 |\n' +
        '| 风向 | 偏北风，风力大 |\n' +
        '| 天气 | 大风、暴雨、雷电 |\n\n' +
        '### 成因\n' +
        '冷气团楔入暖气团下方，迫使暖气团剧烈抬升，' +
        '水汽快速凝结形成积雨云，' +
        '产生强对流天气。',
      scene: {
        camera: { longitude: 116, latitude: 35, height: 3000000, duration: 2.5 },
        layers: { data: { weather: true } },
        timeAnimation: {
          startTime: '2024-04-15T06:00:00Z',
          endTime: '2024-04-15T12:00:00Z',
          multiplier: 60,
        },
      },
    },
    {
      id: 'after-passing',
      title: '过境后天气',
      narration:
        '冷锋过境后，当地受冷气团控制。' +
        '气温下降，气压升高，' +
        '天气转晴，但温度明显比之前低。',
      lecture:
        '## 过境后天气\n\n' +
        '### 受冷气团控制\n' +
        '| 要素 | 状态 |\n' +
        '|------|------|\n' +
        '| 气温 | 明显下降 |\n' +
        '| 气压 | 升高 |\n' +
        '| 风向 | 偏北风减弱 |\n' +
        '| 天气 | 转晴，温度较低 |\n\n' +
        '### 典型案例\n' +
        '我国冬半年的"寒潮"天气即由强冷锋过境引起，' +
        '24小时内气温可下降 8°C 以上。',
      scene: {
        camera: { longitude: 116, latitude: 35, height: 5000000, duration: 2.5 },
        layers: { data: { weather: true } },
        timeAnimation: {
          startTime: '2024-04-15T12:00:00Z',
          endTime: '2024-04-15T18:00:00Z',
          multiplier: 120,
        },
      },
    },
    {
      id: 'quiz',
      title: '冷锋练习',
      narration: '来做一个练习。冷锋过境时，当地天气有什么特征？',
      question: {
        id: 'cold-front-quiz-1',
        type: 'choice',
        question: '冷锋过境时的典型天气特征是？',
        options: [
          '气温升高，气压降低，天气晴朗',
          '气温骤降，气压上升，大风暴雨',
          '气温不变，气压不变，多云',
          '气温升高，气压升高，无风',
        ],
        answer: '气温骤降，气压上升，大风暴雨',
        explanation:
          '冷锋过境时，冷气团强力抬升暖气团，引起气温骤降、气压上升，伴随大风、暴雨、雷电等剧烈天气。',
      },
      scene: {
        camera: { longitude: 116, latitude: 35, height: 4000000, duration: 2 },
        layers: { data: { weather: true } },
      },
    },
    {
      id: 'summary',
      title: '本节小结',
      narration:
        '今天我们学习了冷锋。' +
        '冷锋是冷气团主动推动暖气团形成的锋面。' +
        '过境前暖而晴，过境时大风暴雨、气温骤降，' +
        '过境后冷而晴。' +
        '我国冬半年的寒潮即由强冷锋引起。',
      lecture:
        '## 本节总结\n\n' +
        '### 核心知识点\n' +
        '1. 锋面：冷暖气团交界面\n' +
        '2. 冷锋：冷气团主动推进，坡度陡，速度快\n' +
        '3. 过境前：暖晴，气压低\n' +
        '4. 过境时：大风暴雨，气温骤降\n' +
        '5. 过境后：冷晴，气压高\n\n' +
        '### 常见误区\n' +
        '- 误以为冷锋都带来寒潮（寒潮是强冷锋）\n' +
        '- 误以为过境后即转热（实际是冷晴）',
      scene: {
        camera: { longitude: 110, latitude: 35, height: 8000000, duration: 3 },
        layers: { data: { weather: true } },
      },
    },
  ],
};

export default lesson;
