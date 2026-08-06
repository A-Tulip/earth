/**
 * Audio Manager - 音效管理模块
 * 基于Web Audio API，提供背景音乐和交互音效
 * 零外部音频文件依赖，全部程序化合成
 */
class AudioManager {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.bgmSource = null;
    this.bgmInterval = null;
    this.enabled = false;
    this.bgmPlaying = false;
    this.volume = 0.3;
  }

  // 初始化音频上下文（必须在用户交互后调用）
  init() {
    if (this.context) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContext();

      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.context.destination);

      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 0.3;
      this.musicGain.connect(this.masterGain);

      this.sfxGain = this.context.createGain();
      this.sfxGain.gain.value = 0.5;
      this.sfxGain.connect(this.masterGain);

      this.enabled = true;
    } catch (e) {
      console.warn('音频初始化失败:', e);
    }
  }

  // 恢复音频上下文（浏览器自动暂停策略）
  resume() {
    if (this.context && this.context.state === 'suspended') {
      this.context.resume();
    }
  }

  // ============ 交互音效 ============

  // 点击音效（短促清脆）
  playClick() {
    if (!this.enabled) return;
    this.resume();
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.context.currentTime + 0.05);
    gain.gain.setValueAtTime(0.3, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    osc.stop(this.context.currentTime + 0.1);
  }

  // 切换开关音效
  playToggle(on) {
    if (!this.enabled) return;
    this.resume();
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'triangle';
    if (on) {
      osc.frequency.setValueAtTime(400, this.context.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, this.context.currentTime + 0.08);
    } else {
      osc.frequency.setValueAtTime(800, this.context.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.context.currentTime + 0.08);
    }
    gain.gain.setValueAtTime(0.2, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    osc.stop(this.context.currentTime + 0.1);
  }

  // 弹窗打开音效
  playModalOpen() {
    if (!this.enabled) return;
    this.resume();
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523, this.context.currentTime);        // C5
    osc.frequency.linearRampToValueAtTime(784, this.context.currentTime + 0.15); // G5
    gain.gain.setValueAtTime(0.15, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    osc.stop(this.context.currentTime + 0.3);
  }

  // 弹窗关闭音效
  playModalClose() {
    if (!this.enabled) return;
    this.resume();
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(784, this.context.currentTime);
    osc.frequency.linearRampToValueAtTime(523, this.context.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    osc.stop(this.context.currentTime + 0.2);
  }

  // 飞行定位音效（上升音调）
  playFly() {
    if (!this.enabled) return;
    this.resume();
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, this.context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.context.currentTime + 1.0);
    gain.gain.setValueAtTime(0.1, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 1.2);
    // 低通滤波器让音效更柔和
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    osc.stop(this.context.currentTime + 1.2);
  }

  // 错误/提示音效
  playError() {
    if (!this.enabled) return;
    this.resume();
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, this.context.currentTime);
    osc.frequency.setValueAtTime(150, this.context.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    osc.stop(this.context.currentTime + 0.25);
  }

  // 成功音效（和弦）
  playSuccess() {
    if (!this.enabled) return;
    this.resume();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const startTime = this.context.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  }

  // ============ 背景音乐 ============

  // 程序化生成太空氛围背景音乐（持续循环）
  startBGM() {
    if (!this.enabled || this.bgmPlaying) return;
    this.resume();
    this.bgmPlaying = true;

    // 五声音阶（C D E G A），营造空灵感
    const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];
    const lowScale = [130.81, 146.83, 164.81, 196.00, 220.00];

    const playNote = (freq, duration, time, volume = 0.08) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.value = freq;

      filter.type = 'lowpass';
      filter.frequency.value = 2000;
      filter.Q.value = 1;

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(volume, time + 0.5);
      gain.gain.linearRampToValueAtTime(volume * 0.7, time + duration * 0.5);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);

      osc.start(time);
      osc.stop(time + duration);
    };

    // 循环播放
    const playLoop = () => {
      if (!this.bgmPlaying) return;
      const now = this.context.currentTime;

      // 高音旋律
      const melodyNote = scale[Math.floor(Math.random() * scale.length)];
      playNote(melodyNote, 3, now, 0.06);

      // 低音衬托（每两拍一次）
      if (Math.random() > 0.4) {
        const bassNote = lowScale[Math.floor(Math.random() * lowScale.length)];
        playNote(bassNote, 4, now + 0.1, 0.04);
      }

      // 和弦音（偶尔）
      if (Math.random() > 0.6) {
        playNote(melodyNote * 1.5, 2, now + 0.5, 0.03);
      }

      // 下一拍（3-5秒后）
      this.bgmInterval = setTimeout(playLoop, 3000 + Math.random() * 2000);
    };

    playLoop();
  }

  // 停止背景音乐
  stopBGM() {
    this.bgmPlaying = false;
    if (this.bgmInterval) {
      clearTimeout(this.bgmInterval);
      this.bgmInterval = null;
    }
  }

  // 切换背景音乐
  toggleBGM() {
    if (this.bgmPlaying) {
      this.stopBGM();
    } else {
      this.startBGM();
    }
    return this.bgmPlaying;
  }

  // ============ 音量控制 ============

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }
  }

  setMusicVolume(vol) {
    if (this.musicGain) {
      this.musicGain.gain.value = Math.max(0, Math.min(1, vol));
    }
  }

  setSfxVolume(vol) {
    if (this.sfxGain) {
      this.sfxGain.gain.value = Math.max(0, Math.min(1, vol));
    }
  }

  // 静音
  mute() {
    if (this.masterGain) {
      this.masterGain.gain.value = 0;
    }
  }

  unmute() {
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }
  }

  isBGmPlaying() {
    return this.bgmPlaying;
  }

  // 销毁
  destroy() {
    this.stopBGM();
    if (this.context) {
      this.context.close();
    }
  }
}

export { AudioManager };
export default new AudioManager();
