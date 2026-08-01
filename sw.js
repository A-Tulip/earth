/* 地球探索者 Service Worker - 离线缓存 */
const CACHE_NAME = 'earth-explorer-v1';

/* 需要预缓存的核心资源（相对 sw.js 所在目录，即项目根目录） */
const CORE_ASSETS = [
  'src/earth.html',
  'src/earth-optimization.js',
  'src/lib/three.module.js',
  'src/lib/controls/TrackballControls.js',
  'assets/images/world-political.png',
  'assets/images/gallery/world-color.jpg',
  'assets/images/gallery/world-topographic.jpg',
  'assets/images/gallery/continents/asia.jpg',
  'assets/images/gallery/continents/europe.jpg',
  'assets/images/gallery/continents/africa.jpg',
  'assets/images/gallery/continents/northAmerica.jpg',
  'assets/images/gallery/continents/southAmerica.jpg',
  'assets/images/gallery/continents/oceania.jpg',
  'assets/images/gallery/continents/antarctica.jpg'
];

/* 安装：预缓存核心资源 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('预缓存失败:', err))
  );
});

/* 激活：清理旧版本缓存 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* 拦截请求：本地资源走缓存优先，外部 API 走网络优先 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  /* 外部 API（天气、AI 服务）不缓存，直接网络请求 */
  if (url.origin !== self.location.origin) {
    return;
  }

  /* 本地资源：缓存优先，网络回源并更新缓存 */
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
  );
});
