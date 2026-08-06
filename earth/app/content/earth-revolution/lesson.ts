/**
 * 地球公转与四季 —— 样板课程
 *
 * 课标：义务教育地理课程标准 2022年版 - 地球与地图：地球的运动
 * 教材：人教版七年级上册第一章第三节
 */

import { LessonPackage } from '../../src/lessons/schema';

const lesson: LessonPackage = {
  meta: {
    id: 'earth-revolution',
    level: 'junior',
    category: 'natural',
    title: '地球公转与四季',
    description: '观察地球绕日公转产生的四季变化与太阳直射点移动',
    tags: ['公转', '四季', '太阳直射点', '黄赤交角'],
    grade: '七年级',
    objectives: [
      '理解地球公转的方向、周期和轨道',
      '认识黄赤交角及太阳直射点的移动规律',
      '理解四季更替和五带的形成原因',
    ],
    duration: 12,
    references: [
      '义务教育地理课程标准（2022年版）',
      '人教版七年级上册第一章第三节',
    ],
    curriculumStandard: '义务教育地理课程标准 2022年版 - 地球与地图：地球的运动',
  },

  steps: [
    {
      id: 'intro',
      title: '什么是地球公转',
      narration:
        '地球绕太阳的运动叫公转。' +
        '公转方向与自转相同，也是自西向东。' +
        '公转一周约一年，约 365 天。' +
        '公转轨道是近似正圆的椭圆，太阳位于椭圆的一个焦点上。',
      lecture:
        '## 地球公转\n\n' +
        '- **方向**：自西向东\n' +
        '- **周期**：约 365 天（一年）\n' +
        '- **轨道**：近似正圆的椭圆，太阳在椭圆的一个焦点上\n' +
        '- **平均速度**：约 30 千米/秒\n\n' +
        '### 注意\n' +
        '1 月初地球位于近日点，公转速度较快；' +
        '7 月初地球位于远日点，公转速度较慢。',
      scene: {
        camera: { longitude: 0, latitude: 0, height: 40000000, duration: 3 },
        viewMode: '3d',
        basemap: 'satellite',
        layers: { astronomy: { axis: true, directPoint: true, revolution: true } },
        timeAnimation: {
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2025-01-01T00:00:00Z',
          multiplier: 86400,
        },
      },
    },
    {
      id: 'axis-tilt',
      title: '黄赤交角',
      narration:
        '地球在公转时，地轴并不是直立的，' +
        '而是倾斜的，倾角约 23.5°。' +
        '地轴的倾斜方向保持不变，始终指向北极星附近。' +
        '地轴与公转轨道面的夹角称为黄赤交角。',
      lecture:
        '## 黄赤交角\n\n' +
        '### 定义\n' +
        '地球公转轨道面（黄道面）与赤道面（地轴垂直面）的夹角，' +
        '目前约 **23.5°**。\n\n' +
        '### 关键特征\n' +
        '- 地轴倾斜方向在公转过程中基本保持不变\n' +
        '- 地轴北端始终指向北极星附近\n' +
        '- 黄赤交角决定了太阳直射点的移动范围\n\n' +
        '### 影响\n' +
        '黄赤交角的存在，使地球在公转过程中' +
        '太阳直射点在南北回归线之间往返移动，' +
        '从而产生四季更替和昼夜长短变化。',
      scene: {
        camera: { longitude: 0, latitude: 30, height: 35000000, duration: 2.5 },
        layers: { astronomy: { axis: true, directPoint: true, revolution: true } },
        timeAnimation: {
          startTime: '2024-03-21T00:00:00Z',
          endTime: '2024-09-23T00:00:00Z',
          multiplier: 43200,
        },
      },
    },
    {
      id: 'direct-point',
      title: '太阳直射点移动',
      narration:
        '由于地轴倾斜，太阳直射点在一年中会在南北回归线之间移动。' +
        '春分时直射赤道，夏至时直射北回归线，' +
        '秋分时再次直射赤道，冬至时直射南回归线。' +
        '如此循环往复，周期为一年。',
      lecture:
        '## 太阳直射点的移动\n\n' +
        '### 移动规律\n' +
        '| 节气 | 日期 | 直射点纬度 |\n' +
        '|------|------|-----------|\n' +
        '| 春分 | 3月21日前后 | 0°（赤道）|\n' +
        '| 夏至 | 6月22日前后 | 23.5°N（北回归线）|\n' +
        '| 秋分 | 9月23日前后 | 0°（赤道）|\n' +
        '| 冬至 | 12月22日前后 | 23.5°S（南回归线）|\n\n' +
        '### 移动范围\n' +
        '南北回归线之间（23.5°N ~ 23.5°S）。',
      scene: {
        camera: { longitude: 0, latitude: 0, height: 30000000, duration: 2.5 },
        layers: { astronomy: { directPoint: true, axis: true, revolution: true } },
        timeAnimation: {
          startTime: '2024-03-21T00:00:00Z',
          endTime: '2025-03-21T00:00:00Z',
          multiplier: 43200,
        },
      },
    },
    {
      id: 'four-seasons',
      title: '四季更替',
      narration:
        '太阳直射点的移动使地球不同地区接收到的太阳辐射发生变化，' +
        '从而形成四季。北半球夏至时，' +
        '北半球接收的太阳辐射最多，正值夏季；' +
        '冬至时最少，正值冬季。',
      lecture:
        '## 四季更替\n\n' +
        '### 成因\n' +
        '黄赤交角 → 太阳直射点移动 → 各地太阳高度角和昼夜长短变化 → ' +
        '接收太阳辐射差异 → 四季更替。\n\n' +
        '### 天文四季\n' +
        '- 春季：春分到夏至\n' +
        '- 夏季：夏至到秋分\n' +
        '- 秋季：秋分到冬至\n' +
        '- 冬季：冬至到次年春分\n\n' +
        '### 注意\n' +
        '南北半球季节相反。北半球夏季时，南半球为冬季。',
      scene: {
        camera: { longitude: 116, latitude: 35, height: 18000000, duration: 2.5 },
        layers: { astronomy: { directPoint: true, axis: true, twilight: true } },
        timeAnimation: {
          startTime: '2024-06-21T00:00:00Z',
          endTime: '2024-12-22T00:00:00Z',
          multiplier: 43200,
        },
      },
    },
    {
      id: 'five-belts',
      title: '五带划分',
      narration:
        '根据太阳直射点和极昼极夜现象，地球表面划分为五个热量带：' +
        '热带、北温带、南温带、北寒带、南寒带。' +
        '热带在南北回归线之间，温带在回归线与极圈之间，' +
        '寒带在极圈以内。',
      lecture:
        '## 五带划分\n\n' +
        '### 界线\n' +
        '- 南北回归线（23.5°）\n' +
        '- 南北极圈（66.5°）\n\n' +
        '### 五带\n' +
        '| 热量带 | 范围 | 特点 |\n' +
        '|-------|------|------|\n' +
        '| 热带 | 23.5°N ~ 23.5°S | 有直射阳光，终年炎热 |\n' +
        '| 北温带 | 23.5°N ~ 66.5°N | 无直射无极昼极夜，四季明显 |\n' +
        '| 南温带 | 23.5°S ~ 66.5°S | 同北温带 |\n' +
        '| 北寒带 | 66.5°N ~ 90°N | 有极昼极夜，终年寒冷 |\n' +
        '| 南寒带 | 66.5°S ~ 90°S | 同北寒带 |',
      scene: {
        camera: { longitude: 0, latitude: 0, height: 25000000, duration: 2.5 },
        layers: { astronomy: { directPoint: true, axis: true } },
      },
    },
    {
      id: 'quiz',
      title: '公转练习',
      narration: '来做一个练习。北半球夏至时，太阳直射点在哪里？',
      question: {
        id: 'revolution-quiz-1',
        type: 'choice',
        question: '北半球夏至时，太阳直射点位于？',
        options: ['赤道', '北回归线', '南回归线', '北极圈'],
        answer: '北回归线',
        explanation:
          '夏至（6月22日前后）时太阳直射北回归线（23.5°N），此时北半球白昼最长，正午太阳高度角最大。',
      },
      scene: {
        camera: { longitude: 0, latitude: 23.5, height: 30000000, duration: 2 },
        layers: { astronomy: { directPoint: true, axis: true } },
      },
    },
    {
      id: 'summary',
      title: '本节小结',
      narration:
        '今天我们学习了地球公转。' +
        '地球自西向东绕太阳公转，周期约一年。' +
        '黄赤交角约 23.5°，使太阳直射点在回归线之间移动，' +
        '产生四季更替和五带划分。',
      lecture:
        '## 本节总结\n\n' +
        '### 核心知识点\n' +
        '1. 公转方向：自西向东，周期约 365 天\n' +
        '2. 黄赤交角：约 23.5°\n' +
        '3. 太阳直射点：南北回归线之间往返移动\n' +
        '4. 四季更替：由直射点移动引起\n' +
        '5. 五带：热带、温带、寒带\n\n' +
        '### 常见误区\n' +
        '- 误以为四季是日地距离造成（实际是黄赤交角）\n' +
        '- 误以为南北半球季节相同（实际相反）',
      scene: {
        camera: { longitude: 0, latitude: 20, height: 30000000, duration: 3 },
        layers: { astronomy: { revolution: true, axis: true, directPoint: true } },
      },
    },
  ],
};

export default lesson;
