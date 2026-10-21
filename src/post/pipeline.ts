import * as THREE from "three/webgpu";
import { clamp, color, exp, float, Fn, length, luminance, max, mix, mrt, normalView, output, pass, sample, screenUV, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";
import { ssao } from "three/addons/tsl/display/SSAONode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { LAYER_FOG, LAYER_SUNFOG, type Fog } from "../fx/fog";

/**
 * 后期：场景（带法线）→ AO → 体积雾合成（雾遮挡 + 太阳照雾）→ 全局调色 → 移轴 → 暗角 → 泛光
 */
export function createPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, fog: Fog) {
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  // 同时输出法线，给 AO 用
  scenePass.setMRT(mrt({ output, normal: normalView.mul(0.5).add(0.5) }));
  const sceneColor = scenePass.getTextureNode("output");
  const sceneDepth = scenePass.getTextureNode("depth");
  const sceneNormal = sample((st: THREE.Node) => scenePass.getTextureNode("normal").sample(st as ReturnType<typeof vec2>).xyz.mul(2.0).sub(1.0));

  const U = {
    ao: uniform(0.85),
    fogOn: uniform(1),
    shadowTint: uniform(color(1, 1, 1)),
    highTint: uniform(color(1, 1, 1)),
    grade: uniform(0),
    sat: uniform(1),
    tilt: uniform(1),
    vignette: uniform(0.35),
    bloom: uniform(0.15),
  };

  // AO（环境光遮蔽）：楼与楼、楼与地面接缝处的柔和暗部，微缩模型的质感主要靠它
  const aoPass = ssao(sceneDepth, sceneNormal, camera);
  aoPass.resolutionScale = 0.4;
  aoPass.radius.value = 45;
  const aoTerm = aoPass.getTextureNode().sample(screenUV).r;
  const sceneLit = sceneColor.rgb.mul(mix(float(1), aoTerm, U.ao));

  // 体积雾两层，各自在 0.35 倍分辨率下计算再模糊
  fog.fogMaterial.depthNode = sceneDepth.sample(screenUV);
  fog.sunFogMaterial.depthNode = sceneDepth.sample(screenUV);
  const layerPass = (layer: number) => {
    const layers = new THREE.Layers();
    layers.disableAll();
    layers.enable(layer);
    const p = pass(scene, camera, { depthBuffer: false });
    p.setLayers(layers);
    p.setResolutionScale(0.35);
    return gaussianBlur(p, uniform(0.8));
  };
  const fogBlur = layerPass(LAYER_FOG);
  const sunFogBlur = layerPass(LAYER_SUNFOG);
  // 合成：按雾的浓度把场景混向雾色（越浓越看不清背后），再加上被太阳照亮的雾
  const veil = clamp(float(1).sub(exp(fogBlur.r.mul(U.fogOn).negate())), 0, 0.95);
  const composed = mix(sceneLit, fog.U.color, veil).add(sunFogBlur.mul(U.fogOn));

  // 全局调色：暗部偏暗部色、亮部偏亮部色（两种色已归一到亮度 1，只改色相），以相乘为主保留色相差，再调饱和度
  const graded = Fn(() => {
    const c = composed.rgb.toVar();
    const l = luminance(c);
    const tint = mix(U.shadowTint, U.highTint, smoothstep(0.02, 0.55, l));
    c.assign(mix(c, c.mul(tint), U.grade));
    c.assign(mix(c, tint.mul(l), U.grade.mul(0.2)));
    return max(mix(vec3(luminance(c)), c, U.sat), vec3(0.0));
  })();
  // 移轴：画面上下边缘轻微虚化（微缩模型照片的感觉）
  const blurred = gaussianBlur(vec4(graded, 1.0), null, 3, { resolutionScale: 0.35 });
  const tilted = mix(graded, blurred.rgb, smoothstep(0.22, 0.48, screenUV.y.sub(0.55).abs()).mul(U.tilt));
  // 暗角
  const vignette = float(1).sub(smoothstep(0.45, 1.05, length(screenUV.sub(0.5).mul(vec2(1.25, 1.0)))).mul(U.vignette));
  const finalColor = tilted.mul(vignette);
  const bloomPass = bloom(vec4(finalColor, 1.0), 0.15, 0.4, 0.8);
  pipeline.outputNode = finalColor.add(bloomPass.mul(U.bloom));

  return { pipeline, U };
}

export type Pipeline = ReturnType<typeof createPipeline>;
