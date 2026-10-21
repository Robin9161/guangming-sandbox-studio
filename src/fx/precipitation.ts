import * as THREE from "three/webgpu";
import { abs, color, float, fract, hash, instanceIndex, length, sin, smoothstep, step, time, uniform, uv, vec2, vec3 } from "three/tsl";

/**
 * 雨丝和雪花：WebGPU 不支持大于 1 像素的点，所以用实例化的小面片（Sprite），位置、下落、摆动全部在着色器里算。
 * 放在"跟着镜头走的盒子"里：中心在镜头和焦点之间、偏镜头一侧，大小按镜头距离缩放，拉远拉近都看得到。
 */
export function createPrecipitation(scene: THREE.Scene) {
  const U = {
    center: uniform(new THREE.Vector3()),
    size: uniform(1000),
    /** 雨雪颜色跟随天光：白天浅、夜里暗 */
    light: uniform(1),
    rainLevel: uniform(0),
    snowLevel: uniform(0),
  };
  const fall = (count: number, o: { speed: number; sway: number; w: number; h: number; color: string; opacity: number; level: typeof U.rainLevel; round: boolean; tilt: number }) => {
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const r = (k: number) => hash(instanceIndex.add(k * 7919));
    const r1 = r(1), r2 = r(2), r3 = r(3), r4 = r(4);
    const height = U.size.mul(0.9);
    const y = fract(r2.sub(time.mul(o.speed).mul(r1.mul(0.3).add(0.85)))).mul(height).sub(height.mul(0.5));
    const sway = sin(time.mul(r3.add(0.6)).add(r1.mul(6.283))).mul(U.size).mul(o.sway);
    m.positionNode = U.center.add(vec3(r1.sub(0.5).mul(U.size).add(sway), y, r3.sub(0.5).mul(U.size).add(sway.mul(0.6))));
    m.scaleNode = vec2(U.size.mul(o.w), U.size.mul(o.h));
    m.rotationNode = float(o.tilt);
    const shape = o.round ? smoothstep(0.5, 0.15, length(uv().sub(0.5))) : smoothstep(0.5, 0.0, abs(uv().x.sub(0.5)));
    m.colorNode = color(o.color).mul(U.light);
    m.opacityNode = step(r4, o.level).mul(shape).mul(o.opacity); // 强度决定有多少雨丝 / 雪花出现
    const sprite = new THREE.Sprite(m);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 6;
    scene.add(sprite);
    return sprite;
  };
  fall(7000, { speed: 0.9, sway: 0, w: 0.0005, h: 0.03, color: "#c9d6ea", opacity: 0.28, level: U.rainLevel, round: false, tilt: 0.12 });
  fall(9000, { speed: 0.06, sway: 0.012, w: 0.0035, h: 0.0035, color: "#f4f7fb", opacity: 0.9, level: U.snowLevel, round: true, tilt: 0 });

  /** 每帧：盒子跟着镜头 */
  const follow = (camera: THREE.Camera, target: THREE.Vector3) => {
    U.center.value.copy(camera.position).lerp(target, 0.4);
    U.size.value = THREE.MathUtils.clamp(camera.position.distanceTo(target) * 0.55, 300, 20000);
  };
  return { U, follow };
}

export type Precipitation = ReturnType<typeof createPrecipitation>;
