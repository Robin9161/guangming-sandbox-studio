import * as THREE from "three/webgpu";
import { abs, attribute, cameraPosition, color, float, floor, fract, hash, length, max, mix, normalize, pow, positionWorld, reflector, smoothstep, step, texture, texture3D, time, uniform, vec2, vec3, vec4 } from "three/tsl";
import { buildWater } from "../geo/features";
import { water as waterStyle } from "../style/palette";
import { pairs } from "../geo/types";
import type { Region } from "../core/region";
import type { LookUniforms } from "../look/uniforms";
import type { Precipitation } from "../fx/precipitation";

/** 水的分级：深度上限、倒影强度、（预留，暂未使用）、岸边浅色边。同一色相，用明度、清澈度、倒影强度区分深浅（见 docs/美术风格与设计规范.md 第 7 节） */
const TIERS = {
  pond: [0.3, 0.35, 0.35, 1.0], // 小水坑、鱼塘：最浅、略浑、倒影弱，岸边一圈浅色边
  lake: [0.7, 0.75, 0.12, 0.6], // 湖、普通水面：标准水色
  reservoir: [1.0, 1.0, 0.0, 0.35], // 水库：最深、最冷，倒影像镜面
  river: [0.5, 0.4, 0.2, 0.5], // 河道面：流动的水，倒影弱
} as const;
const tierOf = (c: string, area: number) => (c === "river" ? TIERS.river : c === "reservoir" || area > 200000 ? TIERS.reservoir : c === "pond" || area < 10000 ? TIERS.pond : TIERS.lake);

/** 水面：倒影 + 菲涅尔 + 微波 + 雨点涟漪 + 按塘 / 湖 / 水库 / 河分级的深浅 */
export function buildWaterLayer(region: Region, U: LookUniforms, noise3D: THREE.Data3DTexture, rainLevel: Precipitation["U"]["rainLevel"]) {
  const { full, local, terrain, cx, cz, HX, HZ, HMAX } = region;
  const group = buildWater(local, terrain);
  const waterMeshes: THREE.Mesh[] = [];
  group.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && (mesh.material as THREE.Material).name !== "embankment") waterMeshes.push(mesh); });

  // 平面反射：切块时取范围内最大的那片水的水面高度；全区时每帧取镜头附近最大的那片水（followReflection）
  let planeY = region.baseY, bestArea = 0;
  for (const mesh of waterMeshes) {
    const box = new THREE.Box3().setFromObject(mesh);
    const w = Math.min(box.max.x, cx + HX) - Math.max(box.min.x, cx - HX), d = Math.min(box.max.z, cz + HZ) - Math.max(box.min.z, cz - HZ);
    const area = Math.max(0, w) * Math.max(0, d);
    if (!Number.isFinite(area) || !Number.isFinite(box.max.y)) continue; // 个别水面数据没有高度，跳过
    if (area > bestArea) { bestArea = area; planeY = box.max.y; }
  }
  const bodies = waterMeshes.map((mesh) => { const b = new THREE.Box3().setFromObject(mesh); return { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, y: b.max.y, area: (b.max.x - b.min.x) * (b.max.z - b.min.z) }; }).filter((b) => Number.isFinite(b.y) && Number.isFinite(b.area));
  const reflection = reflector({ resolutionScale: full ? 0.35 : 0.5, bounces: false });
  reflection.target.rotateX(-Math.PI / 2);
  reflection.target.position.set(cx, planeY, cz);

  const W = {
    wave: uniform(1),
    color: uniform(color(waterStyle.area)),
    shallow: uniform(color("#a9dccf")),
    deep: uniform(color("#2f7f98")),
    rim: uniform(color("#e4efe6")),
  };
  const wp = positionWorld.xz;
  // 微波：两层缓慢流动的噪声，让倒影轻轻晃动
  const waveA = texture3D(noise3D, vec3(wp.div(160.0), time.mul(0.02)).mod(1.0), 0).r.sub(0.5);
  const waveB = texture3D(noise3D, vec3(wp.div(70.0).add(17.0), time.mul(0.035)).mod(1.0), 0).r.sub(0.5);
  const waveOffset = vec2(waveA, waveB).mul(0.014).mul(W.wave);
  // 雨点涟漪：水面按 8 m 的格子，每格随机时刻冒出一圈扩散的波纹；雨越大，冒波纹的格子越多
  const cellP = wp.div(8.0);
  const cellId = floor(cellP);
  const cellF = fract(cellP);
  const seedA = hash(cellId.x.add(cellId.y.mul(157.0)));
  const seedB = hash(cellId.x.mul(1.7).add(cellId.y.mul(91.0)).add(3.0));
  const dropAt = vec2(seedA, seedB).mul(0.6).add(0.2);
  const age = fract(time.mul(0.9).add(seedA.mul(7.0)));
  const toDrop = cellF.sub(dropAt);
  const ring = smoothstep(0.07, 0.0, abs(length(toDrop).sub(age.mul(0.42)))).mul(float(1).sub(age)).mul(step(seedB, rainLevel.mul(1.6)));
  const rippleOffset = normalize(toDrop.add(vec2(1e-4))).mul(ring).mul(0.03);
  reflection.uvNode = reflection.uvNode!.add(waveOffset).add(rippleOffset);
  // 菲涅尔：从上往下看能看到水的颜色，越斜看越以倒影为主
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1).sub(max(viewDir.y, 0.0)), 4.0).mul(0.8).add(0.18);

  // 离岸距离图：把水面画成白色再模糊。近岸（约 16 m）负责岸边浅色带，远岸（约 125 m）负责大水面中心变深
  const SHORE = full ? 2048 : 1024;
  const metersPerPx = (HMAX * 2) / SHORE;
  const raw = document.createElement("canvas");
  raw.width = raw.height = SHORE;
  {
    const g = raw.getContext("2d")!;
    const toPx = (x: number, z: number) => [((x - (cx - HMAX)) / (HMAX * 2)) * SHORE, ((z - (cz - HMAX)) / (HMAX * 2)) * SHORE] as const;
    g.fillStyle = "#000"; g.fillRect(0, 0, SHORE, SHORE); g.fillStyle = "#fff";
    for (const area of local.water.areas) {
      g.beginPath();
      for (const r of [area.p, ...area.h]) pairs(r).forEach(([x, z], i) => { const [px, pz] = toPx(x, z); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
      g.fill("evenodd");
    }
  }
  const shoreMap = (px: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = SHORE;
    const g = c.getContext("2d")!;
    g.filter = `blur(${px}px)`;
    g.drawImage(raw, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    return t;
  };
  const shoreUv = positionWorld.xz.sub(vec2(cx - HMAX, cz - HMAX)).div(HMAX * 2);
  const shore = texture(shoreMap(16 / metersPerPx), shoreUv).r; // 0.5 ≈ 岸线，往里很快到 1
  const center = texture(shoreMap(125 / metersPerPx), shoreUv).r; // 只有大水面的中心才接近 1

  const areaMeshes = group.children.filter((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === "ShapeGeometry") as THREE.Mesh[];
  areaMeshes.forEach((mesh, i) => {
    const a = local.water.areas[i];
    const t = tierOf(a.c, (a as unknown as { area: number }).area ?? 0);
    const n = mesh.geometry.attributes.position.count;
    const arr = new Float32Array(n * 4);
    for (let k = 0; k < n; k += 1) arr.set(t, k * 4);
    mesh.geometry.setAttribute("aTier", new THREE.BufferAttribute(arr, 4));
  });
  const makeMaterial = (tierInput: THREE.Node, mirror = true) => {
    const tier = tierInput as unknown as ReturnType<typeof vec4>;
    // 深度 = 近岸浅色带（占三成）+ 离岸越远越深（占七成），再乘这一级的深度上限
    const depth = smoothstep(0.5, 0.95, shore).mul(0.3).add(smoothstep(0.35, 0.95, center).mul(0.7)).mul(tier.x);
    const rim = float(1).sub(smoothstep(0.45, 0.7, shore)).mul(tier.w);
    const body = mix(mix(W.shallow, W.deep, depth), W.rim, rim.mul(0.55));
    const reflectK = fresnel.mul(tier.y);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 });
    m.colorNode = body.mul(float(1).sub(reflectK));
    // 镜面倒影只给湖塘水库（同一张倒影只能给一组水面用，否则渲染倒影时会读写冲突）；河道只反射天空的颜色
    const reflected = mirror ? reflection.rgb : U.horizon.mul(0.9);
    m.emissiveNode = reflected.mul(reflectK).mul(0.9).add(vec3(ring.mul(0.12)));
    m.roughnessNode = mix(float(0.12), float(0.45), rainLevel); // 下雨时水面不再那么光滑，太阳高光变散
    return m;
  };
  const areaMaterial = makeMaterial(attribute("aTier", "vec4"));
  for (const mesh of areaMeshes) mesh.material = areaMaterial;
  // 线状的河、溪、渠：按"河"这一级，统一参数
  const riverMaterial = makeMaterial(vec4(0.45, 0.35, 0.2, 0.0), false);
  for (const mesh of waterMeshes) if (!areaMeshes.includes(mesh) && (mesh.material as THREE.MeshStandardMaterial).roughness === 0.25) mesh.material = riverMaterial;

  /** 全区：倒影平面取镜头附近最大的那片水的水面高度 */
  const followReflection = (target: THREE.Vector3) => {
    let best = -1, bestY = reflection.target.position.y;
    for (const b of bodies) { const d = Math.hypot(b.x - target.x, b.z - target.z); const score = b.area / (1 + (d / 800) ** 2); if (score > best) { best = score; bestY = b.y; } }
    reflection.target.position.set(target.x, bestY, target.z);
  };

  return { group, reflectionTarget: reflection.target, U: W, followReflection };
}

export type WaterLayer = ReturnType<typeof buildWaterLayer>;
