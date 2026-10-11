/// <reference types="vite/client" />
// 沙盘代码里用 process.env.NODE_ENV 判断开发模式（Vite 会在构建时替换掉）
declare const process: { env: { NODE_ENV?: string } };
