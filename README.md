# 光明沙盘 Studio

用来制作视频三维动画镜头的光明区沙盘（WebGPU）。

- **美术风格与设计规范**：[docs/美术风格与设计规范.md](docs/美术风格与设计规范.md)（接手的人和 AI 必读）
- 目标和路线图：[docs/改进方案.md](docs/改进方案.md)
- AI 协作说明：[AGENTS.md](AGENTS.md)

## 运行

需要 Node.js 22+，以及新版 Chrome 或 Edge（支持 WebGPU；不支持时会自动降级为 WebGL2，左上角会显示）。

```bash
npm install
npm run dev
```

- 虹桥公园一带（约 3.2 km 见方的切块）：http://localhost:5190/
- 全区：http://localhost:5190/?full=1

第一次打开全区需要等十几秒（搭建 3 万栋建筑、编译着色器）。

类型检查：

```bash
npm run typecheck
```

## 目录结构

```
src/                    全部代码（只有 WebGPU 版）
├── main.ts             启动：读数据 → 搭场景 → 每帧循环
├── core/
│   ├── renderer.ts     渲染器（WebGPU，自动降级 WebGL2）
│   └── region.ts       读数据；渲染范围（全区 / 切块）；水位与地形挖低
├── style/
│   ├── artPalette.ts   一天的关键色、日出日落氛围、克制系数（美术的核心）
│   └── palette.ts      物体基础色板（地面、建筑、道路、水、树）与沙盘尺度、高程夸张
├── weather/weather.ts  天气状态机 + 天气叠加到配色（不负责画）
├── look/
│   ├── uniforms.ts     整帧共享的天光参数；积雪
│   └── driver.ts       一天的光影驱动：时刻 → 配色 → 天气 → 写进灯光、天空、雾、水、后期
├── geo/                数据与几何（与渲染无关）
│   ├── types.ts        sandbox.json 的结构
│   ├── projection.ts   经纬度 → 沙盘坐标
│   ├── terrain.ts      地形查询（高度、高程、区界、绿地）和栅格工具
│   ├── buildings.ts    建筑体块
│   ├── features.ts     道路、水系的条带和水面
│   └── hongqiao-*.ts   虹桥模型
├── world/              场景内容：几何体 + WebGPU 节点材质
│   ├── sky.ts          天空、太阳光晕、星星
│   ├── terrain.ts      地形切块（带泥土侧壁）
│   ├── city.ts         建筑 + 统一城市材质（白天配色、夜间剪影、高楼亮窗）
│   ├── roads.ts        道路（积雪、雨后湿润）
│   ├── water.ts        水面（倒影、菲涅尔、微波、雨点涟漪、塘 / 湖 / 水库 / 河分级）
│   ├── bridge.ts       虹桥（夜里红光）
│   ├── trees.ts        树
│   ├── clouds.ts       云（云影；阴雨天云量增加）
│   └── lights.ts       半球光、太阳
├── fx/
│   ├── noise.ts        3D 噪声纹理
│   ├── fog.ts          体积雾（雾体 + 太阳照雾）
│   └── precipitation.ts 雨丝、雪花
├── post/pipeline.ts    后期：AO → 体积雾合成 → 全局调色 → 移轴 → 暗角 → 泛光
├── camera/rig.ts       镜头和鼠标控制
└── ui/panel.ts         右侧面板
public/                 数据：sandbox.json、dem.bin、虹桥；landmarks/、models/ 是原版地标数据（留给阶段 5）
docs/                   规范、方案和说明
```

数据和最初的建模代码来自「深圳」项目的 `app/sandbox`（WebGL 版）。本工程只保留了 WebGPU 版用到的部分，并去掉了其中所有 WebGL 着色器代码；
地铁、高铁、南光 / 龙大高速的高架、精细地标等原版功能尚未移植（见路线图阶段 5），需要时可以参考原版代码。

调试：浏览器控制台里可以访问 `window.__studio`（场景、镜头、光影驱动、天气状态等）。
