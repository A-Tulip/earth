/**
 * 地球自转与昼夜 —— 样板课程
 *
 * 课标：义务教育地理课程标准 2022年版 - 地球与地图
 * 教材：人教版七年级上册第一章第二节
 */

import { LessonPackage } from '../../src/lessons/schema';

const lesson: LessonPackage = {
  meta: {
    id: 'earth-rotation',
    level: 'junior',
    category: 'natural',
    title: '地球自转与昼夜',
    description: '观察地球自转产生的昼夜交替现象',
    tags: ['自转', '昼夜', '晨昏线'],
    grade: '七年级',
    objectives: [
      '理解地球自转的方向和周期',
      '认识昼夜交替现象的产生原因',
      '理解晨昏线的含义',
    ],
    duration: 10,
    references: [
      '义务教育地理课程标准（2022年版）',
      '人教版七年级上册第一章第二节',
    ],
    curriculumStandard: '义务教育地理课程标准 2022年版 - 地球与地图：地球的运动',
  },

  steps: [
    {
      id: 'intro',
      title: '什么是地球自转',
      narration:
        '地球绕地轴自西向东转动，这叫地球自转。' +
        '自转一周约 24 小时，即一天。' +
        '地球自转产生了昼夜交替和时间差异。',
      lecture:
        '## 地球自转\n\n' +
        '- **方向**：自西向东（从北极上空看为逆时针）\n' +
        '- **周期**：约 24 小时（一天）\n' +
        '- **产生的现象**：昼夜交替、时间差异\n\n' +
        '### 注意\n' +
        '地球是一个不发光、不透明的球体，' +
        '任何时候太阳只能照亮地球的一半，' +
        '被照亮的一半是白昼，未照亮的一半是黑夜。',
      scene: {
        camera: { longitude: 0, latitude: 20, height: 20000000, duration: 3 },
        viewMode: '3d',
        basemap: 'satellite',
        layers: { astronomy: { axis: true, twilight: true, rotation: true } },
        timeAnimation: {
          startTime: '2024-06-21T06:00:00Z',
          endTime: '2024-06-21T18:00:00Z',
          multiplier: 360,
        },
      },
    },
    {
      id: 'day-night',
      title: '昼夜交替',
      narration:
        '请观察地球上的明暗分界。' +
        '被太阳照亮的一面是白昼，背对太阳的一面是黑夜。' +
        '随着地球自转，同一个地方会经历从白昼到黑夜再到白昼的过程，' +
        '这就是昼夜交替。',
      lecture:
        '## 昼夜交替\n\n' +
        '### 产生原因\n' +
        '1. 地球是不发光、不透明的球体\n' +
        '2. 太阳只能照亮地球的一半\n' +
        '3. 地球自转使各地在白昼和黑夜之间交替\n\n' +
        '### 周期\n' +
        '昼夜交替周期 = 地球自转周期 ≈ 24 小时（一个太阳日）',
      scene: {
        camera: { longitude: 0, latitude: 0, height: 25000000, duration: 2.5 },
        layers: { astronomy: { twilight: true, dayMode: true, rotation: true } },
        timeAnimation: {
          startTime: '2024-06-21T00:00:00Z',
          endTime: '2024-06-21T12:00:00Z',
          multiplier: 720,
        },
      },
    },
    {
      id: 'twilight-line',
      title: '晨昏线',
      narration:
        '白昼和黑夜的分界线叫晨昏线。' +
        '顺着地球自转方向，从黑夜进入白昼的是晨线，' +
        '从白昼进入黑夜的是昏线。' +
        '晨昏线始终与太阳光线垂直。',
      lecture:
        '## 晨昏线\n\n' +
        '### 定义\n' +
        '昼半球与夜半球的分界线，即晨昏圈（晨昏线）。\n\n' +
        '### 判断\n' +
        '- **晨线**：顺着自转方向，由夜入昼的分界线\n' +
        '- **昏线**：顺着自转方向，由昼入夜的分界线\n\n' +
        '### 特征\n' +
        '- 晨昏线与太阳光线垂直\n' +
        '- 晨昏线平分地球（昼半球和夜半球各占一半）\n' +
        '- 晨昏线随地球自转而移动',
      scene: {
        camera: { longitude: 90, latitude: 0, height: 20000000, duration: 2.5 },
        layers: { astronomy: { twilight: true, axis: true, rotation: true } },
        timeAnimation: {
          startTime: '2024-06-21T06:00:00Z',
          endTime: '2024-06-21T18:00:00Z',
          multiplier: 360,
        },
      },
    },
    {
      id: 'time-diff',
      title: '时间差异',
      narration:
        '由于地球自转，东部的地方先看到日出，' +
        '所以东部的时间比西部早。' +
        '例如，当北京天亮时，新疆还在黑夜中。' +
        '这就是地球自转产生的时间差异。',
      lecture:
        '## 时间差异\n\n' +
        '### 产生原因\n' +
        '地球自西向东自转，东部先看到日出，时间较早。\n\n' +
        '### 实例\n' +
        '- 北京（东经 116°）与乌鲁木齐（东经 87°）相差约 2 小时\n' +
        '- 北京 6:00 日出时，乌鲁木齐约 8:00 才日出\n\n' +
        '### 时区\n' +
        '全球分 24 个时区，每时区跨经度 15°，相邻时区相差 1 小时。',
      scene: {
        camera: { longitude: 110, latitude: 35, height: 15000000, duration: 2.5 },
        layers: { astronomy: { twilight: true, rotation: true } },
      },
    },
    {
      id: 'quiz',
      title: '自转练习',
      narration: '来做一个练习。地球自转的方向是？',
      question: {
        id: 'rotation-quiz-1',
        type: 'choice',
        question: '地球自转的方向是？',
        options: ['自东向西', '自西向东', '自南向北', '自北向南'],
        answer: '自西向东',
        explanation:
          '地球自转方向是自西向东。从北极上空看为逆时针，从南极上空看为顺时针。',
      },
      scene: {
        camera: { longitude: 0, latitude: 0, height: 25000000, duration: 2 },
        layers: { astronomy: { rotation: true, axis: true } },
      },
    },
    {
      id: 'summary',
      title: '本节小结',
      narration:
        '今天我们学习了地球自转。' +
        '地球自西向东自转，周期约 24 小时。' +
        '自转产生昼夜交替和时间差异。' +
        '晨昏线是昼夜的分界，与太阳光线垂直。',
      lecture:
        '## 本节总结\n\n' +
        '### 核心知识点\n' +
        '1. 地球自转方向：自西向东\n' +
        '2. 自转周期：约 24 小时\n' +
        '3. 自转现象：昼夜交替、时间差异\n' +
        '4. 晨昏线：昼夜分界线，与太阳光线垂直\n\n' +
        '### 常见误区\n' +
        '- 误以为昼夜交替是因为地球公转（实际是自转）\n' +
        '- 误以为晨昏线静止（实际随自转移动）',
      scene: {
        camera: { longitude: 0, latitude: 20, height: 20000000, duration: 3 },
        layers: { astronomy: { rotation: true, twilight: true, axis: true } },
      },
    },
  ],
};

export default lesson;
