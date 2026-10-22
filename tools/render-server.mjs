// 本地渲染服务（Vite 插件，npm run dev 时自动启动）：接收浏览器逐帧送来的像素，交给 ffmpeg 合成 ProRes。
// 中间不落地图片：像素直接写进 ffmpeg 的标准输入。成片和对应的任务说明（.json，可用来重渲）放在 renders/。
//
// 接口（都在 /__render/ 下）：
//   GET  status            ffmpeg 是否可用
//   POST start             开始一个任务（JSON：name、width、height、fps、profile、flipY、job）→ { id, file }
//   WS   ws?id=…           送帧通道：每条二进制消息是一帧 RGBA 像素（width×height×4 字节），收完回一条 {"frames":n}
//   POST finish?id=…       收尾，等 ffmpeg 写完 → { file, bytes }
//   POST abort?id=…        取消，删除未完成的文件
//   POST audio?name=…      先传配音 / 音乐（请求体是音频文件）→ { path }；start 时带上 audio: { path, offset }
// 送帧用 WebSocket 而不是普通的 POST：一帧 4K 有 33MB，浏览器用 POST 发这么大的数据很慢，Blob 方式又会占满浏览器内存。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { isLocalRequest, READ_ONLY_MESSAGE } from "./local-only.mjs";

const PROFILES = { lt: 1, 422: 2, hq: 3 };
const IDLE_TIMEOUT_MS = 120_000; // 浏览器两分钟没送帧（关了页面、电脑睡了），就当任务中断

/** 找 ffmpeg：环境变量 FFMPEG_PATH → 工程自带的 ffmpeg-static → 系统 PATH */
function findFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    const bundled = createRequire(import.meta.url)("ffmpeg-static");
    if (bundled) candidates.push(bundled);
  } catch { /* 没装 */ }
  candidates.push("ffmpeg");
  for (const bin of candidates) {
    const probe = spawnSync(bin, ["-hide_banner", "-version"], { encoding: "utf8" });
    if (probe.status === 0) return { bin, version: probe.stdout.split("\n")[0] };
  }
  return null;
}

const safeName = (name) => String(name || "render").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120) || "render";

export function renderServer() {
  let ffmpeg; // 第一次用到时再找
  let outputDir;
  const jobs = new Map();

  const json = (res, status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
  const readJson = (req) => new Promise((resolve, reject) => { let s = ""; req.setEncoding("utf8"); req.on("data", (c) => (s += c)); req.on("end", () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); req.on("error", reject); });

  const stopJob = (job, removeFile) => {
    clearTimeout(job.idle);
    job.awake?.kill();
    if (job.proc.exitCode === null) job.proc.kill("SIGKILL");
    jobs.delete(job.id);
    if (job.audioPath) fs.rm(job.audioPath, { force: true }, () => {});
    if (removeFile) for (const f of [job.file, job.file.replace(/\.mov$/, ".json")]) fs.rm(f, { force: true }, () => {}); // 没渲染完的不留任何文件
  };
  const touch = (job) => { clearTimeout(job.idle); job.idle = setTimeout(() => stopJob(job, true), IDLE_TIMEOUT_MS); };

  const start = (body) => {
    ffmpeg ??= findFfmpeg();
    if (!ffmpeg) throw new Error("找不到 ffmpeg：请运行 npm install（会自动装上），或设置环境变量 FFMPEG_PATH");
    const { width, height, fps, profile, flipY, audio } = body;
    // 音频只接受本服务刚存的临时文件，不让请求随便指定电脑上的路径
    if (audio && !(path.dirname(path.resolve(audio.path)) === outputDir && path.basename(audio.path).startsWith(".audio-"))) throw new Error("音频文件不对");
    if (!(width > 0 && height > 0 && fps > 0) || !(profile in PROFILES)) throw new Error("参数不对");
    fs.mkdirSync(outputDir, { recursive: true });
    let base = safeName(body.name), file = path.join(outputDir, `${base}.mov`);
    for (let n = 2; fs.existsSync(file); n += 1) file = path.join(outputDir, `${base}-${n}.mov`);
    // 任务说明：起始状态 + 参数，用它可以原样重渲这一条
    fs.writeFileSync(file.replace(/\.mov$/, ".json"), JSON.stringify(body.job ?? body, null, 2));
    const filters = [flipY ? "vflip" : null, "scale=out_color_matrix=bt709:out_range=tv", "format=yuv422p10le"].filter(Boolean).join(",");
    const args = [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-framerate", String(fps), "-i", "pipe:0",
      // 音频：从 offset 秒开始取；比画面短时补静音，以画面长度为准
      ...(audio ? ["-ss", String(Math.max(0, audio.offset || 0)), "-i", audio.path, "-map", "0:v", "-map", "1:a", "-c:a", "pcm_s16le", "-af", "apad", "-shortest"] : []),
      "-vf", filters,
      "-c:v", "prores_ks", "-profile:v", String(PROFILES[profile]), "-vendor", "apl0", "-pix_fmt", "yuv422p10le",
      // 标准 SDR（Rec.709）标记，剪辑软件按正确的色彩解读
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-movflags", "+write_colr",
      file,
    ];
    const proc = spawn(ffmpeg.bin, args, { stdio: ["pipe", "ignore", "pipe"] });
    const job = { id: Math.random().toString(36).slice(2, 10), file, proc, audioPath: audio?.path ?? null, frameBytes: width * height * 4, frames: 0, stderr: "", error: null, idle: null, awake: null };
    proc.stderr.on("data", (c) => (job.stderr = (job.stderr + c).slice(-4000)));
    proc.stdin.on("error", () => {}); // ffmpeg 提前退出时，错误在 finish / frame 里报
    // 渲染期间不让电脑睡眠（macOS 自带 caffeinate；其他系统靠浏览器端的 Wake Lock）
    if (process.platform === "darwin") job.awake = spawn("caffeinate", ["-dims"], { stdio: "ignore" });
    jobs.set(job.id, job);
    touch(job);
    return job;
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, "http://local");
    const route = url.pathname.replace(/^\/+/, "");
    const job = jobs.get(url.searchParams.get("id"));
    try {
      if (route === "status" && req.method === "GET") {
        if (!isLocalRequest(req)) return json(res, 200, { ffmpeg: null, version: null, outputDir, readOnly: true });
        ffmpeg ??= findFfmpeg();
        return json(res, 200, { ffmpeg: ffmpeg?.bin ?? null, version: ffmpeg?.version ?? null, outputDir, readOnly: false });
      }
      if (req.method !== "POST") return json(res, 405, { error: "只接受 POST" });
      if (!isLocalRequest(req)) return json(res, 403, { error: READ_ONLY_MESSAGE });
      if (route === "start") {
        const j = start(await readJson(req));
        return json(res, 200, { id: j.id, file: j.file });
      }
      if (route === "audio") {
        // 存到 renders/ 下的临时文件，任务结束后删除
        fs.mkdirSync(outputDir, { recursive: true });
        const ext = path.extname(url.searchParams.get("name") || "").replace(/[^.\w]/g, "").slice(0, 8) || ".audio";
        const tmp = path.join(outputDir, `.audio-${Math.random().toString(36).slice(2, 10)}${ext}`);
        await new Promise((resolve, reject) => { const out = fs.createWriteStream(tmp); req.pipe(out); out.on("finish", resolve); out.on("error", reject); });
        return json(res, 200, { path: tmp });
      }
      if (!job) return json(res, 404, { error: "没有这个渲染任务（可能已超时中断）" });
      if (route === "finish") {
        clearTimeout(job.idle);
        const code = await new Promise((resolve) => { if (job.proc.exitCode !== null) resolve(job.proc.exitCode); else { job.proc.once("close", resolve); job.proc.stdin.end(); } });
        stopJob(job, code !== 0 || !!job.error);
        if (job.error) throw new Error(job.error);
        if (code !== 0) throw new Error(`ffmpeg 出错：${job.stderr.trim() || code}`);
        return json(res, 200, { file: job.file, bytes: fs.statSync(job.file).size, frames: job.frames });
      }
      if (route === "abort") {
        stopJob(job, true);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "未知接口" });
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };


  /** 解掩码：先逐字节对齐到 4 字节边界，再按 32 位整块异或（一帧 4K 33MB，逐字节要慢好几倍） */
  const unmask = (part, mask, pos) => {
    let i = 0;
    for (; i < part.length && (part.byteOffset + i) % 4 !== 0; i += 1) part[i] ^= mask[(pos + i) & 3];
    const words = Math.floor((part.length - i) / 4);
    if (words > 0) {
      const p = (pos + i) & 3;
      const m = Buffer.from([mask[p], mask[(p + 1) & 3], mask[(p + 2) & 3], mask[(p + 3) & 3]]).readUInt32LE(0);
      const u32 = new Uint32Array(part.buffer, part.byteOffset + i, words);
      for (let w = 0; w < words; w += 1) u32[w] ^= m;
      i += words * 4;
    }
    for (; i < part.length; i += 1) part[i] ^= mask[(pos + i) & 3];
  };

  /**
   * 送帧通道（最小的 WebSocket 服务端实现，只处理本工程需要的部分）：
   * 边收边解掩码、边写进 ffmpeg，不在内存里攒整帧；ffmpeg 来不及时暂停接收（背压）。
   */
  const acceptFrames = (socket, job) => {
    let header = Buffer.alloc(0), inPayload = false, remaining = 0, mask = null, maskPos = 0, fin = false, opcode = 0, frameBytes = 0;
    const sendText = (text) => { const payload = Buffer.from(text); socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload])); };
    const fail = (message) => { job.error = message; try { socket.end(Buffer.from([0x88, 0])); } catch { /* 已断开 */ } };
    const onMessageEnd = () => {
      if (opcode === 0x8) return socket.end(Buffer.from([0x88, 0])); // 浏览器关闭通道
      if (frameBytes !== job.frameBytes) return fail(`这一帧的数据大小不对：${frameBytes}，应为 ${job.frameBytes}`);
      frameBytes = 0;
      job.frames += 1;
      touch(job);
      sendText(JSON.stringify({ frames: job.frames }));
    };
    const consume = (chunk) => {
      let offset = 0;
      while (offset < chunk.length) {
        if (!inPayload) {
          // 帧头：2 字节 + 扩展长度（0 / 2 / 8 字节）+ 掩码（浏览器发来的一定有，4 字节）；可能被拆在两次 data 里
          const need = Math.min(14, chunk.length - offset);
          header = Buffer.concat([header, chunk.subarray(offset, offset + need)]);
          if (header.length < 2) { offset += need; continue; }
          const len7 = header[1] & 0x7f, masked = (header[1] & 0x80) !== 0;
          const headLen = 2 + (len7 === 126 ? 2 : len7 === 127 ? 8 : 0) + (masked ? 4 : 0);
          if (header.length < headLen) { offset += need; continue; }
          const used = need - (header.length - headLen); // 这次真正属于帧头的字节
          offset += used;
          fin = (header[0] & 0x80) !== 0;
          const op = header[0] & 0x0f;
          if (op !== 0) opcode = op; // 0 = 续帧，沿用上一条的类型
          remaining = len7 === 126 ? header.readUInt16BE(2) : len7 === 127 ? Number(header.readBigUInt64BE(2)) : len7;
          mask = masked ? header.subarray(headLen - 4, headLen) : null;
          maskPos = 0;
          header = Buffer.alloc(0);
          inPayload = true;
          if (remaining === 0) { inPayload = false; if (fin) onMessageEnd(); }
          continue;
        }
        const n = Math.min(remaining, chunk.length - offset);
        const part = chunk.subarray(offset, offset + n);
        if (mask) unmask(part, mask, maskPos);
        maskPos = (maskPos + n) & 3;
        offset += n;
        remaining -= n;
        if (opcode === 0x2) {
          frameBytes += n;
          if (!job.proc.stdin.write(part)) { socket.pause(); job.proc.stdin.once("drain", () => socket.resume()); }
        }
        if (remaining === 0) { inPayload = false; if (fin) onMessageEnd(); }
      }
    };
    socket.on("data", (chunk) => { try { consume(chunk); } catch (e) { fail(String(e)); } });
    socket.on("error", () => {});
  };

  const upgrade = (req, socket, head) => {
    const url = new URL(req.url, "http://local");
    if (url.pathname !== "/__render/ws") return; // 其他升级请求（Vite 自己的热更新）不管
    if (!isLocalRequest(req)) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    const job = jobs.get(url.searchParams.get("id"));
    const key = req.headers["sec-websocket-key"];
    if (!job || !key) { socket.end("HTTP/1.1 404 Not Found\r\n\r\n"); return; }
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    acceptFrames(socket, job);
    if (head?.length) socket.emit("data", head);
  };

  const install = (server) => {
    outputDir = path.join(server.config.root, "renders");
    server.middlewares.use("/__render", handler);
    server.httpServer?.on("upgrade", upgrade);
  };
  return { name: "studio-render-server", configureServer: install, configurePreviewServer: install };
}
