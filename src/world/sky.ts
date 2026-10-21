import * as THREE from "three/webgpu";
import { abs, dot, float, floor, Fn, hash, max, mix, normalize, positionWorldDirection, smoothstep, step, vec3 } from "three/tsl";
import type { LookUniforms } from "../look/uniforms";

/** 天空：按视线高度角取天顶 / 天中 / 地平线色；太阳光晕、日盘、地平线光带；夜里的星星 */
export function applySky(scene: THREE.Scene, U: LookUniforms) {
  scene.backgroundNode = Fn(() => {
    const d = normalize(positionWorldDirection);
    const y = d.y;
    const sky = mix(mix(U.fog, U.horizon, smoothstep(-0.04, 0.0, y)), U.mid, smoothstep(0.0, 0.2, y)).toVar();
    sky.assign(mix(sky, U.top, smoothstep(0.2, 0.8, y)));
    // 太阳：宽光晕（日出日落时更大更亮）+ 窄光晕 + 日盘；地平线附近的空气被阳光染色
    const s = max(dot(d, U.sunDir), 0.0);
    const halo = s.pow(6.0).mul(U.glow.mul(0.45).add(0.1)).add(s.pow(48.0).mul(0.35));
    const disc = smoothstep(0.99955, 0.9998, s);
    const band = float(1).sub(smoothstep(0.0, 0.25, abs(y))).mul(s.pow(2.0)).mul(0.35).mul(U.glow);
    sky.addAssign(U.sun.mul(halo.mul(mix(0.35, 1.0, U.sunUp)).add(band)).add(U.sun.mul(disc).mul(mix(0.6, 2.2, U.sunUp))));
    // 星星：只在夜里、只在地平线以上
    const cell = floor(d.mul(420.0));
    const star = step(0.9986, hash(cell.x.add(cell.y.mul(419.0)).add(cell.z.mul(175561.0)))).mul(smoothstep(0.05, 0.3, y));
    return sky.add(vec3(star.mul(U.stars).mul(0.9)));
  })();
}
