import type { ParamValues } from "./params";
import type { FrameRenderer } from "./frameRenderer";
import type { TimelineLinks } from "./timeline";
import { ASPECTS, type Aspect } from "./view";

/** ProRes 规格：LT 约 6GB/分钟、422 约 9GB/分钟、HQ 约 13GB/分钟（4K60） */
export type ProResProfile = "lt" | "422" | "hq";

export type OutputSize = "4k" | "1080p";

/** 成片尺寸：4K 或 1080p（试渲染）× 画幅 */
export const outputSize = (size: OutputSize, aspect: Aspect = "16:9") => {
  const [width, height] = size === "4k" ? ASPECTS[aspect].size4k : ASPECTS[aspect].size1080;
  return { width, height };
};

/** 起始画面的完整状态：从它开始按固定步长推进，每一帧都能原样复现 */
export type SceneSnapshot = {
  simTime: number;
  rng: number;
  /** 全部美术参数（没有这一项的旧任务按默认值处理） */
  params?: ParamValues;
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
  /** 场景其余的状态：画面模式和时刻、天气状态机、图层显隐等（由 scene/createSandbox.ts 记下和恢复） */
  world: Record<string, unknown>;
};

export type RenderSettings = {
  name: string;
  seconds: number;
  fps: number;
  size: OutputSize;
  /** 每帧的抗锯齿子采样数 */
  samples: number;
  /** 运动模糊的快门角度（0 = 关，180 = 电影常用）：每帧的子采样分布在 快门角度/360 × 1/fps 的时间里 */
  shutter?: number;
  profile: ProResProfile;
  /** 画幅（阶段 3 起；更早的任务没有这一项，按 16:9） */
  aspect?: Aspect;
  /** 按时间线渲染：从 from 秒到 to 秒（这时 seconds = to − from） */
  timeline?: { name: string; from: number; to: number; content: { theatre: Record<string, unknown> | null; links: TimelineLinks } };
  /** 把导入的配音 / 音乐一起写进成片（记的是文件名；重渲时要重新导入同一个音频） */
  audio?: { fileName: string; offset: number };
};

export type RenderJob = {
  id: string;
  /** 哪个区（光明 = guangming）；必须在同一个区的页面里渲染 */
  district: string;
  createdAt: string;
  settings: RenderSettings;
  scene: SceneSnapshot;
};

/** 渲染期间需要用到的场景接口（由 scene/createSandbox.ts 提供） */
export type StudioHooks = {
  captureScene: () => SceneSnapshot;
  restoreScene: (scene: SceneSnapshot) => void;
  /** 恢复起始状态之后、出第一帧之前：等近景高精度模型等异步资源加载完，免得成片中途换模型 */
  settle: () => Promise<void>;
  /** 推进模拟（固定步长），并把结果写进所有 uniform、灯光 */
  step: (delta: number) => void;
  pauseLive: () => void;
  resumeLive: () => void;
  frames: FrameRenderer;
  /** 时间线取值函数：t 秒时把镜头、时刻与天气、参数写好（任务里记的时间线和当前不同时，另建一份） */
  timelineEvaluator: (content: NonNullable<RenderSettings["timeline"]>["content"]) => Promise<(t: number) => void>;
  /** 当前导入的音频文件（没有则为 null） */
  audioFile: () => File | null;
};

export type Progress = { job: RenderJob; frame: number; frames: number; fps: number; etaSeconds: number };

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/__render/${path}`, init);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
};

/** 本地渲染服务是否可用（npm run dev 自带；还会报告找到的 ffmpeg） */
export const renderServerStatus = () => api<{ ffmpeg: string | null; version: string | null; outputDir: string }>("status");

/**
 * 渲染一个任务：恢复起始状态 → 逐帧（固定 1/fps 秒）推进、离屏出帧、交给 ffmpeg。
 * 上传上一帧和渲染下一帧同时进行（最多一帧在路上）。
 */
export async function runJob(job: RenderJob, hooks: StudioHooks, onProgress: (p: Progress) => void, shouldStop: () => boolean) {
  const { width, height } = outputSize(job.settings.size, job.settings.aspect);
  const { fps, samples, seconds, profile, timeline } = job.settings;
  const shutter = Math.min(360, Math.max(0, job.settings.shutter ?? 0)) / 360; // 快门开着的时间占一帧的比例
  const frames = Math.max(1, Math.round(seconds * fps));
  // 音频：先传到本地服务，ffmpeg 起来时就作为第二路输入
  let audio: { path: string; offset: number } | null = null;
  if (job.settings.audio) {
    const file = hooks.audioFile();
    if (!file || file.name !== job.settings.audio.fileName) throw new Error(`这条任务要带音频「${job.settings.audio.fileName}」，请先在「运镜与时间线」里导入它`);
    const uploaded = await api<{ path: string }>("audio?name=" + encodeURIComponent(file.name), { method: "POST", body: file });
    audio = { path: uploaded.path, offset: job.settings.audio.offset };
  }
  const evaluate = timeline ? await hooks.timelineEvaluator(timeline.content) : null;
  const started = await api<{ id: string; file: string }>("start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: job.settings.name, width, height, fps, profile, flipY: hooks.frames.flipY, audio, job }),
  });
  let channel: FrameChannel | null = null;
  hooks.pauseLive();
  const before = hooks.captureScene(); // 渲染完回到渲染前的画面
  hooks.restoreScene(job.scene);
  try {
    evaluate?.(timeline!.from);
    await hooks.settle();
  } catch (error) {
    hooks.restoreScene(before);
    hooks.resumeLive();
    await api("abort?id=" + started.id, { method: "POST" }).catch(() => undefined);
    throw error;
  }
  hooks.frames.begin(width, height);
  let uploading: Promise<unknown> = Promise.resolve();
  const t0 = performance.now();
  try {
    channel = await openFrameChannel(started.id);
    let simulated = 0; // 已经推进到的时间（相对任务开始，秒）
    for (let f = 0; f < frames; f += 1) {
      if (shouldStop()) throw new Error("已取消");
      // 第 f 帧的各次子采样：不开运动模糊时都在同一时刻（只做抗锯齿）；
      // 开了运动模糊时均匀分布在快门时间里，动的东西自然拖出模糊。所有时刻都由帧号算出，可以逐帧复现
      hooks.frames.beginFrame();
      for (let s = 0; s < samples; s += 1) {
        const t = (f + (samples > 1 ? (s / samples) * shutter : 0)) / fps; // 相对任务开始的时间（秒）
        evaluate?.(timeline!.from + t); // 按时间线：这一刻的镜头、时刻、参数
        hooks.step(t - simulated); // 第 0 帧第 0 次就是记下的起始画面（推进 0 秒）
        simulated = t;
        if (s === 0) await hooks.settle(); // 镜头飞近地标时触发的高精度模型，等它加载完再出这一帧，不会在随机的某一帧突然换上
        hooks.frames.addSample(s, samples);
      }
      const pixels = await hooks.frames.endFrame(samples);
      hooks.frames.preview();
      await uploading;
      uploading = channel.send(pixels);
      const elapsed = (performance.now() - t0) / 1000;
      const rate = (f + 1) / elapsed;
      onProgress({ job, frame: f + 1, frames, fps: rate, etaSeconds: (frames - f - 1) / rate });
    }
    await uploading;
    channel.close();
    return await api<{ file: string; bytes: number }>("finish?id=" + started.id, { method: "POST" });
  } catch (error) {
    await uploading.catch(() => undefined);
    channel?.close();
    await api("abort?id=" + started.id, { method: "POST" }).catch(() => undefined);
    throw error;
  } finally {
    hooks.frames.end();
    hooks.restoreScene(before);
    hooks.resumeLive();
  }
}

type FrameChannel = { send: (pixels: Uint8Array) => Promise<void>; close: () => void };

/**
 * 送帧通道（WebSocket）：一帧 4K 有 33MB，用普通 POST 发很慢，用 Blob 发又会占满浏览器内存。
 * 每发一帧，等本地服务回一条确认再算发完。
 */
function openFrameChannel(id: string) {
  return new Promise<FrameChannel>((resolve, reject) => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__render/ws?id=${id}`);
    socket.binaryType = "arraybuffer";
    const waiting: { resolve: () => void; reject: (e: Error) => void }[] = [];
    const failAll = (message: string) => { while (waiting.length) waiting.shift()!.reject(new Error(message)); };
    socket.onmessage = () => waiting.shift()?.resolve();
    socket.onclose = () => failAll("和本地渲染服务的连接断开了");
    socket.onerror = () => reject(new Error("连不上本地渲染服务"));
    socket.onopen = () => resolve({
      send: (pixels) => new Promise<void>((ok, fail) => { waiting.push({ resolve: ok, reject: fail }); socket.send(pixels as Uint8Array<ArrayBuffer>); }),
      close: () => { socket.onclose = null; socket.close(); },
    });
  });
}

/** 默认文件名：区名_月日-时分秒 */
export const defaultName = (prefix = "光明") => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${prefix}_${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
