// 截图 + 帧率基准：用真 GPU 的无头 Chrome（关掉垂直同步和帧率上限）逐个打开状态，截图并测帧率。
// 用法：node scripts/shots.mjs <输出目录> [基础地址，默认 http://localhost:5190/]
// 结果：<输出目录>/<状态名>.jpg + results.json（每个状态的 fps、最差帧耗时）
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [outDir = "reports/shots", base = "http://localhost:5190/"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

// 每个状态：地址参数 + 打开后在页面里执行的操作（点面板按钮）
const click = (...labels) => `(async () => {
  const btn = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
  for (const t of ${JSON.stringify(labels)}) { const b = btn(t); if (!b) return "missing " + t; b.click(); await new Promise((r) => setTimeout(r, 900)); }
  return "ok";
})()`;
const art = (...labels) => click("✦ 光影", "❚❚", ...labels);
export const STATES = [
  { name: "01-光明-白天", query: "", run: "" },
  { name: "02-光明-夜晚", query: "", run: click("☾ 夜晚") },
  { name: "03-光影-日出", query: "", run: art("日出") },
  { name: "04-光影-正午", query: "", run: art("正午") },
  { name: "05-光影-黄金时刻", query: "", run: art("黄金时刻") },
  { name: "06-光影-蓝调", query: "", run: art("蓝调") },
  { name: "07-光影-深夜", query: "", run: art("深夜") },
  { name: "08-光影-雨-黄金时刻", query: "", run: art("黄金时刻", "雨") , settle: 9000 },
  { name: "09-光影-雪-正午", query: "", run: art("正午", "雪"), settle: 15000 },
  { name: "10-光影-雾-日出", query: "", run: art("日出", "雾"), settle: 9000 },
  { name: "11-天际线-蓝调", query: "", run: click("天际线", "✦ 光影", "❚❚", "蓝调") },
  { name: "12-前海-白天", query: "?district=qianhai", run: "" },
  { name: "13-南山-白天", query: "?district=nanshan", run: "" },
  { name: "14-宝安-白天", query: "?district=baoan", run: "" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shoot(state) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "shots-"));
  const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--window-size=1440,900", "--force-device-scale-factor=1",
    "--use-angle=metal", "--enable-unsafe-webgpu", "--ignore-gpu-blocklist",
    "--disable-gpu-vsync", "--disable-frame-rate-limit", "--no-first-run", "about:blank",
  ], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0; const pending = new Map();
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
    await send("Page.navigate", { url: base + state.query });
    // 等到面板显示「已就绪」（最多 60 秒）
    for (let i = 0; i < 120; i++) { if (await evaluate(`document.body.innerText.includes("已就绪")`)) break; await sleep(500); }
    await sleep(3000);
    const ran = state.run ? await evaluate(state.run) : "ok";
    await sleep(state.settle ?? 4000);
    const perf = await evaluate(`(async () => {
      let frames = 0, worst = 0, last = performance.now(); const t0 = last;
      await new Promise((done) => { const f = (now) => { frames++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 6000) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
      return { fps: +(frames * 1000 / (last - t0)).toFixed(1), worstFrameMs: +worst.toFixed(1), webgpu: !!document.querySelector("canvas")?.getContext && !!navigator.gpu };
    })()`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(join(outDir, `${state.name}.jpg`), Buffer.from(shot.result.data, "base64"));
    ws.close();
    return { name: state.name, ran, ...perf };
  } finally { try { chrome.kill("SIGKILL"); } catch {} }
}

const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const results = [];
for (const state of STATES) {
  if (only && !only.test(state.name)) continue;
  const r = await Promise.race([shoot(state), sleep(120000).then(() => ({ name: state.name, error: "timeout" }))]);
  console.log(JSON.stringify(r));
  results.push(r);
}
writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 2));
