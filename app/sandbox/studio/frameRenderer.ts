import * as THREE from "three/webgpu";
import { texture, uniform, vec4 } from "three/tsl";

/**
 * 离屏出帧：成片的一帧怎么从画面变成像素。
 *
 * - 尺寸固定（如 3840×2160），与浏览器窗口大小无关：渲染时把渲染器临时设成这个尺寸（像素比 1），
 *   整条后期链（AO、雾、移轴、泛光）都按这个尺寸计算
 * - 多帧累积抗锯齿：同一时刻把镜头按亚像素错开渲染 N 次，累加后取平均。边缘、细线、远处窗格都更干净；
 *   不需要超大的超采样画布，8GB 内存的电脑也能出 4K
 * - 最后读回 8 位 RGBA 像素，交给本地 ffmpeg 合成 ProRes
 */
export function createFrameRenderer(renderer: THREE.WebGPURenderer, pipeline: THREE.RenderPipeline, camera: THREE.PerspectiveCamera) {
  let width = 0, height = 0;
  let frameRT: THREE.RenderTarget | null = null; // 一次子采样的完整画面（已调色、色调映射，sRGB 编码）
  let accumRT: THREE.RenderTarget | null = null; // 子采样累加（半精度浮点：可混合的格式，累加 16 次后精度仍高于 8 位）
  let outRT: THREE.RenderTarget | null = null; // 平均后的 8 位画面（读回给 ffmpeg）

  const sampleCount = uniform(1);
  const frameTex = texture(new THREE.Texture());
  const accumTex = texture(new THREE.Texture());
  const outTex = texture(new THREE.Texture());

  // 累加：直接相加（One + One），浮点画布不会溢出
  const addMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.CustomBlending, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, depthTest: false, depthWrite: false });
  addMaterial.colorNode = frameTex;
  const addQuad = new THREE.QuadMesh(addMaterial);
  const averageMaterial = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  averageMaterial.colorNode = vec4(accumTex.rgb.div(sampleCount), 1.0);
  const averageQuad = new THREE.QuadMesh(averageMaterial);
  // 屏幕预览：把刚出的这一帧原样显示在窗口里（像素已经是最终颜色，显示时不再做色调映射和色彩空间转换）
  const previewMaterial = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  previewMaterial.colorNode = vec4(outTex.rgb, 1.0);
  const previewQuad = new THREE.QuadMesh(previewMaterial);

  // 恢复用：开始渲染前的窗口尺寸和像素比
  const saved = { pixelRatio: 1, size: new THREE.Vector2(), aspect: 1, clearColor: new THREE.Color(), clearAlpha: 1 };

  /** 进入渲染：渲染器切到成片尺寸 */
  const begin = (w: number, h: number) => {
    width = w; height = h;
    saved.pixelRatio = renderer.getPixelRatio();
    renderer.getSize(saved.size);
    saved.aspect = camera.aspect;
    renderer.getClearColor(saved.clearColor);
    saved.clearAlpha = renderer.getClearAlpha();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false); // false：画布在页面上的显示尺寸不变，只改内部分辨率
    camera.clearViewOffset(); // 去掉预览用的"取景框外延伸"，成片只渲染取景框里的画面
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const make = (type: THREE.TextureDataType) => new THREE.RenderTarget(w, h, { type, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    frameRT = make(THREE.HalfFloatType);
    accumRT = make(THREE.HalfFloatType); // 32 位浮点在不少显卡上不支持混合
    outRT = make(THREE.UnsignedByteType);
    frameTex.value = frameRT.texture;
    accumTex.value = accumRT.texture;
    outTex.value = outRT.texture;
    // 预热：改尺寸后的第一次渲染，后期链里的部分画布还是旧尺寸（画面会被横向拉伸），先空渲染一次丢掉
    renderer.setRenderTarget(frameRT);
    renderPipeline();
    renderer.setRenderTarget(null);
  };

  /** 退出渲染：恢复窗口尺寸，释放离屏画布 */
  const end = () => {
    camera.clearViewOffset();
    renderer.setRenderTarget(null);
    renderer.setPixelRatio(saved.pixelRatio);
    renderer.setSize(saved.size.x, saved.size.y, false);
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    renderer.setClearColor(saved.clearColor, saved.clearAlpha);
    for (const rt of [frameRT, accumRT, outRT]) rt?.dispose();
    frameRT = accumRT = outRT = null;
  };

  /**
   * 推进 three.js 内部的"帧号"。后期链里的场景渲染（PassNode）每个帧号只画一次场景，
   * 帧号平时由浏览器的动画循环推进；离屏出帧时动画循环是停的（页面在后台时也不跑），
   * 不手动推进的话，每次都只是把第一次画的旧画面重新合成一遍。
   */
  const nodeFrame = (renderer as unknown as { _nodes: { nodeFrame: { update: () => void } } })._nodes.nodeFrame;
  const renderPipeline = () => { nodeFrame.update(); pipeline.render(); };

  /** Halton 序列：在一个像素内均匀分布的亚像素偏移 */
  const halton = (i: number, base: number) => { let f = 1, r = 0; while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); } return r; };

  /**
   * 出一帧分三步（运动模糊时，每次子采样之间会推进一点时间，见 render/jobs.ts）：
   * beginFrame 清空累加画布 → addSample 按第 s 个亚像素偏移渲染一次并累加 → endFrame 平均、读回像素。
   * 读回的是紧密排列的 RGBA（每行 width×4 字节，从上到下；WebGL2 降级时从下到上，见 flipY）。
   */
  const beginFrame = () => {
    if (!frameRT || !accumRT || !outRT) throw new Error("没有进入渲染状态");
    renderer.setRenderTarget(accumRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
  };
  const addSample = (s: number, samples: number) => {
    // 第一次不偏移；之后按 Halton(2,3) 在像素内错开（±0.5 像素）
    const jx = samples > 1 ? halton(s + 1, 2) - 0.5 : 0, jy = samples > 1 ? halton(s + 1, 3) - 0.5 : 0;
    camera.setViewOffset(width, height, jx, jy, width, height);
    renderer.setRenderTarget(frameRT);
    renderPipeline();
    renderer.setRenderTarget(accumRT);
    // 渲染器默认每次绘制前先清空画布，累加时必须关掉，否则只剩最后一次子采样
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    addQuad.render(renderer);
    renderer.autoClear = autoClear;
    camera.clearViewOffset();
  };
  const endFrame = async (samples: number) => {
    sampleCount.value = samples;
    renderer.setRenderTarget(outRT);
    averageQuad.render(renderer);
    renderer.setRenderTarget(null);
    const raw = (await renderer.readRenderTargetPixelsAsync(outRT!, 0, 0, width, height)) as Uint8Array<ArrayBuffer>;
    // GPU 读回时每行按 256 字节对齐；不是整倍数时去掉行尾的填充
    const rowBytes = width * 4;
    if (raw.length === rowBytes * height) return raw;
    const stride = Math.ceil(rowBytes / 256) * 256;
    const packed = new Uint8Array(new ArrayBuffer(rowBytes * height));
    for (let y = 0; y < height; y += 1) packed.set(raw.subarray(y * stride, y * stride + rowBytes), y * rowBytes);
    return packed;
  };
  /** 出一帧（不做运动模糊）：同一时刻渲染 samples 次取平均 */
  const capture = async (samples: number) => {
    beginFrame();
    for (let s = 0; s < samples; s += 1) addSample(s, samples);
    return endFrame(samples);
  };

  /** 把最近一帧显示在窗口里（只是给人看进度，不影响成片） */
  const preview = () => {
    if (!outRT) return;
    const { toneMapping, outputColorSpace } = renderer;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setRenderTarget(null);
    previewQuad.render(renderer);
    renderer.toneMapping = toneMapping; // 在下一次 pipeline.render() 之前恢复，后期链不会因此重建
    renderer.outputColorSpace = outputColorSpace;
  };

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  return { begin, end, capture, beginFrame, addSample, endFrame, preview, /** WebGL2 降级时读回的行序是从下到上，合成时需要上下翻转 */ flipY: !isWebGPU };
}

export type FrameRenderer = ReturnType<typeof createFrameRenderer>;
