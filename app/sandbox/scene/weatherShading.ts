import * as THREE from "three";

/**
 * 天气在材质上的表现，统一注入到场景里的实体材质：
 * - 贴地雾：雾沉在地势低的地方（按世界高度指数衰减），山头和高楼露出来。清晨的晨雾和「雾」天气共用
 * - 积雪：朝上的面（地面、屋顶、树冠）慢慢积白，带一点斑驳
 */
export const weatherShadingUniforms = {
  uGFAmount: { value: 0 },
  uGFBase: { value: 0 },
  uGFHeight: { value: 80 },
  uGFDist: { value: 2500 },
  uGFColor: { value: new THREE.Color("#dfe6ee") },
  uSnow: { value: 0 },
};

let counter = 0;
/** snowScale：这种表面积雪的程度（路面少一些）；0 表示不积雪 */
export function addWeatherShading(material: THREE.Material, snowScale = 1) {
  const m = material as THREE.MeshStandardMaterial;
  if (m.userData.weatherShading || !(m.isMeshStandardMaterial || (m as unknown as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as unknown as THREE.MeshPhongMaterial).isMeshPhongMaterial)) return;
  m.userData.weatherShading = true;
  const previous = m.onBeforeCompile;
  const key = `weather-shading-${(counter += 1)}`;
  m.onBeforeCompile = (shader, renderer) => {
    previous.call(m, shader, renderer);
    Object.assign(shader.uniforms, weatherShadingUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWxWorld;\nvarying vec3 vWxNormal;")
      .replace("#include <fog_vertex>", `#include <fog_vertex>
        vec4 wxWorld = vec4(transformed, 1.0);
        vec3 wxNormal = objectNormal;
        #ifdef USE_INSTANCING
        wxWorld = instanceMatrix * wxWorld;
        wxNormal = mat3(instanceMatrix) * wxNormal;
        #endif
        vWxWorld = (modelMatrix * wxWorld).xyz;
        vWxNormal = normalize(mat3(modelMatrix) * wxNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGFAmount;\nuniform float uGFBase;\nuniform float uGFHeight;\nuniform float uGFDist;\nuniform vec3 uGFColor;\nuniform float uSnow;\nvarying vec3 vWxWorld;\nvarying vec3 vWxNormal;")
      .replace("#include <emissivemap_fragment>", `{
          // 积雪：朝上的面积白，越平越先白；按 25 m 的格子斑驳一点
          float up = smoothstep(0.85 - 0.55 * uSnow, 0.95 - 0.25 * uSnow, normalize(vWxNormal).y);
          float snowPatch = 0.7 + 0.3 * fract(sin(dot(floor(vWxWorld.xz / 25.0), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), clamp(uSnow * ${snowScale.toFixed(2)} * up * snowPatch * 1.2, 0.0, 1.0));
        }
        #include <emissivemap_fragment>`)
      .replace("#include <fog_fragment>", `#include <fog_fragment>
        {
          // 贴地雾：高度越低越浓，视线穿过的距离越长越浓
          float gfH = exp(-max(vWxWorld.y - uGFBase, 0.0) / uGFHeight);
          float gfD = 1.0 - exp(-length(vWxWorld - cameraPosition) / uGFDist);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uGFColor, clamp(uGFAmount * gfH * gfD, 0.0, 0.97));
        }`);
  };
  const previousKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${previousKey()}|${key}`;
  m.needsUpdate = true;
}
