import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 光明区微缩沙盘（独立包）：页面数据放在 public/，构建产物在 dist/
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 5173, open: true },
});
