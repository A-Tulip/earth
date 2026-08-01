/**
 * §2.5 地理地名引用表（纯中文坐标字典，按《地理·必修 I》高频考点精选 80 条）
 *
 * 设计原则：
 *   1) 不依赖在线服务 → 课程与讲解功能不随网络中断而失效（AGENTS §7 回退）
 *   2) 匹配层级：主名命中 > 别名命中 > 省份中心回退
 *   3) 坐标为相机推荐高度（视域高度，米），保证大地点全框；局部点就近落地
 *
 * 仅用于：
 *   - LessonRuntime.playStep() 读 step.narration 时触发提及→定时飞行
 *   - 未来 AI 解释回复中的地名匹配（例如 LLM 回复文本扫描）
 */

export interface GeoRefEntry {
  /** 中文名（主名） */
  name: string;
  /** 别名，例如 "北京" = ["京城" "首都"] */
  aliases?: string[];
  /** 经度 */
  longitude: number;
  /** 纬度 */
  latitude: number;
  /** 推荐相机高度（米） */
  height: number;
  /** 标签分类：省会/直辖市/山脉/河流/湖泊/海洋/盆地/平原/高原/岛屿/海峡/国际城市 */
  kind:
    | 'capital'
    | 'mountain'
    | 'river'
    | 'lake'
    | 'sea'
    | 'basin'
    | 'plain'
    | 'plateau'
    | 'island'
    | 'strait'
    | 'global';
}

export const GEO_REFERENCES: GeoRefEntry[] = [
  // === 首都 / 直辖市 / 省会 ===
  { name: '北京', aliases: ['首都', '京城', '北平'], longitude: 116.4074, latitude: 39.9042, height: 400_000, kind: 'capital' },
  { name: '上海', aliases: ['沪', '魔都'], longitude: 121.4737, latitude: 31.2304, height: 350_000, kind: 'capital' },
  { name: '天津', aliases: ['津'], longitude: 117.2009, latitude: 39.0842, height: 350_000, kind: 'capital' },
  { name: '重庆', aliases: ['渝', '山城'], longitude: 106.5515, latitude: 29.563, height: 400_000, kind: 'capital' },
  { name: '广州', aliases: ['羊城', '穗'], longitude: 113.2644, latitude: 23.1291, height: 350_000, kind: 'capital' },
  { name: '深圳', longitude: 114.0578, latitude: 22.5431, height: 200_000, kind: 'capital' },
  { name: '南京', aliases: ['金陵', '宁'], longitude: 118.7968, latitude: 32.0603, height: 350_000, kind: 'capital' },
  { name: '杭州', aliases: ['杭'], longitude: 120.1550, latitude: 30.2741, height: 300_000, kind: 'capital' },
  { name: '武汉', aliases: ['江城'], longitude: 114.3053, latitude: 30.5930, height: 350_000, kind: 'capital' },
  { name: '成都', aliases: ['蓉城', '锦城'], longitude: 104.0665, latitude: 30.5728, height: 400_000, kind: 'capital' },
  { name: '西安', aliases: ['长安', '镐京'], longitude: 108.9398, latitude: 34.3416, height: 350_000, kind: 'capital' },
  { name: '郑州', longitude: 113.6253, latitude: 34.7466, height: 350_000, kind: 'capital' },
  { name: '长沙', longitude: 112.9388, latitude: 28.2282, height: 350_000, kind: 'capital' },
  { name: '哈尔滨', aliases: ['冰城'], longitude: 126.5350, latitude: 45.8021, height: 400_000, kind: 'capital' },
  { name: '乌鲁木齐', aliases: ['乌市'], longitude: 87.6168, latitude: 43.7928, height: 400_000, kind: 'capital' },
  { name: '拉萨', longitude: 91.1322, latitude: 29.6604, height: 400_000, kind: 'capital' },
  { name: '昆明', aliases: ['春城'], longitude: 102.8329, latitude: 24.8801, height: 350_000, kind: 'capital' },
  { name: '台北', longitude: 121.5654, latitude: 25.0330, height: 200_000, kind: 'capital' },
  { name: '海口', longitude: 110.3312, latitude: 20.0319, height: 200_000, kind: 'capital' },
  { name: '三亚', longitude: 109.5082, latitude: 18.2528, height: 200_000, kind: 'capital' },

  // === 山脉 / 山峰 ===
  { name: '喜马拉雅山', aliases: ['喜马拉雅山脉'], longitude: 86.0, latitude: 28.0, height: 1_200_000, kind: 'mountain' },
  { name: '珠穆朗玛峰', aliases: ['珠峰', '萨加玛塔峰'], longitude: 86.9250, latitude: 27.9881, height: 200_000, kind: 'mountain' },
  { name: '昆仑山', aliases: ['昆仑山脉'], longitude: 84.0, latitude: 36.0, height: 1_500_000, kind: 'mountain' },
  { name: '天山', aliases: ['天山山脉'], longitude: 79.0, latitude: 42.0, height: 1_500_000, kind: 'mountain' },
  { name: '秦岭', aliases: ['秦岭山脉'], longitude: 107.0, latitude: 34.0, height: 800_000, kind: 'mountain' },
  { name: '大兴安岭', aliases: ['大鲜卑山'], longitude: 120.0, latitude: 51.0, height: 1_000_000, kind: 'mountain' },
  { name: '太行山', aliases: ['太行山脉'], longitude: 114.0, latitude: 37.5, height: 700_000, kind: 'mountain' },
  { name: '武夷山', aliases: ['武夷山脉'], longitude: 117.8, latitude: 27.8, height: 500_000, kind: 'mountain' },
  { name: '泰山', longitude: 117.1034, latitude: 36.2574, height: 150_000, kind: 'mountain' },
  { name: '华山', longitude: 110.0965, latitude: 34.4889, height: 150_000, kind: 'mountain' },
  { name: '黄山', longitude: 118.1664, latitude: 30.1256, height: 150_000, kind: 'mountain' },
  { name: '庐山', longitude: 115.8922, latitude: 29.5462, height: 150_000, kind: 'mountain' },
  { name: '长白山', aliases: ['白头山'], longitude: 128.1, latitude: 41.5, height: 300_000, kind: 'mountain' },
  { name: '阿尔卑斯山', aliases: ['阿尔卑斯山脉'], longitude: 10.2, latitude: 46.5, height: 1_000_000, kind: 'mountain' },
  { name: '落基山', aliases: ['落基山脉', '洛矶山脉'], longitude: -112.0, latitude: 42.0, height: 1_500_000, kind: 'mountain' },
  { name: '安第斯山', aliases: ['安第斯山脉'], longitude: -70.0, latitude: -20.0, height: 1_500_000, kind: 'mountain' },

  // === 河流 ===
  { name: '长江', aliases: ['扬子江'], longitude: 112.0, latitude: 31.0, height: 1_500_000, kind: 'river' },
  { name: '黄河', longitude: 104.0, latitude: 37.0, height: 1_500_000, kind: 'river' },
  { name: '珠江', longitude: 112.5, latitude: 23.0, height: 1_000_000, kind: 'river' },
  { name: '淮河', longitude: 118.0, latitude: 33.0, height: 800_000, kind: 'river' },
  { name: '京杭运河', aliases: ['京杭大运河'], longitude: 117.0, latitude: 35.0, height: 1_000_000, kind: 'river' },
  { name: '塔里木河', longitude: 81.0, latitude: 40.0, height: 800_000, kind: 'river' },
  { name: '尼罗河', longitude: 31.0, latitude: 26.0, height: 2_000_000, kind: 'river' },
  { name: '亚马孙河', aliases: ['亚马逊河'], longitude: -55.0, latitude: -2.0, height: 2_000_000, kind: 'river' },
  { name: '密西西比河', longitude: -89.0, latitude: 37.0, height: 1_500_000, kind: 'river' },

  // === 湖泊 ===
  { name: '青海湖', longitude: 100.1, latitude: 36.9, height: 250_000, kind: 'lake' },
  { name: '鄱阳湖', longitude: 116.2, latitude: 29.1, height: 200_000, kind: 'lake' },
  { name: '洞庭湖', longitude: 112.9, latitude: 29.4, height: 200_000, kind: 'lake' },
  { name: '太湖', longitude: 120.3, latitude: 31.2, height: 150_000, kind: 'lake' },
  { name: '贝加尔湖', longitude: 107.8, latitude: 53.5, height: 400_000, kind: 'lake' },
  { name: '里海', longitude: 50.0, latitude: 42.0, height: 600_000, kind: 'lake' },
  { name: '死海', longitude: 35.5, latitude: 31.5, height: 200_000, kind: 'lake' },
  { name: '苏必利尔湖', longitude: -87.0, latitude: 47.8, height: 400_000, kind: 'lake' },

  // === 海洋 / 海峡 ===
  { name: '太平洋', longitude: 150.0, latitude: 10.0, height: 8_000_000, kind: 'sea' },
  { name: '大西洋', longitude: -30.0, latitude: 15.0, height: 8_000_000, kind: 'sea' },
  { name: '印度洋', longitude: 70.0, latitude: -10.0, height: 8_000_000, kind: 'sea' },
  { name: '北冰洋', longitude: 10.0, latitude: 85.0, height: 8_000_000, kind: 'sea' },
  { name: '渤海', longitude: 119.5, latitude: 39.2, height: 500_000, kind: 'sea' },
  { name: '黄海', longitude: 123.5, latitude: 36.5, height: 800_000, kind: 'sea' },
  { name: '东海', longitude: 125.5, latitude: 29.5, height: 800_000, kind: 'sea' },
  { name: '南海', longitude: 112.0, latitude: 15.0, height: 1_500_000, kind: 'sea' },
  { name: '台湾海峡', longitude: 119.5, latitude: 25.0, height: 500_000, kind: 'strait' },
  { name: '琼州海峡', longitude: 110.3, latitude: 20.1, height: 250_000, kind: 'strait' },
  { name: '马六甲海峡', longitude: 101.0, latitude: 2.5, height: 500_000, kind: 'strait' },
  { name: '直布罗陀海峡', longitude: -5.0, latitude: 36.0, height: 300_000, kind: 'strait' },

  // === 盆地 / 平原 / 高原 ===
  { name: '四川盆地', longitude: 105.5, latitude: 30.0, height: 600_000, kind: 'basin' },
  { name: '塔里木盆地', longitude: 84.0, latitude: 40.0, height: 900_000, kind: 'basin' },
  { name: '准噶尔盆地', longitude: 85.0, latitude: 45.0, height: 700_000, kind: 'basin' },
  { name: '柴达木盆地', longitude: 94.0, latitude: 37.5, height: 600_000, kind: 'basin' },
  { name: '东北平原', longitude: 125.0, latitude: 45.0, height: 900_000, kind: 'plain' },
  { name: '华北平原', longitude: 116.0, latitude: 37.0, height: 700_000, kind: 'plain' },
  { name: '长江中下游平原', longitude: 115.0, latitude: 30.5, height: 900_000, kind: 'plain' },
  { name: '青藏高原', longitude: 90.0, latitude: 32.0, height: 2_000_000, kind: 'plateau' },
  { name: '黄土高原', longitude: 107.0, latitude: 37.0, height: 900_000, kind: 'plateau' },
  { name: '云贵高原', longitude: 104.0, latitude: 26.0, height: 800_000, kind: 'plateau' },
  { name: '内蒙古高原', longitude: 112.0, latitude: 42.0, height: 900_000, kind: 'plateau' },

  // === 岛屿 ===
  { name: '台湾岛', aliases: ['宝岛'], longitude: 121.0, latitude: 23.8, height: 400_000, kind: 'island' },
  { name: '海南岛', longitude: 109.7, latitude: 19.2, height: 300_000, kind: 'island' },
  { name: '钓鱼岛', longitude: 123.5, latitude: 25.7, height: 100_000, kind: 'island' },
  { name: '南沙群岛', longitude: 112.5, latitude: 10.0, height: 600_000, kind: 'island' },
  { name: '西沙群岛', longitude: 111.8, latitude: 16.8, height: 400_000, kind: 'island' },

  // === 国际城市 ===
  { name: '东京', longitude: 139.6917, latitude: 35.6895, height: 400_000, kind: 'global' },
  { name: '纽约', longitude: -74.0060, latitude: 40.7128, height: 400_000, kind: 'global' },
  { name: '伦敦', longitude: -0.1276, latitude: 51.5072, height: 400_000, kind: 'global' },
  { name: '巴黎', longitude: 2.3522, latitude: 48.8566, height: 400_000, kind: 'global' },
  { name: '莫斯科', longitude: 37.6173, latitude: 55.7558, height: 400_000, kind: 'global' },
  { name: '悉尼', longitude: 151.2093, latitude: -33.8688, height: 400_000, kind: 'global' },
  { name: '开罗', longitude: 31.2357, latitude: 30.0444, height: 400_000, kind: 'global' },
];

/** 构建正反名字典，避免每次 O(n) */
function buildNameIndex(): Map<string, GeoRefEntry> {
  const idx = new Map<string, GeoRefEntry>();
  for (const e of GEO_REFERENCES) {
    idx.set(e.name, e);
    for (const a of e.aliases ?? []) idx.set(a, e);
  }
  return idx;
}

const NAME_INDEX = buildNameIndex();

/**
 * 匹配文本中出现的第一个地名，返回对应的推荐镜头位置。
 * @param text 任意中文文本（旁白 / LLM 回复 / 用户输入）
 * @returns 首个命中的词条或 null
 */
export function findFirstMention(text: string | null | undefined): GeoRefEntry | null {
  if (!text) return null;
  // 优先匹配更长的名字，避免"海南"匹配了"海南岛"前两字后子串命中顺序差
  const names = Array.from(NAME_INDEX.keys()).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (text.includes(name)) return NAME_INDEX.get(name) ?? null;
  }
  return null;
}

/** 直接按主名/别名查询 */
export function lookupGeoName(name: string): GeoRefEntry | null {
  return NAME_INDEX.get(name) ?? null;
}
