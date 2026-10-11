# WebGPU 迁移 · 阶段 A：换渲染器，画面与现在一致

项目：`/Users/lion/Documents/沙盘深圳gpu`（Vite + React 独立项目，three r186）。在 git 分支 `webgpu` 上工作（从 `main` 拉出），每完成一块就提交一次（提交说明用中文）。

## 目标

把渲染从 `WebGLRenderer` + `EffectComposer` 换成 `WebGPURenderer`（`three/webgpu`）+ TSL 节点材质 + `RenderPipeline`，**画面与现在的 WebGL 版一致**。不支持 WebGPU 的浏览器由 WebGPURenderer 自动退回 WebGL2，只维护一套代码。

本阶段**不加新效果**（体积雾、倒影等是阶段 B），也**不做性能和手机档位**。

## 参考

- 现状基准：`reports/webgl-baseline/`（14 个状态的截图 + `results.json` 帧率）。
- 已验证可行的 WebGPU 写法：`/Users/lion/Documents/光明沙盘-WebGPU-MVP/src/main.ts`（只读参考，不要改那个项目）。里面有：WebGPURenderer 初始化与降级判断、`RenderPipeline` + `pass()` + MRT、SSAO、bloom、高斯模糊移轴、暗角、全局调色（grade）、城市材质（窗户、夜间剪影、积雪 `withSnow`）、雨雪 Sprite、天空 `backgroundNode`。
- 美术与天气系统的设计说明：`天气与光影系统说明.md`。

## 要移植的 WebGL 专用代码（全部清单）

1. **`onBeforeCompile`（WebGPU 下不会执行）共 21 处 / 10 个文件**，改成 TSL（`colorNode` / `emissiveNode` / `positionNode` / `opacityNode` 等）：
   - `scene/terrain.ts`（3）：地形配色叠加图、区界遮罩 `maskMaterial`（遮罩纹理 `flipY = false`，注意别把这个修复丢掉）、无缝模式。
   - `scene/buildings.ts`（1）：楼的生长动画（`aGrow` + `uGrowTime/uGrowTime2`）、窗户、夜间剪影。生长动画讲解剧本要用，必须保留。
   - `scene/grow.ts`（3）：道路 / 高速 / 地铁按距离显露（`addReveal`）。
   - `scene/atmosphere.ts`（4）：`glowColor`、`glowFromVertexColor`（**所有地标的夜景发光都靠它**，经 `landmarks/_landmark-kit.ts` 调用）等。
   - `scene/nightLight.ts`（2）：`litByStreetLamps` 路灯图。
   - `scene/weatherShading.ts`（2）：贴地雾 + 积雪，注入到所有实体材质。
   - `scene/watershed.ts`（1）、`landmarks/guangming-lake.ts`（2）、`landmarks/guangming-mass-sports-center.ts`（1）、`landmarks/qianhai/bay-light-wheel.ts`（2）。
   - 建议：做一个统一的"材质增强"入口（例如 `scene/nodes.ts`），把夜间发光、路灯、天气着色、区界遮罩写成可叠加的 TSL 函数，替代现在逐个材质注入 GLSL 的做法。
2. **`ShaderMaterial`（GLSL，WebGPU 不支持）共 5 个 / 4 个文件**：`atmosphere.ts`（天空穹顶等）、`weather.ts`（雨丝、雪花、闪电）、`cityDots.ts`（远处灯光点）、`stageLight.ts`（舞台光）。改成 NodeMaterial；天空可以用 `scene.backgroundNode`。
3. **点和线**：`PointsMaterial`（星星）、`weather.ts` 里的线段 —— WebGPU 不支持大于 1 像素的点，改成实例化 Sprite（参考 MVP 的 `fall()`）。
4. **后期链**（`createSandbox.ts`）：`EffectComposer` + `RenderPass` + `GTAOPass` + `UnrealBloomPass` + 移轴（Horizontal/VerticalTiltShift）+ `VignetteShader` + `GradeShader`（atmosphere.ts）+ `OutputPass` → `RenderPipeline` 节点链。注意现在 GTAO 会**跳过全深圳地形和舞台组**（曾经导致远处海面闪烁），新链里要保留这个效果：AO 不作用在全深圳地形上。
5. **其他**：`renderer.info`、`toneMappingExposure`、阴影设置、`setPixelRatio`、画质切换（「精致 / 流畅」按钮关 AO 和移轴）都要在新渲染器上可用。CSS2D 标签不受影响。

## 验收（自己做完再交）

1. `npx tsc --noEmit -p .` 无报错；`npm run build` 成功。
2. 开发服务器：`npx vite --port 5190 --strictPort`（如 5190 已在运行就直接用，不要重启别人的进程）。
3. 跑 `node scripts/shots.mjs reports/webgpu-A` 生成同样 14 个状态的截图和帧率，逐张和 `reports/webgl-baseline/` 对比：构图、配色、夜景、天气、各区都要一致；有差异的写清原因。
4. 每个状态控制台无报错（`shots.mjs` 打开页面时可额外读取 console；或在页面里挂 `window.__errors` 收集）。
5. 降级：加一个 `?webgl=1` 参数让 WebGPURenderer 用 `forceWebGL: true`，同样跑一遍截图（可以只跑 01、04、07、12），确认降级后也能正常显示。
6. 报告写在 `reports/webgpu-A/README.md`：每个移植点怎么做的、截图对比（可拼图）、两边帧率对照表、遗留问题。

## 约束

- 只改 `沙盘深圳gpu` 项目里的文件，不要动 `/Users/lion/Documents/深圳`、独立包、MVP 这三个目录。
- 不改数据（`public/`）和地标的造型；只改渲染相关代码。
- 每个阶段性成果都提交到 `webgpu` 分支，`main` 分支保持不动。
