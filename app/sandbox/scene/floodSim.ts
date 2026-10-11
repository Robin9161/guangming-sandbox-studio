import * as THREE from "three/webgpu";
import { attribute, clamp, color, varying, float, Fn, If, instancedArray, instanceIndex, int, max, min, mix, smoothstep, uniform, vec3, vec4 } from "three/tsl";
import type { Terrain } from "./terrain";

/**
 * 积水模拟（WebGPU 计算着色器，"管道模型"浅水近似）：
 * - 数据：DeepSeek 准备的 30 m 网格真实海拔（未夸张）+ 河道掩膜（public/sandbox/flood/）
 * - 每格一个水深 W；每步按"水面高（地面 + 水深）"之差算出流向东南西北四个邻格的流量，
 *   流量有惯性、不能超过格子里现有的水；下雨往每格加水，下渗扣一点，河道把水快速带走，网格四周是出口
 * - 结果：雨水顺地形往低处汇集，在低平城区涨起来，雨停后慢慢退去。没有管网和泵站，表现的是"地形积水"
 * - 显示：一张半分辨率的水面网格，顶点高度 = 渲染地形高度 + 水深（放大便于看清），水浅处透明
 */
type Grid = { nx: number; nz: number; spacing: number; x0: number; z0: number };

const SUBSTEPS = 16; // 每帧模拟步数
const DT = 1.5; // 每步模拟秒数（30 m 网格、水深几米以内时稳定）
const G = 9.81;
const DEPTH_SCALE = 3; // 显示时把水深放大，微缩视角下才看得出涨水

export async function createFloodSim(scene: THREE.Scene, renderer: THREE.WebGPURenderer, terrain: Terrain) {
  const [meta, elevBuf, chanBuf] = await Promise.all([
    fetch("/sandbox/flood/elevation.json").then((r) => r.json() as Promise<{ grid: Grid }>),
    fetch("/sandbox/flood/elevation.bin").then((r) => r.arrayBuffer()),
    fetch("/sandbox/flood/channels.bin").then((r) => r.arrayBuffer()),
  ]);
  const { nx, nz, spacing: L, x0, z0 } = meta.grid;
  const N = nx * nz;
  const elev = new Float32Array(elevBuf);
  const chan = new Uint8Array(chanBuf);
  const channel = new Float32Array(N);
  for (let k = 0; k < N; k += 1) channel[k] = chan[k] === 1 ? 1 : 0;

  const elevB = instancedArray(elev, "float");
  const chanB = instancedArray(channel, "float");
  const water = instancedArray(new Float32Array(N), "float");
  const flux = instancedArray(new Float32Array(N * 4), "vec4"); // 流向 东(+x) 西(−x) 南(+z) 北(−z)
  const uRain = uniform(0); // 降雨强度（米/秒）
  const uRun = uniform(0);

  const idx = (i: unknown, j: unknown) => int(j as never).mul(nx).add(int(i as never));
  const head = (k: unknown) => (elevB.element(k as never) as unknown as ReturnType<typeof float>).add(water.element(k as never) as never);

  // 第一步：算流量
  const fluxStep = Fn(() => {
    const k = instanceIndex;
    const i = int(k.mod(nx)), j = int(k.div(nx));
    const h = head(k);
    // 邻格水面高；出了网格就当成出口（比本格低 2 m）
    const nb = (di: number, dj: number) => {
      const ii = i.add(di), jj = j.add(dj);
      const inside = ii.greaterThanEqual(0).and(ii.lessThan(nx)).and(jj.greaterThanEqual(0)).and(jj.lessThan(nz));
      return inside.select(head(idx(clamp(ii as never, 0, nx - 1), clamp(jj as never, 0, nz - 1))), (elevB.element(k) as unknown as ReturnType<typeof float>).sub(2));
    };
    const prev = flux.element(k) as unknown as ReturnType<typeof vec4>;
    const c = float(DT * G * L);
    const f = max(vec4(0), prev.mul(0.985).add(vec4(h.sub(nb(1, 0)), h.sub(nb(-1, 0)), h.sub(nb(0, 1)), h.sub(nb(0, -1))).mul(c))).toVar();
    // 流出总量不能超过格子里的水
    const total = f.x.add(f.y).add(f.z).add(f.w);
    const vol = (water.element(k) as unknown as ReturnType<typeof float>).mul(L * L);
    If(total.mul(DT).greaterThan(vol), () => { f.assign(f.mul(vol.div(max(total.mul(DT), 1e-6)))); });
    flux.element(k).assign(f.mul(uRun));
  })().compute(N);

  // 第二步：更新水深
  const depthStep = Fn(() => {
    const k = instanceIndex;
    const i = int(k.mod(nx)), j = int(k.div(nx));
    const f = flux.element(k) as unknown as ReturnType<typeof vec4>;
    const out = f.x.add(f.y).add(f.z).add(f.w);
    const from = (di: number, dj: number, comp: "x" | "y" | "z" | "w") => {
      const ii = i.add(di), jj = j.add(dj);
      const inside = ii.greaterThanEqual(0).and(ii.lessThan(nx)).and(jj.greaterThanEqual(0)).and(jj.lessThan(nz));
      return inside.select((flux.element(idx(clamp(ii as never, 0, nx - 1), clamp(jj as never, 0, nz - 1))) as unknown as ReturnType<typeof vec4>)[comp], float(0));
    };
    // 东邻往西流、西邻往东流、南邻往北流、北邻往南流
    const inflow = from(1, 0, "y").add(from(-1, 0, "x")).add(from(0, 1, "w")).add(from(0, -1, "z"));
    const w = (water.element(k) as unknown as ReturnType<typeof float>).add(inflow.sub(out).mul(DT / (L * L))).add(uRain.mul(DT)).toVar();
    // 下渗约 8 mm/h；河道把水很快带走
    w.assign(w.sub(float(0.008 / 3600 * DT)));
    const ch = chanB.element(k) as unknown as ReturnType<typeof float>;
    // 河道排水能力有限（暴雨时河水也涨），每步只带走一小部分
    w.assign(mix(w, w.mul(0.97), ch.mul(uRun)));
    water.element(k).assign(max(w, 0));
  })().compute(N);

  const reset = Fn(() => { water.element(instanceIndex).assign(0); flux.element(instanceIndex).assign(vec4(0)); })().compute(N);

  // ---- 显示：半分辨率水面网格 ----
  const sx = Math.ceil(nx / 2), sz = Math.ceil(nz / 2);
  const pos = new Float32Array(sx * sz * 3);
  const cell = new Float32Array(sx * sz);
  // 只在低平处显示积水：海拔 30 m 以上逐渐不显示（山里的小坑多是高程数据的噪声，官方易涝点都在低平城区）
  const low = new Float32Array(sx * sz);
  for (let b = 0; b < sz; b += 1) for (let a = 0; a < sx; a += 1) {
    const i = Math.min(nx - 1, a * 2), j = Math.min(nz - 1, b * 2), v = b * sx + a;
    const x = x0 + i * L, z = z0 + j * L;
    pos.set([x, terrain.heightAt(x, z), z], v * 3);
    cell[v] = j * nx + i;
    low[v] = 1 - THREE.MathUtils.smoothstep(elev[j * nx + i], 22, 32);
  }
  const index: number[] = [];
  for (let b = 0; b < sz - 1; b += 1) for (let a = 0; a < sx - 1; a += 1) { const v = b * sx + a; index.push(v, v + sx, v + 1, v + 1, v + sx, v + sx + 1); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aCell", new THREE.BufferAttribute(cell, 1));
  geometry.setAttribute("aLow", new THREE.BufferAttribute(low, 1));
  geometry.setIndex(index);
  const material = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.2, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 });
  const depthAt = water.element(int(attribute("aCell", "float")) as never) as unknown as ReturnType<typeof float>;
  material.positionNode = Fn(() => {
    const p = attribute("position", "vec3");
    return vec3(p.x, p.y.add(min(depthAt, 6).mul(DEPTH_SCALE)).add(0.8), p.z);
  })();
  // 浅水浅蓝、深水深蓝；水深不到几厘米的地方看不见。水深在顶点里读一次，插值传给片元
  const d = varying(depthAt);
  material.colorNode = mix(color("#7cc4dc"), color("#2a6f9c"), smoothstep(0.1, 1.2, d));
  material.opacityNode = smoothstep(0.01, 0.08, d).mul(0.85).mul(attribute("aLow", "float"));
  material.emissiveNode = mix(color("#9fd3e6"), color("#2f7fa8"), smoothstep(0.1, 1.5, d)).mul(0.15);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "flood";
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 2;
  scene.add(mesh);
  terrain.maskMaterial(material);

  // 降雨曲线（mm/h，逐小时），默认用 2019-05-23 光明实测；之后雨停、积水慢慢退
  let curve = [20, 136.5, 56];
  let simTime = 0;
  let running = false;
  return {
    mesh,
    start: (mmPerHour: number[] = curve) => { curve = mmPerHour; simTime = 0; running = true; mesh.visible = true; uRun.value = 1; renderer.compute(reset); },
    stop: () => { running = false; mesh.visible = false; uRun.value = 0; uRain.value = 0; },
    /** 当前模拟时刻（小时）和降雨强度，供讲解显示 */
    status: () => ({ hours: simTime / 3600, rain: curve[Math.floor(simTime / 3600)] ?? 0 }),
    update: () => {
      if (!running) return;
      for (let s = 0; s < SUBSTEPS; s += 1) {
        const mm = curve[Math.floor(simTime / 3600)] ?? 0;
        uRain.value = mm / 1000 / 3600;
        renderer.compute(fluxStep);
        renderer.compute(depthStep);
        simTime += DT;
      }
    },
    /** 调试：读回 GPU 上的水深 */
    stats: async () => {
      const a = new Float32Array(await renderer.getArrayBufferAsync((water as unknown as { value: THREE.BufferAttribute }).value));
      let max = 0, sum = 0, wet = 0, nan = 0;
      for (const v of a) { if (Number.isNaN(v)) { nan += 1; continue; } if (v > max) max = v; sum += v; if (v > 0.05) wet += 1; }
      return { max, mean: sum / a.length, wetCells: wet, nan };
    },
    dispose: () => { geometry.dispose(); material.dispose(); scene.remove(mesh); },
  };
}
