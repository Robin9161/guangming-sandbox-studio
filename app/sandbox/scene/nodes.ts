import * as THREE from "three/webgpu";
import { float, materialColor, materialEmissive, output, vec3, vec4, vertexColor } from "three/tsl";

/**
 * 材质增强（WebGPU / TSL 版，替代原来逐个材质注入 GLSL 的 onBeforeCompile）。
 *
 * 场景里大部分材质仍是普通的 MeshStandardMaterial：WebGPURenderer 渲染时会把它转成节点材质，
 * 并且会把材质上的 colorNode / emissiveNode / outputNode / maskNode / positionNode 一起带过去；
 * 颜色、粗糙度、自发光强度等普通属性仍在渲染时实时读取，所以原来运行时改材质的代码不用动。
 *
 * 多个效果可以叠在同一个材质上（例如路面：夜间发光 + 路灯 + 按里程显露 + 积雪 + 贴地雾 + 区界遮罩），
 * 每个效果往这里登记一段节点，最后统一拼成材质的几个节点。
 */
type N = ReturnType<typeof vec3>;
type ColorMod = (rgb: N) => N;
type OutputMod = (rgba: ReturnType<typeof vec4>) => ReturnType<typeof vec4>;

type Fx = {
  color: ColorMod[];
  emissive: N[];
  output: OutputMod[];
  mask: ReturnType<typeof float>[];
  position: ((p: N) => N) | null;
  vertexColors: boolean;
};

// 不放在 material.userData 里：material.clone() 会把 userData 按 JSON 深拷贝，节点会变成没用的普通对象
const registry = new WeakMap<THREE.Material, Fx>();
const fxOf = (material: THREE.Material): Fx => {
  let fx = registry.get(material);
  if (!fx) { fx = { color: [], emissive: [], output: [], mask: [], position: null, vertexColors: !!(material as THREE.MeshStandardMaterial).vertexColors }; registry.set(material, fx); }
  return fx;
};

function rebuild(material: THREE.Material) {
  const fx = fxOf(material);
  const m = material as THREE.Material & { colorNode?: unknown; emissiveNode?: unknown; outputNode?: unknown; maskNode?: unknown; positionNode?: unknown; vertexColors?: boolean };
  // 直接拼节点表达式（不包 Fn）：同一材质会被主渲染和阴影各编译一次，Fn 里的临时变量不能跨两次复用
  if (fx.color.length) {
    // 颜色修改要作用在"已乘顶点色"的底色上：顶点色由这里乘，材质本身不再乘第二次
    m.vertexColors = false;
    const base = vec3(materialColor);
    let rgb = (fx.vertexColors ? base.mul(vertexColor().rgb) : base) as unknown as N;
    for (const mod of fx.color) rgb = mod(rgb);
    m.colorNode = vec4(rgb, 1.0); // 透明度另由材质的 opacity 乘
  }
  if (fx.emissive.length) {
    let e = vec3(materialEmissive) as unknown as N;
    for (const add of fx.emissive) e = e.add(add) as unknown as N;
    m.emissiveNode = e;
  }
  if (fx.output.length) {
    let c = vec4(output) as unknown as ReturnType<typeof vec4>;
    for (const mod of fx.output) c = mod(c);
    m.outputNode = c;
  }
  if (fx.mask.length) {
    let keep = fx.mask[0].greaterThan(0.5);
    for (const k of fx.mask.slice(1)) keep = keep.and(k.greaterThan(0.5));
    m.maskNode = keep;
  }
  if (fx.position) m.positionNode = fx.position;
  material.needsUpdate = true;
}

/** 改底色（在光照之前）：rgb → 新 rgb。已乘顶点色。 */
export function addColorMod(material: THREE.Material, mod: ColorMod) { fxOf(material).color.push(mod); rebuild(material); }
/** 加一份自发光 */
export function addEmissive(material: THREE.Material, node: unknown, _tag = "") { fxOf(material).emissive.push(node as N); rebuild(material); }
/** 改最终输出颜色（含光照和场景雾之后），例如贴地雾 */
export function addOutputMod(material: THREE.Material, mod: OutputMod) { fxOf(material).output.push(mod); rebuild(material); }
/** 丢弃片元：keep < 0.5 的地方不画 */
export function addMask(material: THREE.Material, keep: unknown) { fxOf(material).mask.push(keep as ReturnType<typeof float>); rebuild(material); }
/** 顶点位置（局部坐标）：只能设一个 */
export function setPosition(material: THREE.Material, node: unknown) { fxOf(material).position = node as (p: N) => N; rebuild(material); }
/** 这个材质的原始"是否用顶点色"（rebuild 后材质上的 vertexColors 可能已被关掉） */
export const usesVertexColors = (material: THREE.Material) => fxOf(material).vertexColors;
