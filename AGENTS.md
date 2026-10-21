# 给 AI 助手和协作者的说明

这是「光明沙盘 Studio」：用来制作视频三维动画镜头的光明区沙盘，WebGPU（Three.js r186）+ Vite + TypeScript。

## 动手之前必读

1. **[docs/美术风格与设计规范.md](docs/美术风格与设计规范.md)**：美术风格、配色系统、夜景、天气、水、后期、镜头的规范，以及负责人明确反对的做法。**所有画面相关的改动都必须遵守。**
2. [docs/改进方案.md](docs/改进方案.md)：目标、已确定的决定、分阶段路线图。
3. [README.md](README.md)：怎么运行、目录结构。

## 硬性规则

- 只写 WebGPU 代码：`three/webgpu` + `three/tsl` 节点材质。**不要**用 `onBeforeCompile`、`ShaderMaterial`、手写 GLSL、`EffectComposer`。
- 颜色从关键色派生（`src/style/artPalette.ts`），不要在材质里写死"好看的颜色"；地面和建筑的颜色要克制（`RESTRAINT`）。
- 每帧变化的参数做成 uniform，只由 `src/look/driver.ts` 写入；状态只放在 `driver.state`。
- 新的每帧逻辑不要用 `Math.random()` 或真实时间（成片要逐帧确定地复现）。
- 改了美术参数，同步更新规范文档里对应的数值和文末的"变更记录"。想打破规范里的某条规则，先问负责人。
- 代码注释用中文，写"为什么"。

## 改完之后

```bash
npm run typecheck
npm run dev
```

按规范第 10 节验收：五个标准时刻 × 氛围 × 天气，切块（`/`）和全区（`/?full=1`）都看，并确认帧率没有明显下降。
