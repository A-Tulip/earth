/**
 * 典型地貌巡礼 —— 样板课程
 *
 * 目标：用"上帝视角"真实打开国内/国外典型地貌，动态观察其形态。
 * 既包含静态旁白（narration），也包含一个 AI 动态生成旁白步骤（aiPrompt），
 * 演示"课程内容不写死、可对接 AI"的能力（ISSUE-6）。
 *
 * 课标：义务教育地理课程标准 2022年版 - 中国地理 / 世界地理
 */

import { LessonPackage } from '../../src/lessons/schema';

const lesson: LessonPackage = {
  meta: {
    id: 'typical-landforms',
    level: 'junior',
    category: 'natural',
    title: '典型地貌巡礼',
    description: '用上帝视角真实观察丹霞、喀斯特、雅丹、峡谷、火山、冰川等典型地貌',
    tags: ['地貌', '丹霞', '喀斯特', '雅丹', '峡谷', '火山', '冰川'],
    grade: '八年级',
    objectives: [
      '认识常见典型地貌的形态特征',
      '将地貌形态与成因（侵蚀、堆积、外力作用）建立联系',
      '学会用"上帝视角"立体观察真实地貌',
    ],
    duration: 12,
    references: [
      '义务教育地理课程标准（2022年版）',
      '人教版八年级上册地形与地貌',
    ],
    curriculumStandard: '义务教育地理课程标准 2022年版 - 中国地理：地形与地势',
  },

  steps: [
    {
      id: 'overview',
      title: '什么是典型地貌',
      narration:
        '地表形态千姿百态，我们把形态特征鲜明、成因相对清楚的地表形态称为典型地貌。' +
        '今天我们从高空俯瞰，用"上帝视角"观察丹霞、喀斯特、雅丹、峡谷、火山和冰川。',
      lecture:
        '## 典型地貌\n\n' +
        '### 外力作用塑造地表\n' +
        '- **流水**：峡谷、喀斯特、三角洲\n' +
        '- **风力**：雅丹、沙丘\n' +
        '- **冰川**：U 形谷、冰斗\n' +
        '- **海浪**：海蚀崖、海蚀柱\n\n' +
        '### 内力作用\n' +
        '- 板块运动、火山、断层（如东非大裂谷）',
      scene: {
        camera: { longitude: 105, latitude: 35, height: 12000000, duration: 3 },
        viewMode: '3d',
        basemap: 'terrain',
        exaggeration: 2,
      },
    },
    {
      id: 'danxia',
      title: '丹霞地貌：丹霞山',
      narration:
        '这是广东韶关的丹霞山。红色的砂砾岩在流水侵蚀下，形成色如渥丹、灿若明霞的陡崖。' +
        '崖壁近乎垂直，山顶却较平坦，是典型的丹霞地貌。',
      lecture:
        '## 丹霞地貌\n\n' +
        '- **岩性**：红色砂砾岩\n' +
        '- **作用**：流水侵蚀 + 风化沿垂直节理发育\n' +
        '- **形态**：顶平、身陡、麓缓\n' +
        '- **代表**：广东丹霞山、福建武夷山、甘肃张掖',
      scene: {
        camera: { longitude: 113.746, latitude: 24.949, height: 120000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 2,
      },
    },
    {
      id: 'karst',
      title: '喀斯特地貌：桂林',
      // 该步骤不写死旁白，改用 aiPrompt 让 LLM 动态生成 —— 演示"课程内容可对接 AI"（ISSUE-6）
      aiPrompt:
        '请面向八年级学生，用一段 60-120 字的中文旁白，生动解释桂林喀斯特地貌（峰林、溶洞、漓江）的形成过程，' +
        '要点：可溶石灰岩 + 水的溶蚀作用，由地下河与溶洞发育而来；口语化、符合课标、不编造数据。',
      lecture:
        '## 喀斯特地貌（桂林）\n\n' +
        '- **岩性**：可溶性石灰岩\n' +
        '- **作用**：水的溶蚀（CO₂ 溶解）\n' +
        '- **形态**：峰林、峰丛、溶洞、地下河\n' +
        '- **影响**：地表水易渗漏，地下水资源丰富',
      scene: {
        camera: { longitude: 110.29, latitude: 25.274, height: 150000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 2,
      },
    },
    {
      id: 'yardang',
      title: '雅丹地貌：新疆魔鬼城',
      narration:
        '这里是新疆的乌尔禾魔鬼城。干旱地区，长期的风力侵蚀使平坦岩层被切割成一条条垄脊与沟槽，' +
        '形似城堡，风过时发出呜呜声，被称为"魔鬼城"。',
      lecture:
        '## 雅丹地貌\n\n' +
        '- **作用**：风力侵蚀（干旱地区）\n' +
        '- **形态**：垄脊与沟槽相间\n' +
        '- **俗称**：魔鬼城\n' +
        '- **代表**：新疆乌尔禾、甘肃敦煌',
      scene: {
        camera: { longitude: 85.75, latitude: 45, height: 200000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 2,
      },
    },
    {
      id: 'canyon',
      title: '峡谷地貌：雅鲁藏布大峡谷',
      narration:
        '雅鲁藏布大峡谷是世界最大峡谷。河流在青藏高原强烈下切，形成深邃险峻的峡谷，' +
        '垂直落差巨大，成为独特的"地球之耳"。',
      lecture:
        '## 峡谷地貌\n\n' +
        '- **作用**：流水下切侵蚀\n' +
        '- **形态**：深而窄的 V 形谷\n' +
        '- **代表**：雅鲁藏布大峡谷、美国科罗拉多大峡谷',
      scene: {
        camera: { longitude: 94.9, latitude: 29.6, height: 250000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 2.5,
      },
    },
    {
      id: 'volcano',
      title: '火山地貌：长白山天池',
      narration:
        '长白山天池是一座火山口湖。火山喷发后，火山口积水成湖，四周是陡峭的火山锥，' +
        '这是典型的内力作用塑造的地貌。',
      lecture:
        '## 火山地貌\n\n' +
        '- **作用**：内力作用（岩浆喷发）\n' +
        '- **形态**：火山锥 + 火山口湖\n' +
        '- **代表**：长白山天池、日本富士山、五大连池',
      scene: {
        camera: { longitude: 128.06, latitude: 42.006, height: 120000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 2,
      },
    },
    {
      id: 'glacier',
      title: '冰川地貌：绒布冰川',
      narration:
        '这是珠峰脚下的绒布冰川。高寒地区冰雪逐年堆积压实成冰，在重力作用下缓慢流动，' +
        '塑造出冰塔林、U 形谷等冰川地貌。',
      lecture:
        '## 冰川地貌\n\n' +
        '- **作用**：冰川侵蚀 + 堆积\n' +
        '- **形态**：冰塔林、U 形谷、冰斗、角峰\n' +
        '- **代表**：珠峰绒布冰川、阿尔卑斯山',
      scene: {
        camera: { longitude: 86.83, latitude: 28.05, height: 150000, duration: 2.5 },
        basemap: 'terrain',
        exaggeration: 2.5,
      },
    },
    {
      id: 'quiz',
      title: '地貌成因判读练习',
      narration: '现在来做一个练习。下列地貌中，主要由风力侵蚀形成的是？',
      question: {
        id: 'typical-landforms-quiz-1',
        type: 'choice',
        question: '主要由风力侵蚀形成的地貌是？',
        options: [
          '丹霞地貌',
          '雅丹地貌',
          '喀斯特地貌',
          '峡谷地貌',
        ],
        answer: '雅丹地貌',
        explanation:
          '雅丹地貌（魔鬼城）由干旱地区风力侵蚀塑造；丹霞、喀斯特、峡谷多与流水作用有关。',
      },
      scene: {
        camera: { longitude: 105, latitude: 35, height: 8000000, duration: 2 },
        basemap: 'terrain',
        exaggeration: 2,
      },
    },
    {
      id: 'summary',
      title: '本节小结',
      narration:
        '今天我们用上帝视角认识了丹霞、喀斯特、雅丹、峡谷、火山和冰川六类典型地貌。' +
        '记住：流水塑造峡谷、喀斯特、三角洲；风力塑造雅丹、沙丘；冰川塑造 U 形谷；' +
        '火山来自内力作用。地貌是内外力共同作用的结果。',
      lecture:
        '## 本节总结\n\n' +
        '| 地貌 | 主导作用 | 代表 |\n|---|---|---|\n' +
        '| 丹霞 | 流水侵蚀 | 丹霞山 |\n' +
        '| 喀斯特 | 流水溶蚀 | 桂林 |\n' +
        '| 雅丹 | 风力侵蚀 | 魔鬼城 |\n' +
        '| 峡谷 | 流水下切 | 雅鲁藏布大峡谷 |\n' +
        '| 火山 | 内力作用 | 长白山天池 |\n' +
        '| 冰川 | 冰川侵蚀 | 绒布冰川 |',
      scene: {
        camera: { longitude: 105, latitude: 35, height: 12000000, duration: 3 },
        basemap: 'terrain',
        exaggeration: 2,
      },
    },
  ],
};

export default lesson;