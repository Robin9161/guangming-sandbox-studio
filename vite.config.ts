import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 沙盘深圳 · WebGPU：页面数据放在 public/，构建产物在 dist/
export default defineConfig({
  plugins: [react()],
  base: "./",
  // 渲染用 WebGPURenderer（不支持的浏览器自动退回 WebGL2）。
  // 所有 `import "three"`（包括 three/examples 里的模块）都指向 three/webgpu，保证全项目只有一份 three.js。
  resolve: { alias: [{ find: /^three$/, replacement: "three/webgpu" }] },
  server: { port: 5173, open: true },
});
