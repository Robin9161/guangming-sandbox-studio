// 讲解剧本逐拍检查：真 GPU 无头 Chrome 打开光明，逐拍点「下一拍」，每拍等动画走完后截图并收集控制台报错。
// 用法：node scripts/story-check.mjs <输出目录> [基础地址，默认 http://localhost:5190/]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [outDir = "reports/story-check", base = "http://localhost:5190/"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "story-"))}`,
  "--window-size=1440,900", "--force-device-scale-factor=1", "--use-angle=metal", "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--no-first-run", "about:blank",
], { stdio: "ignore" });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pending = new Map(); let errors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 600));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 600));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send("Runtime.enable");
  await send("Page.navigate", { url: base });
  for (let i = 0; i < 120; i++) { if (await evaluate(`document.body.innerText.includes("已就绪")`)) break; await sleep(500); }
  await sleep(3000);
  const loadErrors = errors; errors = [];
  // 开始讲解
  await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("按剧本讲解"))?.click()`);
  const results = [];
  for (let step = 0; step < 60; step += 1) {
    await sleep(step === 0 ? 4000 : 9000); // 每拍运镜和动画约 6–9 秒
    const info = await evaluate(`(() => {
      const caption = document.querySelector("section[aria-live]")?.innerText ?? "";
      const next = [...document.querySelectorAll("button")].find((b) => /下一|›|→/.test(b.textContent) && !b.disabled);
      return { caption: caption.slice(0, 120).replace(/\\n+/g, " / "), hasNext: !!next };
    })()`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    const name = `${String(step + 1).padStart(2, "0")}.jpg`;
    writeFileSync(join(outDir, name), Buffer.from(shot.result.data, "base64"));
    results.push({ step: step + 1, ...info, errors: [...new Set(errors)].slice(0, 6) });
    console.log(JSON.stringify(results.at(-1)));
    errors = [];
    if (!info.hasNext) break;
    await evaluate(`[...document.querySelectorAll("button")].find((b) => /下一|›|→/.test(b.textContent) && !b.disabled)?.click()`);
  }
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ loadErrors, steps: results }, null, 2));
  ws.close();
} finally { try { chrome.kill("SIGKILL"); } catch {} }
