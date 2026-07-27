# Earth Explorer - 3D地理教学互动平台

一个基于 Web 的 3D 地理教学互动平台，无需安装，打开浏览器即可使用。

## ✨ 功能特性

- 🌍 **3D地球可视化** - 使用 Three.js 实现的交互式3D地球
- 🎤 **语音控制** - 支持语音指令操作地球仪
- 📱 **响应式设计** - 支持 PC、平板、手机等多种设备
- 🗺️ **地理知识** - 包含七大洲、城市定位、气候带等信息
- 🎓 **学习助手** - AI 地理学习助手，支持问答和知识查询

## 🚀 快速开始

### 本地运行

1. 克隆仓库：
```bash
git clone https://github.com/A-Tulip/earth.git
```

2. 进入项目目录：
```bash
cd earth
```

3. 使用任意静态服务器运行：
```bash
# 使用 Python
python -m http.server 8000

# 使用 Node.js
npx serve

# 或者直接用浏览器打开 src/earth.html
```

4. 在浏览器中访问：`http://localhost:8000/src/earth.html`

### 访问在线版本

[https://a-tulip.github.io/earth/src/earth.html](https://a-tulip.github.io/earth/src/earth.html)

## 🎯 使用说明

### 语音指令

点击麦克风按钮，说出以下指令：
- **定位导航**："定位到北京"、"去东京"、"飞往纽约"
- **图层控制**："显示气候带"、"打开天气"、"隐藏城市"
- **视图控制**："放大"、"缩小"、"重置视图"
- **功能模块**："打开知识库"、"开始答题"、"打开学习助手"
- **动画控制**："开始自转"、"停止公转"、"全部停止"

### 鼠标操作

- **左键拖动**：旋转地球
- **滚轮**：缩放地球
- **右键拖动**：平移视角

## 🛠️ 技术栈

- Three.js - 3D渲染
- HTML5/CSS3 - 页面结构和样式
- JavaScript - 交互逻辑
- Web Speech API - 语音识别

## 📄 许可证

MIT License
