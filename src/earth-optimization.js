/**
 * Earth Explorer - 性能优化模块
 * 提供资源预加载、渲染优化、内存管理等功能
 */

import * as THREE from 'three';

class EarthOptimizer {
  constructor() {
    this.loadingProgress = 0;
    this.totalResources = 0;
    this.loadedResources = 0;
    this.resourceCache = new Map();
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
    this.fps = 60;
    this.isPaused = false;
    this.animationFrameId = null;
    
    this.setupPerformanceMonitoring();
    this.setupMemoryManagement();
  }

  /**
   * 预加载资源
   * @param {Array} resources - 资源列表 [{type, url, name}]
   * @param {Function} onProgress - 进度回调
   * @param {Function} onComplete - 完成回调
   */
  preloadResources(resources, onProgress, onComplete) {
    this.totalResources = resources.length;
    this.loadedResources = 0;
    this.loadingProgress = 0;

    resources.forEach((resource) => {
      this.loadResource(resource)
        .then(() => {
          this.loadedResources++;
          this.loadingProgress = this.loadedResources / this.totalResources;
          if (onProgress) {
            onProgress(this.loadingProgress, resource.name);
          }
          if (this.loadedResources >= this.totalResources && onComplete) {
            onComplete();
          }
        })
        .catch((err) => {
          console.warn(`资源加载失败: ${resource.name}`, err);
          this.loadedResources++;
          if (this.loadedResources >= this.totalResources && onComplete) {
            onComplete();
          }
        });
    });
  }

  /**
   * 加载单个资源
   */
  async loadResource(resource) {
    return new Promise((resolve, reject) => {
      if (resource.type === 'texture') {
        const loader = new THREE.TextureLoader();
        loader.load(
          resource.url,
          (texture) => {
            this.resourceCache.set(resource.name, texture);
            resolve(texture);
          },
          undefined,
          reject
        );
      } else if (resource.type === 'json') {
        fetch(resource.url)
          .then((response) => response.json())
          .then((data) => {
            this.resourceCache.set(resource.name, data);
            resolve(data);
          })
          .catch(reject);
      } else if (resource.type === 'image') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          this.resourceCache.set(resource.name, img);
          resolve(img);
        };
        img.onerror = reject;
        img.src = resource.url;
      } else {
        resolve(null);
      }
    });
  }

  /**
   * 获取缓存的资源
   */
  getCachedResource(name) {
    return this.resourceCache.get(name);
  }

  /**
   * 设置性能监控
   */
  setupPerformanceMonitoring() {
    this.lastFpsUpdate = performance.now();
    
    const monitorFps = () => {
      this.frameCount++;
      const now = performance.now();
      
      if (now - this.lastFpsUpdate >= 1000) {
        this.fps = Math.round(this.frameCount * 1000 / (now - this.lastFpsUpdate));
        this.frameCount = 0;
        this.lastFpsUpdate = now;
        
        // 更新FPS显示
        const fpsElement = document.getElementById('fps-counter');
        if (fpsElement) {
          fpsElement.textContent = `${this.fps} FPS`;
          fpsElement.style.color = this.fps >= 50 ? '#22c55e' : this.fps >= 30 ? '#eab308' : '#ef4444';
        }
      }
      
      this.animationFrameId = requestAnimationFrame(monitorFps);
    };
    
    monitorFps();
  }

  /**
   * 设置内存管理
   */
  setupMemoryManagement() {
    // 监听页面隐藏/显示事件，优化渲染
    document.addEventListener('visibilitychange', () => {
      this.isPaused = document.hidden;
    });
  }

  /**
   * 清理Three.js资源
   */
  disposeObject(obj) {
    if (!obj) return;
    
    if (obj.geometry) {
      obj.geometry.dispose();
    }
    
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((mat) => this.disposeMaterial(mat));
      } else {
        this.disposeMaterial(obj.material);
      }
    }
    
    if (obj.children) {
      obj.children.forEach((child) => this.disposeObject(child));
    }
  }

  /**
   * 清理材质
   */
  disposeMaterial(material) {
    if (!material) return;
    
    if (material.map) material.map.dispose();
    if (material.normalMap) material.normalMap.dispose();
    if (material.roughnessMap) material.roughnessMap.dispose();
    if (material.metalnessMap) material.metalnessMap.dispose();
    if (material.dispose) material.dispose();
  }

  /**
   * 获取性能统计
   */
  getStats() {
    return {
      fps: this.fps,
      memoryUsed: this.getMemoryUsage(),
      resourceCount: this.resourceCache.size,
      loadingProgress: this.loadingProgress
    };
  }

  /**
   * 获取内存使用情况（估算）
   */
  getMemoryUsage() {
    if (performance.memory) {
      const usedMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2);
      const totalMB = (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2);
      return `${usedMB} / ${totalMB} MB`;
    }
    return 'N/A';
  }

  /**
   * 销毁优化器
   */
  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.resourceCache.clear();
  }
}

/**
 * 键盘快捷键管理器
 */
class KeyboardShortcuts {
  constructor() {
    this.shortcuts = new Map();
    this.setupDefaultShortcuts();
    this.bindEvents();
  }

  /**
   * 设置默认快捷键
   */
  setupDefaultShortcuts() {
    this.shortcuts.set('R', {
      name: 'toggleRotation',
      description: '切换自转',
      handler: () => this.triggerEvent('toggle-rotation')
    });
    
    this.shortcuts.set('O', {
      name: 'toggleRevolution',
      description: '切换公转',
      handler: () => this.triggerEvent('toggle-revolution')
    });
    
    this.shortcuts.set('G', {
      name: 'toggleGrid',
      description: '切换经纬线',
      handler: () => this.triggerEvent('toggle-grid')
    });
    
    this.shortcuts.set('A', {
      name: 'toggleAxis',
      description: '切换地轴',
      handler: () => this.triggerEvent('toggle-axis')
    });
    
    this.shortcuts.set('T', {
      name: 'toggleTwilight',
      description: '切换晨昏线',
      handler: () => this.triggerEvent('toggle-twilight')
    });
    
    this.shortcuts.set('C', {
      name: 'toggleCities',
      description: '切换城市标记',
      handler: () => this.triggerEvent('toggle-cities')
    });
    
    this.shortcuts.set('F', {
      name: 'toggleFullscreen',
      description: '切换全屏',
      handler: () => this.toggleFullscreen()
    });
    
    this.shortcuts.set('ESC', {
      name: 'closeModal',
      description: '关闭弹窗',
      handler: () => this.closeAllModals()
    });
    
    this.shortcuts.set('+', {
      name: 'increaseSpeed',
      description: '增加速度',
      handler: () => this.triggerEvent('increase-speed')
    });
    
    this.shortcuts.set('-', {
      name: 'decreaseSpeed',
      description: '减少速度',
      handler: () => this.triggerEvent('decrease-speed')
    });
    
    this.shortcuts.set('0', {
      name: 'resetView',
      description: '重置视角',
      handler: () => this.triggerEvent('reset-view')
    });
    
    this.shortcuts.set('1', {
      name: 'layerSatellite',
      description: '卫星图层',
      handler: () => this.triggerEvent('set-layer', 'satellite')
    });
    
    this.shortcuts.set('2', {
      name: 'layerTopo',
      description: '地形图层',
      handler: () => this.triggerEvent('set-layer', 'topo')
    });
    
    this.shortcuts.set('3', {
      name: 'layerPolitical',
      description: '政区图层',
      handler: () => this.triggerEvent('set-layer', 'political')
    });
  }

  /**
   * 绑定键盘事件
   */
  bindEvents() {
    document.addEventListener('keydown', (e) => {
      // 忽略输入框中的按键
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const key = e.key.toUpperCase();
      const shortcut = this.shortcuts.get(key);
      
      if (shortcut) {
        e.preventDefault();
        shortcut.handler();
      }
    });
  }

  /**
   * 添加自定义快捷键
   */
  addShortcut(key, name, description, handler) {
    this.shortcuts.set(key.toUpperCase(), { name, description, handler });
  }

  /**
   * 触发事件
   */
  triggerEvent(eventName, data = null) {
    const event = new CustomEvent(eventName, { detail: data });
    document.dispatchEvent(event);
  }

  /**
   * 切换全屏
   */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }

  /**
   * 关闭所有弹窗
   */
  closeAllModals() {
    document.querySelectorAll('.modal.show, .modal[style*="display: block"]').forEach((modal) => {
      if (modal.classList.contains('show')) {
        modal.classList.remove('show');
      } else {
        modal.style.display = 'none';
      }
    });
  }

  /**
   * 获取所有快捷键列表
   */
  getShortcutsList() {
    return Array.from(this.shortcuts.entries()).map(([key, value]) => ({
      key,
      ...value
    }));
  }
}

/**
 * 响应式管理器
 */
class ResponsiveManager {
  constructor() {
    this.breakpoints = {
      mobile: 768,
      tablet: 1024,
      desktop: 1280
    };
    this.currentBreakpoint = this.getBreakpoint();
    this.setupListeners();
  }

  /**
   * 获取当前断点
   */
  getBreakpoint() {
    const width = window.innerWidth;
    if (width < this.breakpoints.mobile) return 'mobile';
    if (width < this.breakpoints.tablet) return 'tablet';
    if (width < this.breakpoints.desktop) return 'desktop';
    return 'large';
  }

  /**
   * 设置监听器
   */
  setupListeners() {
    let resizeTimeout;
    
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const newBreakpoint = this.getBreakpoint();
        if (newBreakpoint !== this.currentBreakpoint) {
          this.currentBreakpoint = newBreakpoint;
          this.triggerBreakpointChange(newBreakpoint);
        }
        this.updateLayout();
      }, 250);
    });
    
    this.updateLayout();
  }

  /**
   * 触发断点变化事件
   */
  triggerBreakpointChange(breakpoint) {
    const event = new CustomEvent('breakpoint-change', { detail: breakpoint });
    document.dispatchEvent(event);
  }

  /**
   * 更新布局
   */
  updateLayout() {
    const breakpoint = this.currentBreakpoint;
    const panel = document.getElementById('left-panel');
    const resizer = document.getElementById('panel-resizer');
    
    if (breakpoint === 'mobile') {
      // 移动端：隐藏左侧面板
      if (panel) panel.style.width = '0';
      if (resizer) resizer.style.display = 'none';
    } else if (breakpoint === 'tablet') {
      // 平板：缩小面板
      if (panel) panel.style.width = '200px';
      if (resizer) resizer.style.display = 'block';
    } else {
      // 桌面：正常大小
      if (panel) panel.style.width = '280px';
      if (resizer) resizer.style.display = 'block';
    }
    
    // 更新相机宽高比
    const camera = window.earthCamera;
    if (camera) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }
    
    // 更新渲染器大小
    const renderer = window.earthRenderer;
    if (renderer) {
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  /**
   * 是否为移动端
   */
  isMobile() {
    return this.currentBreakpoint === 'mobile';
  }

  /**
   * 是否为桌面端
   */
  isDesktop() {
    return this.currentBreakpoint === 'desktop' || this.currentBreakpoint === 'large';
  }
}

/**
 * 主题管理器
 */
class ThemeManager {
  constructor() {
    this.themes = {
      dark: {
        name: 'dark',
        displayName: '深空探索',
        icon: '🚀',
        primary: '#0a0a1a',
        secondary: '#12122a',
        tertiary: '#1a1a3a',
        accent: '#00f5ff',
        accentSecondary: '#7c3aed',
        text: '#ffffff',
        textSecondary: '#a0a0c0',
        textMuted: '#606080',
        border: 'rgba(0, 245, 255, 0.2)',
        borderActive: 'rgba(0, 245, 255, 0.5)',
        glow: 'rgba(0, 245, 255, 0.4)',
        gradient: 'linear-gradient(135deg, rgba(0, 245, 255, 0.1), rgba(124, 58, 237, 0.1))',
        bodyGradient: 'linear-gradient(180deg, #050510 0%, #0a0a20 50%, #0f0f30 100%)',
        sceneBackground: 0x0a0a20,
        starColor: 0xffffff,
        showOceanEffects: false
      },
      light: {
        name: 'light',
        displayName: '清新自然',
        icon: '🌿',
        primary: '#ffffff',
        secondary: '#f8fafc',
        tertiary: '#f0f4f8',
        accent: '#10b981',
        accentSecondary: '#3b82f6',
        text: '#1e293b',
        textSecondary: '#475569',
        textMuted: '#94a3b8',
        border: 'rgba(16, 185, 129, 0.2)',
        borderActive: 'rgba(16, 185, 129, 0.4)',
        glow: 'rgba(16, 185, 129, 0.2)',
        gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1))',
        bodyGradient: 'linear-gradient(180deg, #ffffff 0%, #f0fdf4 30%, #e0f2fe 70%, #fef3c7 100%)',
        sceneBackground: 0xf0fdf4,
        starColor: 0x94a3b8,
        showOceanEffects: false
      },

    };
    
    this.currentTheme = this.loadTheme();
    this.applyTheme();
    this.setupEvents();
  }

  /**
   * 加载保存的主题
   */
  loadTheme() {
    const saved = localStorage.getItem('earthExplorerTheme');
    return saved || 'dark';
  }

  /**
   * 保存主题
   */
  saveTheme(themeName) {
    localStorage.setItem('earthExplorerTheme', themeName);
  }

  /**
   * 应用主题
   */
  applyTheme() {
    const theme = this.themes[this.currentTheme];
    if (!theme) return;
    
    // 设置CSS变量
    document.documentElement.style.setProperty('--theme-primary', theme.primary);
    document.documentElement.style.setProperty('--theme-secondary', theme.secondary);
    document.documentElement.style.setProperty('--theme-tertiary', theme.tertiary);
    document.documentElement.style.setProperty('--theme-accent', theme.accent);
    document.documentElement.style.setProperty('--theme-accent-secondary', theme.accentSecondary);
    document.documentElement.style.setProperty('--theme-text', theme.text);
    document.documentElement.style.setProperty('--theme-text-secondary', theme.textSecondary);
    document.documentElement.style.setProperty('--theme-text-muted', theme.textMuted);
    document.documentElement.style.setProperty('--theme-border', theme.border);
    document.documentElement.style.setProperty('--theme-border-active', theme.borderActive);
    document.documentElement.style.setProperty('--theme-glow', theme.glow);
    document.documentElement.style.setProperty('--theme-gradient', theme.gradient);
    
    // 更新背景（使用渐变）
    document.body.style.background = theme.bodyGradient;
    
    // 更新模态框
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.style.background = 'rgba(0, 0, 0, 0.75)';
    });
    
    // 更新模态框内容
    document.querySelectorAll('.modal-content').forEach((content) => {
      content.style.background = `linear-gradient(135deg, ${theme.secondary}, ${theme.primary})`;
      content.style.borderColor = theme.border;
    });
    
    // 更新面板
    const panel = document.getElementById('left-panel');
    if (panel) {
      panel.style.background = `linear-gradient(180deg, ${theme.secondary} 0%, ${theme.primary} 100%)`;
      panel.style.borderColor = theme.border;
    }
    
    // 更新按钮样式
    document.querySelectorAll('.toggle-item').forEach((item) => {
      item.style.background = theme.secondary;
    });
    
    // 更新输入框
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      el.style.background = theme.secondary;
      el.style.color = theme.text;
      el.style.borderColor = theme.border;
    });
    
    // 更新星空背景颜色
    const starfield = document.getElementById('starfield');
    if (starfield) {
      starfield.style.opacity = theme.name === 'light' ? '0.3' : '0.8';
    }
    
    // 更新主题切换按钮
    const themeBtn = document.getElementById('theme-switch-btn');
    if (themeBtn) {
      themeBtn.style.background = theme.secondary;
      themeBtn.style.borderColor = theme.border;
      themeBtn.style.color = theme.accent;
    }
    
    // 更新设置按钮
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.style.background = theme.secondary;
      settingsBtn.style.borderColor = theme.border;
      settingsBtn.style.color = theme.accent;
    }
    
    // 更新状态栏
    const statusBar = document.getElementById('status-bar');
    if (statusBar) {
      statusBar.style.background = theme.secondary;
      statusBar.style.borderColor = theme.border;
    }
    
    // 更新左侧面板标题
    const panelTitle = document.querySelector('.panel-title');
    if (panelTitle) {
      panelTitle.style.color = theme.text;
    }
    
    // 更新面板副标题
    const panelSubtitle = document.querySelector('.panel-subtitle');
    if (panelSubtitle) {
      panelSubtitle.style.color = theme.textSecondary;
    }
    
    // 更新所有文本
    document.querySelectorAll('.toggle-label, .toggle-desc').forEach((el) => {
      el.style.color = theme.textSecondary;
    });
    
    // 更新活动状态
    document.querySelectorAll('.toggle-item.active').forEach((item) => {
      item.style.borderColor = theme.borderActive;
      item.style.boxShadow = `0 0 15px ${theme.glow}`;
    });
    
    // 触发主题变化事件
    const event = new CustomEvent('theme-change', { detail: theme });
    document.dispatchEvent(event);
  }

  /**
   * 切换主题
   */
  setTheme(themeName) {
    if (this.themes[themeName]) {
      this.currentTheme = themeName;
      this.saveTheme(themeName);
      this.applyTheme();
    }
  }

  /**
   * 获取可用主题列表
   */
  getThemes() {
    return Object.keys(this.themes);
  }

  /**
   * 获取当前主题配置
   */
  getCurrentTheme() {
    return this.themes[this.currentTheme];
  }

  /**
   * 设置事件监听
   */
  setupEvents() {
    document.addEventListener('theme-change', (e) => {
      const theme = e.detail;
      
      // 更新Three.js场景背景
      const scene = window.earthScene;
      if (scene) {
        scene.background = new THREE.Color(theme.sceneBackground);
      }
      
      // 更新渲染器背景
      const renderer = window.earthRenderer;
      if (renderer) {
        renderer.setClearColor(theme.sceneBackground);
      }
      
      // 更新星星颜色
      const stars = window.starField;
      if (stars) {
        stars.children.forEach(star => {
          if (star.material) {
            star.material.color.setHex(theme.starColor);
          }
        });
      }
      
      // 更新灯光强度
      const sunLight = window.sunLight;
      if (sunLight) {
        if (theme.name === 'light') {
          sunLight.intensity = 1.5;
        } else {
          sunLight.intensity = 1.0;
        }
      }
      
      // 显示/隐藏海洋效果
      const oceanEffects = document.getElementById('ocean-effects');
      if (oceanEffects) {
        if (theme.showOceanEffects) {
          oceanEffects.classList.add('active');
        } else {
          oceanEffects.classList.remove('active');
        }
      }
      
      // 更新星空背景显示
      const starfield = document.getElementById('starfield');
      if (starfield) {
        if (theme.name === 'light') {
          starfield.style.display = 'none';
        } else {
          starfield.style.display = 'block';
        }
      }
    });
  }
}

// 导出模块
export { EarthOptimizer, KeyboardShortcuts, ResponsiveManager, ThemeManager };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EarthOptimizer,
    KeyboardShortcuts,
    ResponsiveManager,
    ThemeManager
  };
}
