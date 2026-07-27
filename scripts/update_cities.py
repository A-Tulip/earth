import re

with open('earth.html', 'r', encoding='utf-8') as f:
    content = f.read()

new_cities = '''    const cities = {
      // ============ 中国城市 ============
      beijing: { name: '北京', lat: 39.9, lon: 116.4, country: '中国', province: '北京', population: '2189万', timezone: 'UTC+8', area: '16410km²', type: 'capital', continent: 'asia' },
      shanghai: { name: '上海', lat: 31.2, lon: 121.5, country: '中国', province: '上海', population: '2487万', timezone: 'UTC+8', area: '6340km²', type: 'city', continent: 'asia' },
      tianjin: { name: '天津', lat: 39.1, lon: 117.2, country: '中国', province: '天津', population: '1387万', timezone: 'UTC+8', area: '11966km²', type: 'city', continent: 'asia' },
      chongqing: { name: '重庆', lat: 29.4, lon: 106.9, country: '中国', province: '重庆', population: '3205万', timezone: 'UTC+8', area: '82400km²', type: 'city', continent: 'asia' },
      hongkong: { name: '香港', lat: 22.3, lon: 114.2, country: '中国', province: '香港', population: '747万', timezone: 'UTC+8', area: '1106km²', type: 'city', continent: 'asia' },
      macao: { name: '澳门', lat: 22.1, lon: 113.5, country: '中国', province: '澳门', population: '68万', timezone: 'UTC+8', area: '32km²', type: 'city', continent: 'asia' },
      taipei: { name: '台北', lat: 25.1, lon: 121.5, country: '中国', province: '台湾', population: '275万', timezone: 'UTC+8', area: '271km²', type: 'city', continent: 'asia' },
      
      // 华北地区
      shijiazhuang: { name: '石家庄', lat: 38.0, lon: 114.5, country: '中国', province: '河北', population: '1124万', timezone: 'UTC+8', area: '15848km²', type: 'city', continent: 'asia' },
      taiyuan: { name: '太原', lat: 37.9, lon: 112.5, country: '中国', province: '山西', population: '455万', timezone: 'UTC+8', area: '6988km²', type: 'city', continent: 'asia' },
      hohohot: { name: '呼和浩特', lat: 40.8, lon: 111.7, country: '中国', province: '内蒙古', population: '344万', timezone: 'UTC+8', area: '17224km²', type: 'city', continent: 'asia' },
      
      // 东北地区
      shenyang: { name: '沈阳', lat: 41.8, lon: 123.4, country: '中国', province: '辽宁', population: '907万', timezone: 'UTC+8', area: '12948km²', type: 'city', continent: 'asia' },
      dalian: { name: '大连', lat: 38.9, lon: 121.6, country: '中国', province: '辽宁', population: '745万', timezone: 'UTC+8', area: '12574km²', type: 'city', continent: 'asia' },
      changchun: { name: '长春', lat: 43.9, lon: 125.3, country: '中国', province: '吉林', population: '906万', timezone: 'UTC+8', area: '20604km²', type: 'city', continent: 'asia' },
      harbin: { name: '哈尔滨', lat: 45.8, lon: 126.6, country: '中国', province: '黑龙江', population: '1001万', timezone: 'UTC+8', area: '53068km²', type: 'city', continent: 'asia' },
      
      // 华东地区
      jinan: { name: '济南', lat: 36.6, lon: 116.9, country: '中国', province: '山东', population: '920万', timezone: 'UTC+8', area: '10244km²', type: 'city', continent: 'asia' },
      qingdao: { name: '青岛', lat: 36.1, lon: 120.4, country: '中国', province: '山东', population: '1010万', timezone: 'UTC+8', area: '11293km²', type: 'city', continent: 'asia' },
      nanjing: { name: '南京', lat: 32.1, lon: 118.8, country: '中国', province: '江苏', population: '931万', timezone: 'UTC+8', area: '6587km²', type: 'city', continent: 'asia' },
      suzhou: { name: '苏州', lat: 31.3, lon: 120.6, country: '中国', province: '江苏', population: '1274万', timezone: 'UTC+8', area: '8657km²', type: 'city', continent: 'asia' },
      hangzhou: { name: '杭州', lat: 30.3, lon: 120.2, country: '中国', province: '浙江', population: '1220万', timezone: 'UTC+8', area: '16850km²', type: 'city', continent: 'asia' },
      ningbo: { name: '宁波', lat: 29.8, lon: 121.5, country: '中国', province: '浙江', population: '955万', timezone: 'UTC+8', area: '9816km²', type: 'city', continent: 'asia' },
      fuzhou: { name: '福州', lat: 26.1, lon: 119.3, country: '中国', province: '福建', population: '829万', timezone: 'UTC+8', area: '11968km²', type: 'city', continent: 'asia' },
      xiamen: { name: '厦门', lat: 24.5, lon: 118.1, country: '中国', province: '福建', population: '516万', timezone: 'UTC+8', area: '1700km²', type: 'city', continent: 'asia' },
      hefei: { name: '合肥', lat: 31.8, lon: 117.2, country: '中国', province: '安徽', population: '937万', timezone: 'UTC+8', area: '11445km²', type: 'city', continent: 'asia' },
      
      // 江西省
      nanchang: { name: '南昌', lat: 28.6, lon: 115.9, country: '中国', province: '江西', population: '625万', timezone: 'UTC+8', area: '7402km²', type: 'city', continent: 'asia' },
      jingdezhen: { name: '景德镇', lat: 29.2, lon: 117.2, country: '中国', province: '江西', population: '162万', timezone: 'UTC+8', area: '5256km²', type: 'city', continent: 'asia' },
      pingxiang: { name: '萍乡', lat: 27.6, lon: 113.8, country: '中国', province: '江西', population: '180万', timezone: 'UTC+8', area: '3831km²', type: 'city', continent: 'asia' },
      jiujiang: { name: '九江', lat: 29.7, lon: 115.9, country: '中国', province: '江西', population: '457万', timezone: 'UTC+8', area: '18823km²', type: 'city', continent: 'asia' },
      xinyu: { name: '新余', lat: 27.8, lon: 114.9, country: '中国', province: '江西', population: '120万', timezone: 'UTC+8', area: '3178km²', type: 'city', continent: 'asia' },
      yingtan: { name: '鹰潭', lat: 28.2, lon: 117.0, country: '中国', province: '江西', population: '115万', timezone: 'UTC+8', area: '3556km²', type: 'city', continent: 'asia' },
      ganzhou: { name: '赣州', lat: 25.8, lon: 114.9, country: '中国', province: '江西', population: '898万', timezone: 'UTC+8', area: '39379km²', type: 'city', continent: 'asia' },
      jian: { name: '吉安', lat: 27.1, lon: 114.9, country: '中国', province: '江西', population: '446万', timezone: 'UTC+8', area: '25283km²', type: 'city', continent: 'asia' },
      yichun: { name: '宜春', lat: 27.8, lon: 114.3, country: '中国', province: '江西', population: '501万', timezone: 'UTC+8', area: '18680km²', type: 'city', continent: 'asia' },
      fuzhou_jiangxi: { name: '抚州', lat: 28.0, lon: 116.3, country: '中国', province: '江西', population: '361万', timezone: 'UTC+8', area: '18817km²', type: 'city', continent: 'asia' },
      shangrao: { name: '上饶', lat: 28.4, lon: 117.9, country: '中国', province: '江西', population: '649万', timezone: 'UTC+8', area: '22791km²', type: 'city', continent: 'asia' },
      
      // 华中地区
      wuhan: { name: '武汉', lat: 30.6, lon: 114.3, country: '中国', province: '湖北', population: '1365万', timezone: 'UTC+8', area: '8569km²', type: 'city', continent: 'asia' },
      changsha: { name: '长沙', lat: 28.2, lon: 112.9, country: '中国', province: '湖南', population: '1023万', timezone: 'UTC+8', area: '11819km²', type: 'city', continent: 'asia' },
      zhengzhou: { name: '郑州', lat: 34.7, lon: 113.6, country: '中国', province: '河南', population: '1260万', timezone: 'UTC+8', area: '7567km²', type: 'city', continent: 'asia' },
      
      // 华南地区
      guangzhou: { name: '广州', lat: 23.1, lon: 113.3, country: '中国', province: '广东', population: '1881万', timezone: 'UTC+8', area: '7434km²', type: 'city', continent: 'asia' },
      shenzhen: { name: '深圳', lat: 22.5, lon: 114.1, country: '中国', province: '广东', population: '1768万', timezone: 'UTC+8', area: '1997km²', type: 'city', continent: 'asia' },
      nanning: { name: '南宁', lat: 22.8, lon: 108.3, country: '中国', province: '广西', population: '874万', timezone: 'UTC+8', area: '22112km²', type: 'city', continent: 'asia' },
      haikou: { name: '海口', lat: 20.0, lon: 110.3, country: '中国', province: '海南', population: '293万', timezone: 'UTC+8', area: '3126km²', type: 'city', continent: 'asia' },
      
      // 西南地区
      chengdu: { name: '成都', lat: 30.6, lon: 104.0, country: '中国', province: '四川', population: '2119万', timezone: 'UTC+8', area: '14335km²', type: 'city', continent: 'asia' },
      kunming: { name: '昆明', lat: 25.0, lon: 102.7, country: '中国', province: '云南', population: '850万', timezone: 'UTC+8', area: '21473km²', type: 'city', continent: 'asia' },
      guiyang: { name: '贵阳', lat: 26.6, lon: 106.7, country: '中国', province: '贵州', population: '620万', timezone: 'UTC+8', area: '8034km²', type: 'city', continent: 'asia' },
      lhasa: { name: '拉萨', lat: 29.6, lon: 91.1, country: '中国', province: '西藏', population: '86万', timezone: 'UTC+8', area: '29518km²', type: 'city', continent: 'asia' },
      lijiang: { name: '丽江', lat: 26.9, lon: 100.2, country: '中国', province: '云南', population: '125万', timezone: 'UTC+8', area: '20600km²', type: 'city', continent: 'asia' },
      
      // 西北地区
      xian: { name: '西安', lat: 34.3, lon: 108.9, country: '中国', province: '陕西', population: '1218万', timezone: 'UTC+8', area: '10108km²', type: 'city', continent: 'asia' },
      lanzhou: { name: '兰州', lat: 36.0, lon: 103.8, country: '中国', province: '甘肃', population: '436万', timezone: 'UTC+8', area: '13085km²', type: 'city', continent: 'asia' },
      xining: { name: '西宁', lat: 36.6, lon: 101.8, country: '中国', province: '青海', population: '247万', timezone: 'UTC+8', area: '7665km²', type: 'city', continent: 'asia' },
      yinchuan: { name: '银川', lat: 38.5, lon: 106.2, country: '中国', province: '宁夏', population: '288万', timezone: 'UTC+8', area: '9025km²', type: 'city', continent: 'asia' },
      urumqi: { name: '乌鲁木齐', lat: 43.8, lon: 87.6, country: '中国', province: '新疆', population: '405万', timezone: 'UTC+6', area: '14216km²', type: 'city', continent: 'asia' },
      
      // ============ 亚洲城市 ============
      tokyo: { name: '东京', lat: 35.7, lon: 139.7, country: '日本', population: '3740万', timezone: 'UTC+9', area: '2194km²', type: 'capital', continent: 'asia' },
      osaka: { name: '大阪', lat: 34.6, lon: 135.5, country: '日本', population: '1913万', timezone: 'UTC+9', area: '225km²', type: 'city', continent: 'asia' },
      kyoto: { name: '京都', lat: 35.0, lon: 135.8, country: '日本', population: '147万', timezone: 'UTC+9', area: '828km²', type: 'city', continent: 'asia' },
      seoul: { name: '首尔', lat: 37.6, lon: 126.9, country: '韩国', population: '997万', timezone: 'UTC+9', area: '605km²', type: 'capital', continent: 'asia' },
      busan: { name: '釜山', lat: 35.1, lon: 129.0, country: '韩国', population: '341万', timezone: 'UTC+9', area: '769km²', type: 'city', continent: 'asia' },
      singapore: { name: '新加坡', lat: 1.3, lon: 103.8, country: '新加坡', population: '591万', timezone: 'UTC+8', area: '728km²', type: 'capital', continent: 'asia' },
      bangkok: { name: '曼谷', lat: 13.7, lon: 100.5, country: '泰国', population: '1015万', timezone: 'UTC+7', area: '1568km²', type: 'capital', continent: 'asia' },
      phuket: { name: '普吉', lat: 8.1, lon: 98.3, country: '泰国', population: '41万', timezone: 'UTC+7', area: '576km²', type: 'city', continent: 'asia' },
      dubai: { name: '迪拜', lat: 25.3, lon: 55.3, country: '阿联酋', population: '340万', timezone: 'UTC+4', area: '4114km²', type: 'city', continent: 'asia' },
      abudhabi: { name: '阿布扎比', lat: 24.4, lon: 54.4, country: '阿联酋', population: '157万', timezone: 'UTC+4', area: '67340km²', type: 'capital', continent: 'asia' },
      mumbai: { name: '孟买', lat: 19.1, lon: 72.9, country: '印度', population: '2041万', timezone: 'UTC+5:30', area: '603km²', type: 'city', continent: 'asia' },
      delhi: { name: '新德里', lat: 28.6, lon: 77.2, country: '印度', population: '3118万', timezone: 'UTC+5:30', area: '1484km²', type: 'capital', continent: 'asia' },
      bangalore: { name: '班加罗尔', lat: 12.9, lon: 77.6, country: '印度', population: '1360万', timezone: 'UTC+5:30', area: '805km²', type: 'city', continent: 'asia' },
      kolkata: { name: '加尔各答', lat: 22.5, lon: 88.3, country: '印度', population: '1531万', timezone: 'UTC+5:30', area: '185km²', type: 'city', continent: 'asia' },
      jakarta: { name: '雅加达', lat: -6.2, lon: 106.8, country: '印度尼西亚', population: '3375万', timezone: 'UTC+7', area: '661km²', type: 'capital', continent: 'asia' },
      bali: { name: '巴厘岛', lat: -8.4, lon: 115.2, country: '印度尼西亚', population: '431万', timezone: 'UTC+8', area: '5780km²', type: 'city', continent: 'asia' },
      manila: { name: '马尼拉', lat: 14.6, lon: 121.0, country: '菲律宾', population: '1392万', timezone: 'UTC+8', area: '638km²', type: 'capital', continent: 'asia' },
      hanoi: { name: '河内', lat: 21.0, lon: 105.8, country: '越南', population: '805万', timezone: 'UTC+7', area: '3324km²', type: 'capital', continent: 'asia' },
      hoChiMinh: { name: '胡志明市', lat: 10.8, lon: 106.7, country: '越南', population: '921万', timezone: 'UTC+7', area: '2095km²', type: 'city', continent: 'asia' },
      kualaLumpur: { name: '吉隆坡', lat: 3.1, lon: 101.7, country: '马来西亚', population: '198万', timezone: 'UTC+8', area: '243km²', type: 'capital', continent: 'asia' },
      penang: { name: '槟城', lat: 5.4, lon: 100.3, country: '马来西亚', population: '177万', timezone: 'UTC+8', area: '1048km²', type: 'city', continent: 'asia' },
      manama: { name: '麦纳麦', lat: 26.2, lon: 50.6, country: '巴林', population: '157万', timezone: 'UTC+3', area: '78km²', type: 'capital', continent: 'asia' },
      doha: { name: '多哈', lat: 25.3, lon: 51.6, country: '卡塔尔', population: '293万', timezone: 'UTC+3', area: '132km²', type: 'capital', continent: 'asia' },
      
      // ============ 欧洲城市 ============
      moscow: { name: '莫斯科', lat: 55.8, lon: 37.6, country: '俄罗斯', population: '1250万', timezone: 'UTC+3', area: '2561km²', type: 'capital', continent: 'europe' },
      stpetersburg: { name: '圣彼得堡', lat: 59.9, lon: 30.3, country: '俄罗斯', population: '538万', timezone: 'UTC+3', area: '1439km²', type: 'city', continent: 'europe' },
      london: { name: '伦敦', lat: 51.5, lon: -0.1, country: '英国', population: '930万', timezone: 'UTC±0', area: '1572km²', type: 'capital', continent: 'europe' },
      edinburgh: { name: '爱丁堡', lat: 55.9, lon: -3.2, country: '英国', population: '52万', timezone: 'UTC±0', area: '264km²', type: 'city', continent: 'europe' },
      paris: { name: '巴黎', lat: 48.9, lon: 2.3, country: '法国', population: '1085万', timezone: 'UTC+1', area: '105km²', type: 'capital', continent: 'europe' },
      lyon: { name: '里昂', lat: 45.8, lon: 4.9, country: '法国', population: '500万', timezone: 'UTC+1', area: '47km²', type: 'city', continent: 'europe' },
      berlin: { name: '柏林', lat: 52.5, lon: 13.4, country: '德国', population: '376万', timezone: 'UTC+1', area: '891km²', type: 'capital', continent: 'europe' },
      munich: { name: '慕尼黑', lat: 48.1, lon: 11.6, country: '德国', population: '151万', timezone: 'UTC+1', area: '311km²', type: 'city', continent: 'europe' },
      rome: { name: '罗马', lat: 41.9, lon: 12.5, country: '意大利', population: '287万', timezone: 'UTC+1', area: '1285km²', type: 'capital', continent: 'europe' },
      venice: { name: '威尼斯', lat: 45.4, lon: 12.3, country: '意大利', population: '26万', timezone: 'UTC+1', area: '414km²', type: 'city', continent: 'europe' },
      madrid: { name: '马德里', lat: 40.4, lon: -3.7, country: '西班牙', population: '661万', timezone: 'UTC+1', area: '607km²', type: 'capital', continent: 'europe' },
      barcelona: { name: '巴塞罗那', lat: 41.4, lon: 2.2, country: '西班牙', population: '557万', timezone: 'UTC+1', area: '101km²', type: 'city', continent: 'europe' },
      lisbon: { name: '里斯本', lat: 38.7, lon: -9.1, country: '葡萄牙', population: '300万', timezone: 'UTC±0', area: '84km²', type: 'capital', continent: 'europe' },
      amsterdam: { name: '阿姆斯特丹', lat: 52.4, lon: 4.9, country: '荷兰', population: '214万', timezone: 'UTC+1', area: '219km²', type: 'capital', continent: 'europe' },
      brussels: { name: '布鲁塞尔', lat: 50.9, lon: 4.4, country: '比利时', population: '120万', timezone: 'UTC+1', area: '162km²', type: 'capital', continent: 'europe' },
      copenhagen: { name: '哥本哈根', lat: 55.7, lon: 12.6, country: '丹麦', population: '136万', timezone: 'UTC+1', area: '97km²', type: 'capital', continent: 'europe' },
      stockholm: { name: '斯德哥尔摩', lat: 59.3, lon: 18.1, country: '瑞典', population: '98万', timezone: 'UTC+1', area: '188km²', type: 'capital', continent: 'europe' },
      oslo: { name: '奥斯陆', lat: 59.9, lon: 10.8, country: '挪威', population: '69万', timezone: 'UTC+1', area: '454km²', type: 'capital', continent: 'europe' },
      helsinki: { name: '赫尔辛基', lat: 60.2, lon: 25.0, country: '芬兰', population: '65万', timezone: 'UTC+2', area: '719km²', type: 'capital', continent: 'europe' },
      prague: { name: '布拉格', lat: 50.1, lon: 14.4, country: '捷克', population: '130万', timezone: 'UTC+1', area: '496km²', type: 'capital', continent: 'europe' },
      vienna: { name: '维也纳', lat: 48.2, lon: 16.3, country: '奥地利', population: '190万', timezone: 'UTC+1', area: '415km²', type: 'capital', continent: 'europe' },
      warsaw: { name: '华沙', lat: 52.2, lon: 21.0, country: '波兰', population: '179万', timezone: 'UTC+1', area: '517km²', type: 'capital', continent: 'europe' },
      budapest: { name: '布达佩斯', lat: 47.5, lon: 19.1, country: '匈牙利', population: '172万', timezone: 'UTC+1', area: '525km²', type: 'capital', continent: 'europe' },
      athens: { name: '雅典', lat: 37.9, lon: 23.7, country: '希腊', population: '665万', timezone: 'UTC+2', area: '389km²', type: 'capital', continent: 'europe' },
      
      // ============ 北美洲城市 ============
      newyork: { name: '纽约', lat: 40.7, lon: -74.0, country: '美国', population: '833万', timezone: 'UTC-5', area: '783km²', type: 'city', continent: 'northAmerica' },
      losangeles: { name: '洛杉矶', lat: 34.1, lon: -118.2, country: '美国', population: '398万', timezone: 'UTC-8', area: '1302km²', type: 'city', continent: 'northAmerica' },
      chicago: { name: '芝加哥', lat: 41.9, lon: -87.7, country: '美国', population: '274万', timezone: 'UTC-6', area: '606km²', type: 'city', continent: 'northAmerica' },
      washington: { name: '华盛顿', lat: 38.9, lon: -77.0, country: '美国', population: '71万', timezone: 'UTC-5', area: '177km²', type: 'capital', continent: 'northAmerica' },
      sanfrancisco: { name: '旧金山', lat: 37.8, lon: -122.4, country: '美国', population: '81万', timezone: 'UTC-8', area: '121km²', type: 'city', continent: 'northAmerica' },
      miami: { name: '迈阿密', lat: 25.8, lon: -80.2, country: '美国', population: '44万', timezone: 'UTC-5', area: '56km²', type: 'city', continent: 'northAmerica' },
      lasvegas: { name: '拉斯维加斯', lat: 36.1, lon: -115.2, country: '美国', population: '65万', timezone: 'UTC-8', area: '352km²', type: 'city', continent: 'northAmerica' },
      houston: { name: '休斯顿', lat: 29.8, lon: -95.4, country: '美国', population: '232万', timezone: 'UTC-6', area: '1625km²', type: 'city', continent: 'northAmerica' },
      toronto: { name: '多伦多', lat: 43.7, lon: -79.4, country: '加拿大', population: '273万', timezone: 'UTC-5', area: '630km²', type: 'capital', continent: 'northAmerica' },
      vancouver: { name: '温哥华', lat: 49.3, lon: -123.1, country: '加拿大', population: '67万', timezone: 'UTC-8', area: '115km²', type: 'city', continent: 'northAmerica' },
      montreal: { name: '蒙特利尔', lat: 45.5, lon: -73.6, country: '加拿大', population: '176万', timezone: 'UTC-5', area: '365km²', type: 'city', continent: 'northAmerica' },
      mexico: { name: '墨西哥城', lat: 19.4, lon: -99.1, country: '墨西哥', population: '920万', timezone: 'UTC-6', area: '1485km²', type: 'capital', continent: 'northAmerica' },
      cancun: { name: '坎昆', lat: 21.1, lon: -86.8, country: '墨西哥', population: '82万', timezone: 'UTC-5', area: '67km²', type: 'city', continent: 'northAmerica' },
      
      // ============ 南美洲城市 ============
      rio: { name: '里约热内卢', lat: -22.9, lon: -43.2, country: '巴西', population: '674万', timezone: 'UTC-3', area: '1260km²', type: 'city', continent: 'southAmerica' },
      saoPaulo: { name: '圣保罗', lat: -23.5, lon: -46.6, country: '巴西', population: '1230万', timezone: 'UTC-3', area: '1521km²', type: 'city', continent: 'southAmerica' },
      buenosaires: { name: '布宜诺斯艾利斯', lat: -34.6, lon: -58.4, country: '阿根廷', population: '307万', timezone: 'UTC-3', area: '203km²', type: 'capital', continent: 'southAmerica' },
      santiago: { name: '圣地亚哥', lat: -33.5, lon: -70.6, country: '智利', population: '720万', timezone: 'UTC-4', area: '641km²', type: 'capital', continent: 'southAmerica' },
      lima: { name: '利马', lat: -12.1, lon: -77.0, country: '秘鲁', population: '975万', timezone: 'UTC-5', area: '2672km²', type: 'capital', continent: 'southAmerica' },
      
      // ============ 非洲城市 ============
      cairo: { name: '开罗', lat: 30.0, lon: 31.2, country: '埃及', population: '2132万', timezone: 'UTC+2', area: '3085km²', type: 'capital', continent: 'africa' },
      alexandria: { name: '亚历山大', lat: 31.2, lon: 29.9, country: '埃及', population: '531万', timezone: 'UTC+2', area: '267km²', type: 'city', continent: 'africa' },
      johannesburg: { name: '约翰内斯堡', lat: -26.2, lon: 28.1, country: '南非', population: '561万', timezone: 'UTC+2', area: '1648km²', type: 'city', continent: 'africa' },
      capeTown: { name: '开普敦', lat: -33.9, lon: 18.4, country: '南非', population: '461万', timezone: 'UTC+2', area: '2454km²', type: 'city', continent: 'africa' },
      nairobi: { name: '内罗毕', lat: -1.3, lon: 36.8, country: '肯尼亚', population: '439万', timezone: 'UTC+3', area: '696km²', type: 'capital', continent: 'africa' },
      lagos: { name: '拉各斯', lat: 6.5, lon: 3.4, country: '尼日利亚', population: '2100万', timezone: 'UTC+1', area: '1171km²', type: 'city', continent: 'africa' },
      casablanca: { name: '卡萨布兰卡', lat: 33.6, lon: -7.6, country: '摩洛哥', population: '371万', timezone: 'UTC±0', area: '230km²', type: 'city', continent: 'africa' },
      
      // ============ 大洋洲城市 ============
      sydney: { name: '悉尼', lat: -33.9, lon: 151.2, country: '澳大利亚', population: '531万', timezone: 'UTC+10', area: '12368km²', type: 'city', continent: 'oceania' },
      melbourne: { name: '墨尔本', lat: -37.8, lon: 145.0, country: '澳大利亚', population: '509万', timezone: 'UTC+10', area: '9990km²', type: 'city', continent: 'oceania' },
      brisbane: { name: '布里斯班', lat: -27.5, lon: 153.0, country: '澳大利亚', population: '256万', timezone: 'UTC+10', area: '15842km²', type: 'city', continent: 'oceania' },
      perth: { name: '珀斯', lat: -32.0, lon: 115.9, country: '澳大利亚', population: '216万', timezone: 'UTC+8', area: '6417km²', type: 'city', continent: 'oceania' },
      auckland: { name: '奥克兰', lat: -36.9, lon: 174.8, country: '新西兰', population: '173万', timezone: 'UTC+12', area: '1086km²', type: 'city', continent: 'oceania' },
      wellington: { name: '惠灵顿', lat: -41.3, lon: 174.8, country: '新西兰', population: '41万', timezone: 'UTC+12', area: '266km²', type: 'capital', continent: 'oceania' },
      antarctica: { name: '南极点', lat: -90.0, lon: 0.0, country: '南极洲', population: '0', timezone: 'UTC+0', area: '1400万km²', type: 'city', continent: 'antarctica' }
    };'''

pattern = r'    const cities = \{[\s\S]*?\n    \};'
content = re.sub(pattern, new_cities, content)

with open('earth.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('城市数据更新完成！')