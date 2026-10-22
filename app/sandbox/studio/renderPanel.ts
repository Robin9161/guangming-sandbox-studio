import { defaultName, outputSize, renderServerStatus, runJob, type OutputSize, type ProResProfile, type RenderJob, type StudioHooks } from "./jobs";
import type { Timeline } from "./timeline";
import { view } from "./view";

const QUEUE_KEY = "studio.renderQueue";
/** 4K60 时每分钟大约多少 GB（1080p 约四分之一） */
const GB_PER_MINUTE: Record<ProResProfile, number> = { lt: 6, 422: 9, hq: 13 };

/**
 * 面板里的「渲染成片」：设置参数 → 记下当前画面加入队列 → 依次渲染成 ProRes。
 * 队列存在浏览器本地（刷新页面不丢）；每条任务都带着完整的起始状态，什么时候渲染结果都一样。
 */
export function bindRenderPanel(hooks: StudioHooks, district: { id: string; name: string }, timeline: Timeline) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const nameInput = $<HTMLInputElement>("render-name"), secondsInput = $<HTMLInputElement>("render-seconds");
  const queueBox = $("queue"), msg = $("render-msg"), progressText = $("render-progress");
  const startButton = $<HTMLButtonElement>("render-start"), addButton = $<HTMLButtonElement>("render-add");
  const settings = { size: "4k" as OutputSize, profile: "422" as ProResProfile, samples: 8, shutter: 0, source: "current" as "current" | "timeline", withAudio: false };
  const fromInput = $<HTMLInputElement>("render-from"), toInput = $<HTMLInputElement>("render-to");
  const audioButton = $<HTMLButtonElement>("render-audio");
  audioButton.addEventListener("click", () => { settings.withAudio = !settings.withAudio; audioButton.classList.toggle("on", settings.withAudio); });
  // 按时间线渲染时，默认范围是整条时间线
  const syncSource = () => {
    $("render-current-row").style.display = settings.source === "current" ? "" : "none";
    $("render-timeline-row").style.display = settings.source === "timeline" ? "" : "none";
    if (settings.source === "timeline" && !toInput.value) { fromInput.value = "0"; toInput.value = String(timeline.length()); }
  };
  nameInput.placeholder = defaultName(district.name);

  const choose = (attr: string, apply: (value: string) => void) => {
    document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => b.addEventListener("click", () => {
      apply(b.dataset[attr]!);
      document.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle("on", x === b));
    }));
  };
  choose("size", (v) => (settings.size = v as OutputSize));
  choose("profile", (v) => (settings.profile = v as ProResProfile));
  choose("samples", (v) => (settings.samples = Number(v)));
  choose("shutter", (v) => (settings.shutter = Number(v)));
  choose("source", (v) => { settings.source = v as typeof settings.source; syncSource(); });
  syncSource();

  // ---- 队列（存在浏览器本地；存不了也不影响本次使用） ----
  let queue: RenderJob[] = [];
  try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch { queue = []; }
  const save = () => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* 忽略 */ } };
  const sizeGB = (job: RenderJob) => {
    const { width, height } = outputSize(job.settings.size, job.settings.aspect);
    return (GB_PER_MINUTE[job.settings.profile] * job.settings.seconds) / 60 * ((width * height) / (3840 * 2160));
  };
  const drawQueue = () => {
    queueBox.replaceChildren(...queue.map((job) => {
      const row = document.createElement("div");
      const other = job.district !== district.id;
      const text = document.createElement("span");
      const s = job.settings;
      const source = s.timeline ? `时间线「${s.timeline.name}」${s.timeline.from}–${s.timeline.to}s` : `${s.seconds}s`;
      text.textContent = `${s.name} · ${source} · ${s.size === "4k" ? "4K" : "1080p"} ${s.aspect ?? "16:9"} · ${s.samples}×${s.shutter ? ` · 运动模糊 ${s.shutter}°` : ""}${s.audio ? " · 带音频" : ""} · 约 ${sizeGB(job).toFixed(1)}GB${other ? `（要在 ?district=${job.district} 页面渲染）` : ""}`;
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = "从队列里删除";
      remove.addEventListener("click", () => { queue = queue.filter((j) => j !== job); save(); drawQueue(); });
      row.append(text, remove);
      return row;
    }));
  };
  drawQueue();

  const makeJob = (): RenderJob => {
    const useTimeline = settings.source === "timeline";
    const from = Math.max(0, Number(fromInput.value) || 0), to = Math.max(from + 1 / 60, Number(toInput.value) || timeline.length());
    const seconds = useTimeline ? to - from : Math.min(600, Math.max(0.5, Number(secondsInput.value) || 10));
    if (settings.withAudio && !view.audio) throw new Error("还没有导入音频（在「运镜与时间线」里导入）");
    return {
      id: Math.random().toString(36).slice(2, 10),
      district: district.id,
      createdAt: new Date().toISOString(),
      settings: {
        name: nameInput.value.trim() || nameInput.placeholder, seconds, fps: 60, size: settings.size, samples: settings.samples, shutter: settings.shutter, profile: settings.profile, aspect: view.aspect,
        timeline: useTimeline ? { name: timeline.name, from, to, content: timeline.content() } : undefined,
        audio: settings.withAudio && view.audio ? { fileName: view.audio.name, offset: useTimeline ? from : 0 } : undefined,
      },
      scene: hooks.captureScene(),
    };
  };
  addButton.addEventListener("click", () => {
    try { queue.push(makeJob()); } catch (e) { msg.textContent = (e as Error).message; return; }
    save();
    drawQueue();
    nameInput.value = "";
    nameInput.placeholder = defaultName(district.name);
  });

  // 导入任务：每条成片旁边都有一个同名 .json（起始状态 + 参数），导入后可以原样重渲
  const fileInput = $<HTMLInputElement>("render-file");
  $("render-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    for (const file of Array.from(fileInput.files ?? [])) {
      try {
        const job = JSON.parse(await file.text()) as RenderJob;
        if (!job.scene || !job.settings) throw new Error("不是渲染任务文件");
        queue.push({ ...job, id: Math.random().toString(36).slice(2, 10) });
      } catch (error) {
        msg.textContent = `导入 ${file.name} 失败：${(error as Error).message}`;
      }
    }
    fileInput.value = "";
    save();
    drawQueue();
  });

  // ---- 渲染 ----
  let running = false, cancel = false;
  $("render-cancel").addEventListener("click", () => { cancel = true; progressText.textContent = "正在取消…"; });
  window.addEventListener("beforeunload", (e) => { if (running) e.preventDefault(); });
  const fmt = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}分${String(Math.round(s % 60)).padStart(2, "0")}秒` : "…");

  startButton.addEventListener("click", async () => {
    if (running) return;
    if (!queue.some((j) => j.district === district.id)) { // 队列空着：直接渲染当前画面
      try { queue.push(makeJob()); } catch (e) { msg.textContent = (e as Error).message; return; }
      save(); drawQueue();
    }
    running = true; cancel = false;
    startButton.disabled = addButton.disabled = true;
    document.body.classList.add("rendering");
    // 渲染期间不让屏幕熄灭（屏幕熄灭后浏览器可能暂停页面）；macOS 上本地服务还会用 caffeinate 防止睡眠
    let wakeLock: { release: () => Promise<void> } | null = null;
    try { wakeLock = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen"); } catch { /* 不支持就算了 */ }
    const log: string[] = [];
    try {
      for (const job of [...queue]) {
        if (cancel) break;
        if (job.district !== district.id) continue;
        progressText.textContent = `${job.settings.name}：准备中…`;
        try {
          const result = await runJob(job, hooks, (p) => {
            progressText.textContent = `${p.job.settings.name}：第 ${p.frame} / ${p.frames} 帧 · ${p.fps.toFixed(2)} 帧/秒 · 剩余约 ${fmt(p.etaSeconds)}`;
          }, () => cancel);
          log.push(`✓ ${job.settings.name} → ${result.file}（${(result.bytes / 1e9).toFixed(2)} GB）`);
          queue = queue.filter((j) => j !== job);
          save();
          drawQueue();
        } catch (error) {
          log.push(`✗ ${job.settings.name}：${(error as Error).message}`);
          break; // 出错或取消就停下，剩下的留在队列里
        }
      }
    } finally {
      await wakeLock?.release().catch(() => undefined);
      document.body.classList.remove("rendering");
      running = false;
      startButton.disabled = addButton.disabled = false;
      msg.textContent = log.join("\n");
    }
  });

  // ---- 本地渲染服务 / ffmpeg 状态 ----
  renderServerStatus()
    .then((s) => { msg.textContent = (s as { readOnly?: boolean }).readOnly ? "只读：从其他电脑打开时不能渲染（只有沙盘所在的电脑可以）" : s.ffmpeg ? `ffmpeg 已就绪，成片保存在 ${s.outputDir}` : "找不到 ffmpeg：请运行 npm install"; })
    .catch(() => { msg.textContent = "本地渲染服务没有运行：请用 npm run dev 打开本页（双击启动的离线包只能看，不能渲染）"; });
}
