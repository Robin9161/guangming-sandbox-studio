import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { renderServer } from "./tools/render-server.mjs";
import { storeServer } from "./tools/store-server.mjs";

// 沙盘深圳 · WebGPU：页面数据放在 public/，构建产物在 dist/
export default defineConfig({
  // 本地渲染服务：逐帧接收画面，交给 ffmpeg 合成 ProRes；本地存档服务：预设、镜头库、时间线存成工程里的 JSON
  plugins: [react(), renderServer(), storeServer()],
  base: "./",
  // 渲染用 WebGPURenderer（不支持的浏览器自动退回 WebGL2）。
  // 所有 `import "three"`（包括 three/examples 里的模块）都指向 three/webgpu，保证全项目只有一份 three.js。
  resolve: { alias: [{ find: /^three$/, replacement: "three/webgpu" }] },
  server: { port: 5173, open: true, watch: { ignored: ["**/renders/**", "**/presets/**", "**/shots/**", "**/timelines/**"] } },
  // 局域网分享（npm run share，见 tools/share.mjs）：打包好的版本开在 5191 端口给同事看，改代码后自动重新打包。
  // 必须用 HTTPS，浏览器才会在非 localhost 地址上开放 WebGPU；证书是 .certs/ 里的自签名证书
  preview: {
    port: 5191,
    strictPort: true,
    host: true,
    https: fs.existsSync(".certs/key.pem") ? { key: fs.readFileSync(".certs/key.pem"), cert: fs.readFileSync(".certs/cert.pem") } : undefined,
  },
  build: { chunkSizeWarningLimit: 8192 },
});
