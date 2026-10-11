import * as THREE from "three";

/**
 * 生长动画的公共工具（全部在着色器里完成，几乎没有性能开销）。
 *
 * - "延伸"（道路、轨道）：几何体带一个顶点属性 aDist（沿线里程，米），
 *   片元里 aDist > uReveal 的部分丢弃；把 uReveal 从 0 拉到线路全长，就是线路"长出来"。
 * - 不需要动画时 uReveal 设为一个很大的数，整条线一次性显示。
 */
export const SHOW_ALL = 1e9;

let cacheCounter = 0;

/** 给材质加上"按里程显示"的能力；可与已有的 onBeforeCompile（如夜间发光）叠加 */
export function addReveal(material: THREE.Material, reveal: { value: number }) {
  const previous = material.onBeforeCompile;
  const key = `reveal-${(cacheCounter += 1)}`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uReveal = reveal;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aDist;\nvarying float vRevealDist;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRevealDist = aDist;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uReveal;\nvarying float vRevealDist;")
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vRevealDist > uReveal) discard;");
  };
  // 不同材质注入的代码不同，必须区分程序缓存，否则 three.js 可能复用错的着色器
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|${key}`;
  material.needsUpdate = true;
}

/** 一个"延伸"动画：在 seconds 秒内把 reveal 从 0 推到 total 米 */
export class RevealAnimation {
  readonly uniform = { value: SHOW_ALL };
  private elapsed = 0;
  private seconds = 0;
  private total = 0;
  private active = false;

  start(total: number, seconds: number) {
    this.total = total;
    this.seconds = Math.max(0.1, seconds);
    this.elapsed = 0;
    this.active = true;
    this.uniform.value = 0;
  }

  showAll() {
    this.active = false;
    this.uniform.value = SHOW_ALL;
  }

  hideAll() {
    this.active = false;
    this.uniform.value = -1;
  }

  get running() { return this.active; }

  /** 返回当前已显示到的里程 */
  update(delta: number) {
    if (!this.active) return this.uniform.value;
    this.elapsed += delta;
    const u = Math.min(1, this.elapsed / this.seconds);
    const eased = 1 - (1 - u) * (1 - u); // 先快后慢
    this.uniform.value = eased * this.total;
    if (u >= 1) this.showAll();
    return this.uniform.value;
  }
}
