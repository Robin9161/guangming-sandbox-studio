# 给 AI 助手和协作者的说明

这是「沙盘深圳 · WebGPU」：讲光明的 3D 微缩沙盘网页，也是制作视频三维动画镜头的工具。WebGPU（Three.js r186）+ Vite + React + TypeScript。

## 动手之前必读

1. **[docs/美术风格与设计规范.md](docs/美术风格与设计规范.md)**：美术风格、配色系统、夜景、天气、水、后期、镜头的规范，以及负责人明确反对的做法。**所有画面相关的改动都必须遵守。**
2. [交接文档.md](交接文档.md)：现在有什么、用户定下的规则、踩过的坑、已知问题。
3. [docs/改进方案.md](docs/改进方案.md)：做视频的目标、已确定的决定、路线图和后续优化清单。
4. [README.md](README.md)：怎么运行、目录结构。

## 硬性规则

- 只写 WebGPU 代码：`three/webgpu` + `three/tsl` 节点材质。**不要**用 `onBeforeCompile`、`ShaderMaterial`、手写 GLSL、`EffectComposer`。材质效果走 `app/sandbox/scene/nodes.ts`。
- 颜色从关键色派生（`scene/artPalette.ts`），不要在材质里写死"好看的颜色"；地面和建筑的颜色要克制（`RESTRAINT` 的三个系数不要调高）。
- 新的可调参数一律登记在 `app/sandbox/studio/params.ts`（登记后自动进入参数面板、预设和时间线）；Theatre.js 只在 `studio/timeline.ts` 里使用。
- 成片要逐帧确定地复现：随时间变化的东西只在 `scene/createSandbox.ts` 的 `step()` 里推进；着色器里用 `studio/clock.ts` 的 `simTime`（不要用 `three/tsl` 的 `time`），随机数用 `rng()`（不要用 `Math.random()`）；有内部状态的模块要能快照和恢复。详见规范第 12 节。
- 雾平时不出现；镜头北在上；讲解剧本的内容规则见规范第 11 节。
- 改了美术参数，同步更新规范文档里对应的数值和文末的"变更记录"。想打破规范里的某条规则，先问负责人。
- 提交、推送 git 前先问负责人。
- 代码注释用中文，写"为什么"。

## 改完之后

```bash
npm run typecheck
npm run dev
```

按规范第 10 节验收：三种画面模式、五个标准时刻 × 氛围 × 天气、光明和至少一个其他区、讲解剧本点几拍，并确认帧率没有明显下降、控制台没有报错。
