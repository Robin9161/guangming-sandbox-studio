/**
 * 「运镜与时间线」「渲染成片」两组面板的界面（放进右侧面板最下面），以及页面上的几个浮层：
 * 关闭时间线编辑器按钮、渲染进度条、短提示。按钮的行为在 timelinePanel.ts / renderPanel.ts 里绑定。
 */
export const STUDIO_PANEL_HTML = `
  <details id="timeline-panel">
    <summary>运镜与时间线</summary>
    <div class="row"><b>时间线：<span id="tl-name"></span> · <span id="tl-autosave"></span></b><button id="tl-play">▶ 播放时间线</button><button id="tl-editor" class="primary">打开时间线编辑器</button></div>
    <div class="row"><b>跟随时间线（关掉 = 手动控制）</b><button data-link="camera">镜头</button><button data-link="look">时刻与天气</button><button data-link="params">画面参数</button></div>
    <div class="row"><button id="tl-write-cam">写入当前视角（在播放头位置）</button></div>
    <div class="row"><b>运镜模板（不用打关键帧，叠加在镜头上）</b><select id="move-type"></select><select id="move-path"></select></div>
    <label>开始 <input id="move-start" type="number" step="0.1" value="0" /> 时长 <input id="move-duration" type="number" step="0.1" value="8" /></label>
    <label><span id="move-amount-label">幅度</span> <input id="move-amount" type="number" step="1" value="45" /><button id="move-apply">应用</button></label>
    <div class="row"><b>镜头库（存在工程 shots/ 里）</b><select id="shot-select"></select><button id="shot-load">用这个镜头</button></div>
    <label>名字 <input id="shot-name" type="text" /><button id="shot-save">存入</button></label>
    <div class="row"><b>画幅（预览和成片一致）</b><button data-aspect="16:9" class="on">16:9</button><button data-aspect="9:16">9:16</button><button data-aspect="1:1">1:1</button><button data-aspect="2.39:1">2.39:1</button><button id="safe-toggle">安全框</button></div>
    <div class="row"><b>配音 / 音乐（对节奏用）</b><button id="audio-import">导入音频</button><input id="audio-file" type="file" accept="audio/*" hidden /><span id="audio-name" class="hint"></span></div>
    <div class="row"><b>时间线文件（存在工程 timelines/ 里）</b><select id="tl-select"></select><button id="tl-open">打开</button></div>
    <label>另存为 <input id="tl-saveas-name" type="text" /><button id="tl-saveas">另存</button></label>
    <div id="tl-status" class="hint"></div>
  </details>
  <details id="render-panel">
    <summary>渲染成片</summary>
    <label>文件名 <input id="render-name" type="text" /></label>
    <div class="row"><b>内容</b><button data-source="current" class="on">当前画面</button><button data-source="timeline">按时间线</button></div>
    <label id="render-current-row">时长 <input id="render-seconds" type="number" min="0.5" max="600" step="0.5" value="10" /> 秒 · 60 帧</label>
    <label id="render-timeline-row">从 <input id="render-from" type="number" min="0" step="0.1" /> 到 <input id="render-to" type="number" min="0" step="0.1" /> 秒</label>
    <div class="row"><button id="render-audio">带上导入的音频</button></div>
    <div class="row"><b>尺寸</b><button data-size="4k" class="on">4K</button><button data-size="1080p">1080p 试渲染</button></div>
    <div class="row"><b>ProRes</b><button data-profile="lt">LT</button><button data-profile="422" class="on">422</button><button data-profile="hq">HQ</button></div>
    <div class="row"><b>抗锯齿（每帧渲染次数：越多越干净，也越慢）</b><button data-samples="1">1</button><button data-samples="4">4</button><button data-samples="8" class="on">8</button><button data-samples="16">16</button></div>
    <div class="row"><b>运动模糊（快门角度，默认关）</b><button data-shutter="0" class="on">关</button><button data-shutter="90">90°</button><button data-shutter="180">180°</button><button data-shutter="270">270°</button></div>
    <div class="row"><button id="render-add">＋ 记下当前画面，加入队列</button><button id="render-import" title="选 renders/ 里成片旁边的 .json，原样重渲那一条">导入任务</button><input id="render-file" type="file" accept=".json,application/json" multiple hidden /></div>
    <div id="queue"></div>
    <div class="row"><button id="render-start" class="primary">开始渲染队列</button></div>
    <div id="render-msg"></div>
  </details>
`;

/** 页面级浮层（加在 body 上） */
export function mountOverlays() {
  const close = document.createElement("button");
  close.id = "tl-close";
  close.textContent = "关闭时间线编辑器";
  const overlay = document.createElement("div");
  overlay.id = "render-overlay";
  overlay.innerHTML = '<span id="render-progress">准备中…</span><button id="render-cancel">取消</button>';
  document.body.append(close, overlay);
  return () => { close.remove(); overlay.remove(); document.getElementById("toast")?.remove(); document.getElementById("frame-mask")?.remove(); document.getElementById("safe-frame")?.remove(); document.getElementById("params-panel")?.remove(); };
}

/** 画面下方的短提示，几秒后自动消失 */
let toastTimer = 0;
export function showToast(text: string) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add("on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("on"), 4500);
}
