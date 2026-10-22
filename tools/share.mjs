// 局域网分享（npm run share）：打包一份稳定版本开给同事看（5191 端口，HTTPS，只读），
// 并监视代码：改完保存后自动重新打包，同事刷新页面就能看到最新版本。
//
// - 第一次启动时清空 dist/ 重新打包；之后每次只覆盖改动的文件，不清空——
//   打包过程中同事刷新，拿到的仍是上一版完整的文件，不会打不开
// - 连续保存时，停手 1.5 秒后才打包一次
// - 改出了编译不过的代码：这次打包失败，同事那边继续用上一个能用的版本
import { build, preview } from "vite";

const time = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

await build({ logLevel: "warn", build: { emptyOutDir: true, chunkSizeWarningLimit: 8192 } });
console.log(`[${time()}] 已打包`);

const watcher = await build({ logLevel: "warn", build: { emptyOutDir: false, chunkSizeWarningLimit: 8192, watch: { buildDelay: 1500 } } });
let first = true;
watcher.on("event", (event) => {
  if (event.code === "BUNDLE_START" && !first) console.log(`[${time()}] 检测到改动，重新打包…`);
  if (event.code === "END") {
    if (!first) console.log(`[${time()}] 已更新：同事刷新页面即可看到`);
    first = false;
  }
  if (event.code === "ERROR") console.log(`[${time()}] 打包失败（同事那边继续用上一版）：${event.error?.message ?? event.error}`);
  if (event.result) event.result.close?.();
});

const server = await preview();
server.printUrls();
console.log("\n改完代码保存后会自动重新打包；按 Ctrl-C 停止分享。");
