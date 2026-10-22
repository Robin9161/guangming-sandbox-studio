/**
 * 画幅和预览布局：画面铺满整个窗口，成片的取景范围（选定画幅在窗口里能放下的最大矩形）用亮框标出，
 * 框外压暗——像相机的取景器。框里的构图和成片完全一样。另外可以叠加安全框。
 */
export const ASPECTS = {
  "16:9": { ratio: 16 / 9, size4k: [3840, 2160], size1080: [1920, 1080] },
  "9:16": { ratio: 9 / 16, size4k: [2160, 3840], size1080: [1080, 1920] },
  "1:1": { ratio: 1, size4k: [2160, 2160], size1080: [1080, 1080] },
  "2.39:1": { ratio: 2.39, size4k: [3840, 1608], size1080: [1920, 804] },
} as const;
export type Aspect = keyof typeof ASPECTS;

export const view = {
  aspect: "16:9" as Aspect,
  safeFrame: false,
  /** 导入的配音 / 音乐（只在本次打开页面期间有效） */
  audio: null as File | null,
};

/** 在窗口里放下指定比例的最大矩形（居中） */
export function fitRect(aspect: Aspect) {
  const W = window.innerWidth, H = window.innerHeight, r = ASPECTS[aspect].ratio;
  const w = Math.min(W, H * r), h = Math.min(H, W / r);
  return { left: Math.round((W - w) / 2), top: Math.round((H - h) / 2), width: Math.round(w), height: Math.round(h) };
}

/** 取景框：框外压暗；画幅和窗口比例一样时不显示 */
function layoutFrameMask() {
  let el = document.getElementById("frame-mask");
  if (!el) {
    el = document.createElement("div");
    el.id = "frame-mask";
    document.body.appendChild(el);
  }
  const r = fitRect(view.aspect);
  const full = r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1;
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: full ? "none" : "block" });
}

/** 安全框：动作安全区 93%、字幕安全区 90%（剪辑软件的标准） */
export function layoutSafeFrame() {
  layoutFrameMask();
  let el = document.getElementById("safe-frame");
  if (!el) {
    el = document.createElement("div");
    el.id = "safe-frame";
    el.innerHTML = '<div class="action"></div><div class="title"></div>';
    document.body.appendChild(el);
  }
  const r = fitRect(view.aspect);
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: view.safeFrame ? "block" : "none" });
}
