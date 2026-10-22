// 本地存档服务（Vite 插件，npm run dev 时自动启动）：把预设、镜头库、时间线存成工程里的 JSON 文件，
// 跟着 git 走，团队里其他人拉下代码就能用同一套。
//
// 接口（都在 /__store/<种类>/ 下，种类只能是下面 KINDS 里的几种）：
//   GET  list              → [{ name, savedAt }]
//   GET  get?name=…        → 文件内容
//   POST save?name=…       保存（请求体是 JSON）
//   POST delete?name=…     删除
import fs from "node:fs";
import path from "node:path";
import { isLocalRequest, READ_ONLY_MESSAGE } from "./local-only.mjs";

/** 种类 → 工程里的文件夹 */
const KINDS = { presets: "presets", shots: "shots", timelines: "timelines" };

const safeName = (name) => String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80);

export function storeServer() {
  let root;
  const json = (res, status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve, reject) => { let s = ""; req.setEncoding("utf8"); req.on("data", (c) => (s += c)); req.on("end", () => resolve(s)); req.on("error", reject); });

  const handler = async (req, res) => {
    const url = new URL(req.url, "http://local");
    const [kind, action] = url.pathname.replace(/^\/+/, "").split("/");
    const folder = KINDS[kind];
    if (!folder) return json(res, 404, { error: "未知种类" });
    const dir = path.join(root, folder);
    const name = safeName(url.searchParams.get("name"));
    const file = path.join(dir, `${name}.json`);
    try {
      if (action === "list") {
        if (!fs.existsSync(dir)) return json(res, 200, []);
        const items = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
          let savedAt = null;
          try { savedAt = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).savedAt ?? null; } catch { /* 坏文件也列出来 */ }
          return { name: f.slice(0, -5), savedAt };
        });
        return json(res, 200, items.sort((a, b) => a.name.localeCompare(b.name, "zh")));
      }
      if (!name) return json(res, 400, { error: "缺少名字" });
      if (action === "get") {
        if (!fs.existsSync(file)) return json(res, 404, { error: "没有这个文件" });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(fs.readFileSync(file));
      }
      if (req.method !== "POST") return json(res, 405, { error: "只接受 POST" });
      if (!isLocalRequest(req)) return json(res, 403, { error: READ_ONLY_MESSAGE });
      if (action === "save") {
        const body = JSON.parse(await readBody(req));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
        return json(res, 200, { ok: true, name });
      }
      if (action === "delete") {
        fs.rmSync(file, { force: true });
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "未知接口" });
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const install = (server) => {
    root = server.config.root;
    server.middlewares.use("/__store", handler);
  };
  return { name: "studio-store-server", configureServer: install, configurePreviewServer: install };
}
